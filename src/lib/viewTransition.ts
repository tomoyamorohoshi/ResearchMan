// TOPページ 3Dモード切替時のトランジション演出（DOM操作のみ・Reactに依存しない）。
// GalleryClient（"use client"）からのみ呼ばれる想定。

const FLY_DURATION_MS = 550;
const LAND_DURATION_MS = 600;
const STAGGER_STEP_MS = 15;
const STAGGER_MAX_MS = 300;
const FALLBACK_TIMEOUT_MS = 1500;

function visibleChildren(container: HTMLElement): HTMLElement[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return Array.from(container.children).filter((el): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
  });
}

// カード中心から画面中心への放射方向ベクトル（±ランダム係数）を返す
function radialDirection(rect: DOMRect, centerX: number, centerY: number) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = cx - centerX || (Math.random() - 0.5) * 100;
  const dy = cy - centerY || (Math.random() - 0.5) * 100;
  const norm = Math.hypot(dx, dy) || 1;
  return { ux: dx / norm, uy: dy / norm };
}

function randomAxis(): string {
  return Math.random() < 0.5 ? "1,0.3,0" : "0.3,1,0";
}

async function settle(animations: Animation[]): Promise<void> {
  await Promise.race([
    Promise.all(animations.map((a) => a.finished)).then(
      () => {},
      () => {},
    ),
    new Promise<void>((resolve) => setTimeout(resolve, FALLBACK_TIMEOUT_MS)),
  ]);
}

/**
 * グリッドのビューポート内カードをクローンして「3D的に吹き飛ぶ」演出をする。
 * 実DOM（gridEl配下）は一切変更しない。クローンはdocument.body直下の
 * オーバーレイに追加し、アニメーション完了（またはフォールバックタイムアウト）後に除去する。
 * 呼び出し元はこれをawaitする前にメイン描画を切り替えてよい
 * （クローンはReactツリーと独立して動き続けるため）。
 */
export function blowAwayCards(gridEl: HTMLElement): Promise<void> {
  const cards = visibleChildren(gridEl);
  if (cards.length === 0) return Promise.resolve();

  const overlay = document.createElement("div");
  overlay.setAttribute("data-view-transition-overlay", "blow-away");
  // クローンには実カードのリンク・ボタンが含まれるため、演出中の約0.6秒間
  // アクセシビリティツリーに重複露出しないよう隠す（pointer-events:noneと対）
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "40",
    pointerEvents: "none",
    perspective: "1000px",
    overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlay);

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  const animations = cards.map((el, i) => {
    const rect = el.getBoundingClientRect();
    const clone = el.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(clone);

    const { ux, uy } = radialDirection(rect, centerX, centerY);
    const spread = 400 + Math.random() * 400;
    const tx = ux * spread;
    const ty = uy * spread;
    const tz = 400 + Math.random() * 400;
    const rot = 60 + Math.random() * 60;
    const axis = randomAxis();

    return clone.animate(
      [
        { transform: "translate3d(0,0,0) rotate3d(0,0,1,0deg)", opacity: 1 },
        { transform: `translate3d(${tx}px, ${ty}px, ${tz}px) rotate3d(${axis},${rot}deg)`, opacity: 0 },
      ],
      {
        duration: FLY_DURATION_MS,
        delay: Math.min(i * STAGGER_STEP_MS, STAGGER_MAX_MS),
        easing: "cubic-bezier(0.55, 0, 1, 0.45)",
        fill: "forwards",
      },
    );
  });

  return settle(animations).then(() => {
    overlay.remove();
  });
}

/**
 * グリッドのビューポート内カード（実要素）を、画面外から3D空間を活かして
 * 着地するアニメーションで登場させる。Web Animations APIはinline styleの
 * `style`属性を変更しないため、アニメーション完了後（fill:"none"）は
 * 要素に何の痕跡も残らない（アイドル時DOM不変の制約を満たす）。
 */
export function landCards(gridEl: HTMLElement): Promise<void> {
  const cards = visibleChildren(gridEl);
  if (cards.length === 0) return Promise.resolve();

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  const animations = cards.map((el, i) => {
    const rect = el.getBoundingClientRect();
    const { ux, uy } = radialDirection(rect, centerX, centerY);
    const spread = 300 + Math.random() * 300;
    const fx = ux * spread;
    const fy = uy * spread;
    const fz = 350 + Math.random() * 300;
    const rot = 50 + Math.random() * 50;
    const axis = randomAxis();

    return el.animate(
      [
        { transform: `translate3d(${fx}px, ${fy}px, ${fz}px) rotate3d(${axis},${rot}deg)`, opacity: 0 },
        { transform: "translate3d(0,0,0) rotate3d(0,0,1,0deg)", opacity: 1 },
      ],
      {
        duration: LAND_DURATION_MS,
        delay: Math.min(i * STAGGER_STEP_MS, STAGGER_MAX_MS),
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "none",
      },
    );
  });

  return settle(animations);
}
