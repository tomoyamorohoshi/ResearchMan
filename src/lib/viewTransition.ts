// TOPページ 3Dモード切替時のトランジション演出（DOM操作のみ・Reactに依存しない）。
// GalleryClient（"use client"）からのみ呼ばれる想定。
//
// v3:「グリッド平面モーフ」方式（計画書Part2参照）。DOMグリッドと3D星雲を同じスプライト群の
// 2つのポーズとして扱い、画素一致の1フレームスワップ＋整列モードと同じ自前トゥイーンで
// 繋ぐワンカット遷移に全面刷新。旧v2のシェアードエレメント遷移（liftCards/materializeCardsの
// クローン+弧軌道アニメーション、canvasクロスフェード）はディゾルブ的な繋ぎが残るため撤去した。
// このモジュールが担うのはもう「DOMグリッドのrect採取」と「カード要素単位の収縮/展開
// マイクロモーション」だけ（シーン全体のディゾルブではない。実際のスプライト⇔平面ポーズの
// モーフはGraph3DView.tsx側が担う）。

export type { PlaneCardRect } from "./planePose";
import type { PlaneCardRect } from "./planePose";

// ── 収縮/展開マイクロモーション ──
const SHRINK_DURATION_MS = 180;
const EXPAND_DURATION_MS = 180;
const SHRINK_EASING = "cubic-bezier(0.32, 0, 0.67, 0)";
const EXPAND_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

function visibleChildren(container: HTMLElement): HTMLElement[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return Array.from(container.children).filter((el): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
  });
}

// カード要素から事例idを取り出す。data-case-id属性を優先し、
// 無ければ子のLink href="/cases/{id}" から抽出する
function extractCaseId(el: HTMLElement): string | null {
  const attr = el.getAttribute("data-case-id");
  if (attr) return attr;
  const link = el.querySelector<HTMLAnchorElement>('a[href^="/cases/"]');
  const href = link?.getAttribute("href");
  const match = href?.match(/^\/cases\/([^/?#]+)/);
  return match ? match[1] : null;
}

// カードの「テキスト部」要素（画像部分・お気に入りボタン以外の直接の子）。
// CaseCard.tsxの構造（画像Link → テキストLink → 年/受賞バッジdiv → お気に入りボタン）に
// 依存せず、属性/タグ名で判定する（マークアップ順序が変わっても壊れにくい）
function textSections(card: HTMLElement): HTMLElement[] {
  return Array.from(card.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains("aspect-square") && el.tagName !== "BUTTON",
  );
}

async function settle(animations: Animation[]): Promise<void> {
  await Promise.all(animations.map((a) => a.finished)).then(
    () => {},
    () => {},
  );
}

/**
 * グリッド全カード（画面外も含む）の画像部分（aspect-square）のrectをidごとに採取する。
 * 平面ポーズ計算（Graph3DView側）の入力になる。画面外カードも採取するのは、
 * 平面がビューポート外へ延長され、そこからスプライトが飛んでくる/飛んでいくため。
 */
export function captureImageRects(gridEl: HTMLElement): Map<string, PlaneCardRect> {
  const result = new Map<string, PlaneCardRect>();
  for (const card of Array.from(gridEl.children)) {
    if (!(card instanceof HTMLElement)) continue;
    const id = extractCaseId(card);
    if (!id) continue;
    const img = card.querySelector<HTMLElement>(".aspect-square");
    if (!img) continue;
    const r = img.getBoundingClientRect();
    if (r.width <= 0) continue;
    result.set(id, { left: r.left, top: r.top, width: r.width });
  }
  return result;
}

/**
 * ON: 可視カードのテキスト部を畳んで「画像だけの正方形」にする(~180ms)。
 * 完了後もその見た目を保持する(fill:"forwards")。この直後にGraph3DViewへの
 * スワップでグリッドごとアンマウントされるため、後始末（inline styleのクリア）は不要
 * （アイドルDOM不変の制約は「アンマウントされず居残るカード」には影響しない）。
 */
export function shrinkVisibleCards(gridEl: HTMLElement): Promise<void> {
  const animations: Animation[] = [];
  for (const card of visibleChildren(gridEl)) {
    for (const el of textSections(card)) {
      const h = el.getBoundingClientRect().height;
      if (h <= 0) continue;
      el.style.overflow = "hidden";
      animations.push(
        el.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0 }], {
          duration: SHRINK_DURATION_MS,
          easing: SHRINK_EASING,
          fill: "forwards",
        }),
      );
    }
  }
  return settle(animations);
}

/**
 * OFF準備: グリッドがマウントされた直後（まだcanvasの陰に隠れている間）に、
 * 可視カードのテキスト部をアニメーションなしで即座に畳んでおく。この後に採取する
 * rectが「畳まれた＝画像だけの」レイアウトを反映するようにするため
 * （平面ポーズの画素一致に必要。スワップ前に呼ぶこと）。
 */
export function collapseTextSectionsInstant(gridEl: HTMLElement): void {
  for (const card of visibleChildren(gridEl)) {
    for (const el of textSections(card)) {
      el.style.overflow = "hidden";
      el.style.height = "0px";
      el.style.opacity = "0";
    }
  }
}

/**
 * OFF: 可視カードのテキスト部を「畳まれた状態」（collapseTextSectionsInstantの続き、
 * またはON側の残留状態）から自然な高さへ開く(~180ms)。完了後はinline styleを
 * 一切残さない（fill:"none"。アイドルOFF DOM不変の制約を満たす）。
 */
export function expandVisibleCards(gridEl: HTMLElement): Promise<void> {
  const entries: Array<{ el: HTMLElement; anim: Animation }> = [];
  for (const card of visibleChildren(gridEl)) {
    for (const el of textSections(card)) {
      // scrollHeightはoverflow:hidden+height:0の間も本来の内容の高さを返す
      // （clip前提のプロパティのため、明示heightの影響を受けない）
      const h = el.scrollHeight;
      const anim = el.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], {
        duration: EXPAND_DURATION_MS,
        easing: EXPAND_EASING,
        fill: "none",
      });
      // animate()のkeyframe0は同期的に適用されるため、ここでinline styleを
      // クリアしても視覚的なジャンプは発生しない（次ペイントまでに反映される）
      el.style.overflow = "";
      el.style.height = "";
      el.style.opacity = "";
      if (el.style.length === 0) el.removeAttribute("style");
      entries.push({ el, anim });
    }
  }
  return settle(entries.map((e) => e.anim)).then(() => {
    // fill:"none"のアニメーションが自然終了する際、ブラウザが空のstyle=""属性を
    // 書き戻すことがある（実機Playwright検証で発見。上のremoveAttributeは
    // アニメーション開始直後＝まだ何も終了処理されていない時点のもので無効化される）。
    // アニメーション完了「後」に改めて空属性を除去し、アイドルDOM不変を保証する
    for (const { el } of entries) {
      if (el.getAttribute("style") === "") el.removeAttribute("style");
    }
  });
}
