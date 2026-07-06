// TOPページ 3Dモード切替時のトランジション演出（DOM操作のみ・Reactに依存しない）。
// GalleryClient（"use client"）からのみ呼ばれる想定。
//
// v2: 「カードが自分のノード位置へ飛んで変身する（またその逆）」シェアードエレメント遷移。
// ON側はliftCards()でクローンを持ち上げてホールドし、Graph3DViewのonReadyでノード座標が
// 揃った時点でconvergeTo()を呼んで各ノード位置へ収束させる。OFF側はmaterializeCards()で
// 各ノード位置由来の座標からグリッド位置へFLIPさせる。

// ── Phase1「持ち上がり」（liftCards内部アニメーション） ──
const LIFT_DURATION_MS = 320;
const LIFT_STAGGER_MAX_MS = 120;
const LIFT_SCALE = 1.05;
const LIFT_TRANSLATE_Z_PX = 60;
const LIFT_TILT_DEG = 6;
const LIFT_SHADOW_OFFSET_Y_PX = 24;
const LIFT_SHADOW_BLUR_PX = 32;
const LIFT_SHADOW_ALPHA = 0.18;
const LIFT_EASING = "cubic-bezier(0.32, 0, 0.67, 0)";

// ── Phase2「ノードへ収束」（liftCards().convergeTo） ──
const CONVERGE_DURATION_MS = 650;
const CONVERGE_STAGGER_MAX_MS = 200;
const CONVERGE_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
// フェードアウトは最後の25%（offset 0.75→1）
const CONVERGE_FADE_START_OFFSET = 0.75;
// 対応ノードが見つからないクローン（画面外など）のフォールバック: その場でフェードのみ
const CONVERGE_FALLBACK_FADE_MS = 400;
// onReadyが来ない場合の中断フェード
const ABORT_FADE_MS = 250;

// Phase2の40%経過時点からcanvasラッパを300msでクロスフェードする
// （実際のクロスフェード制御はGalleryClient側。ここではタイミング定数のみ提供する）
export const CANVAS_CROSSFADE_DELAY_MS = Math.round(CONVERGE_DURATION_MS * 0.4);
export const CANVAS_CROSSFADE_DURATION_MS = 300;

// Phase2/materializeCards共通: 弧軌道の中間点（55%地点）と垂直逸れ幅
const ARC_MID_FRACTION = 0.55;
const ARC_DEVIATION_PX = 40;

// ── materializeCards（OFF側） ──
const MATERIALIZE_DURATION_MS = 650;
const MATERIALIZE_STAGGER_MAX_MS = 200;
const MATERIALIZE_TILT_DEG = 8;
const MATERIALIZE_FROM_OPACITY = 0.4;
const MATERIALIZE_EASING = "cubic-bezier(0.34, 1.4, 0.64, 1)"; // 軽いオーバーシュート

// materializeCardsのフォールバック（対応ノード座標が無いカード＝現行landCards相当の放射エントランス）
const FALLBACK_SPREAD_MIN = 300;
const FALLBACK_SPREAD_RANGE = 300;
const FALLBACK_Z_MIN = 350;
const FALLBACK_Z_RANGE = 300;
const FALLBACK_ROT_MIN = 50;
const FALLBACK_ROT_RANGE = 50;
const FALLBACK_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

const FALLBACK_TIMEOUT_MS = 2000;

export type CardTarget = { x: number; y: number; width: number };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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

function distanceFromCenter(rect: DOMRect, centerX: number, centerY: number): number {
  return Math.hypot(rect.left + rect.width / 2 - centerX, rect.top + rect.height / 2 - centerY);
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

function createOverlay(kind: string): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-view-transition-overlay", kind);
  // クローンには実カードのリンク・ボタンが含まれるため、演出中アクセシビリティツリーに
  // 重複露出しないよう隠す（pointer-events:noneと対）
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
  return overlay;
}

type LiftEntry = {
  id: string | null;
  clone: HTMLElement;
  rect: DOMRect;
  axis: string;
  tilt: number;
  dist: number;
};

/**
 * Phase1: ビューポート内カードをクローンし「持ち上がる」演出を開始する。
 * 実DOM（gridEl配下）は一切変更しない。クローンはdocument.body直下のオーバーレイに
 * 追加され、持ち上がった状態でホールドされる（fill:"forwards"）。
 * 戻り値のcontrollerでPhase2（各ノード位置への収束）を後から起動する。
 */
export function liftCards(gridEl: HTMLElement): {
  ids: string[];
  convergeTo: (targets: Map<string, CardTarget>) => Promise<void>;
  abort: () => Promise<void>;
} {
  const cards = visibleChildren(gridEl);
  if (cards.length === 0) {
    return { ids: [], convergeTo: async () => {}, abort: async () => {} };
  }

  const overlay = createOverlay("lift");
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  const entries: LiftEntry[] = cards.map((el) => {
    const rect = el.getBoundingClientRect();
    const id = extractCaseId(el);
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

    return {
      id,
      clone,
      rect,
      axis: randomAxis(),
      tilt: (Math.random() < 0.5 ? 1 : -1) * LIFT_TILT_DEG,
      dist: distanceFromCenter(rect, centerX, centerY),
    };
  });

  const maxDist = Math.max(...entries.map((e) => e.dist), 1);

  // Phase1: 持ち上げて保持（ビューポート中心からの距離に比例したradialスタガー）
  for (const entry of entries) {
    const delay = (entry.dist / maxDist) * LIFT_STAGGER_MAX_MS;
    entry.clone.animate(
      [
        { transform: "translate3d(0,0,0) scale(1) rotate3d(0,0,1,0deg)", filter: "none" },
        {
          transform: `translate3d(0,0,${LIFT_TRANSLATE_Z_PX}px) scale(${LIFT_SCALE}) rotate3d(${entry.axis},${entry.tilt}deg)`,
          filter: `drop-shadow(0 ${LIFT_SHADOW_OFFSET_Y_PX}px ${LIFT_SHADOW_BLUR_PX}px rgba(0,0,0,${LIFT_SHADOW_ALPHA}))`,
        },
      ],
      { duration: LIFT_DURATION_MS, delay, easing: LIFT_EASING, fill: "forwards" },
    );
  }

  const ids = entries.map((e) => e.id).filter((id): id is string => !!id);

  async function convergeTo(targets: Map<string, CardTarget>): Promise<void> {
    const animations = entries.map((entry) => {
      const delay = (entry.dist / maxDist) * CONVERGE_STAGGER_MAX_MS;
      const target = entry.id ? targets.get(entry.id) : undefined;

      if (!target) {
        // ノード位置が不明（ビューポート外・フィルタで消えた等）: その場でフェードのみ
        // （canvasクロスフェードで視覚的に包括されるため個別演出はしない）
        return entry.clone.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: CONVERGE_FALLBACK_FADE_MS,
          delay,
          easing: "ease-out",
          fill: "forwards",
        });
      }

      const cardCenterX = entry.rect.left + entry.rect.width / 2;
      const cardCenterY = entry.rect.top + entry.rect.height / 2;
      const dx = target.x - cardCenterX;
      const dy = target.y - cardCenterY;
      const scaleTo = target.width / entry.rect.width;

      const len = Math.hypot(dx, dy) || 1;
      const perpSign = Math.random() < 0.5 ? 1 : -1;
      const perpX = (-dy / len) * ARC_DEVIATION_PX * perpSign;
      const perpY = (dx / len) * ARC_DEVIATION_PX * perpSign;
      const midX = dx * ARC_MID_FRACTION + perpX;
      const midY = dy * ARC_MID_FRACTION + perpY;
      const midScale = lerp(LIFT_SCALE, scaleTo, ARC_MID_FRACTION);
      const midTilt = lerp(entry.tilt, 0, ARC_MID_FRACTION);
      const midZ = lerp(LIFT_TRANSLATE_Z_PX, 0, ARC_MID_FRACTION);

      return entry.clone.animate(
        [
          {
            offset: 0,
            transform: `translate3d(0,0,${LIFT_TRANSLATE_Z_PX}px) scale(${LIFT_SCALE}) rotate3d(${entry.axis},${entry.tilt}deg)`,
            opacity: 1,
          },
          {
            offset: ARC_MID_FRACTION,
            transform: `translate3d(${midX}px, ${midY}px, ${midZ}px) scale(${midScale}) rotate3d(${entry.axis},${midTilt}deg)`,
            opacity: 1,
          },
          { offset: CONVERGE_FADE_START_OFFSET, opacity: 1 },
          {
            offset: 1,
            transform: `translate3d(${dx}px, ${dy}px, 0px) scale(${scaleTo}) rotate3d(${entry.axis},0deg)`,
            opacity: 0,
          },
        ],
        { duration: CONVERGE_DURATION_MS, delay, easing: CONVERGE_EASING, fill: "forwards" },
      );
    });

    try {
      await settle(animations);
    } finally {
      overlay.remove();
    }
  }

  async function abort(): Promise<void> {
    const animations = entries.map((entry) =>
      entry.clone.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: ABORT_FADE_MS,
        easing: "ease-out",
        fill: "forwards",
      }),
    );
    try {
      await settle(animations);
    } finally {
      overlay.remove();
    }
  }

  return { ids, convergeTo, abort };
}

/**
 * OFF側: グリッドの可視カードを「ノード位置から飛来して着地」させるFLIP。
 * originsに無いカードは従来の放射エントランスにフォールバックする。
 * Web Animations APIはinline styleの`style`属性を変更しないため、
 * アニメーション完了後（fill:"none"）は要素に何の痕跡も残らない
 * （アイドル時DOM不変の制約を満たす）。
 */
export function materializeCards(
  gridEl: HTMLElement,
  origins: Map<string, CardTarget>,
): Promise<void> {
  const cards = visibleChildren(gridEl);
  if (cards.length === 0) return Promise.resolve();

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  const withDist = cards.map((el) => ({
    el,
    rect: el.getBoundingClientRect(),
    dist: distanceFromCenter(el.getBoundingClientRect(), centerX, centerY),
  }));
  const maxDist = Math.max(...withDist.map((e) => e.dist), 1);

  const animations = withDist.map(({ el, rect, dist }) => {
    const delay = (dist / maxDist) * MATERIALIZE_STAGGER_MAX_MS;
    const id = extractCaseId(el);
    const origin = id ? origins.get(id) : undefined;

    if (!origin) {
      // フォールバック: 対応するノード位置が無いカードは現行landCards相当の放射エントランス
      const { ux, uy } = radialDirection(rect, centerX, centerY);
      const spread = FALLBACK_SPREAD_MIN + Math.random() * FALLBACK_SPREAD_RANGE;
      const fx = ux * spread;
      const fy = uy * spread;
      const fz = FALLBACK_Z_MIN + Math.random() * FALLBACK_Z_RANGE;
      const rot = FALLBACK_ROT_MIN + Math.random() * FALLBACK_ROT_RANGE;
      const axis = randomAxis();
      return el.animate(
        [
          { transform: `translate3d(${fx}px, ${fy}px, ${fz}px) rotate3d(${axis},${rot}deg)`, opacity: 0 },
          { transform: "translate3d(0,0,0) rotate3d(0,0,1,0deg)", opacity: 1 },
        ],
        { duration: MATERIALIZE_DURATION_MS, delay, easing: FALLBACK_EASING, fill: "none" },
      );
    }

    const cardCenterX = rect.left + rect.width / 2;
    const cardCenterY = rect.top + rect.height / 2;
    const dx = origin.x - cardCenterX;
    const dy = origin.y - cardCenterY;
    const scaleFrom = origin.width / rect.width;
    const axis = randomAxis();
    const tilt = (Math.random() < 0.5 ? 1 : -1) * MATERIALIZE_TILT_DEG;

    const len = Math.hypot(dx, dy) || 1;
    const perpSign = Math.random() < 0.5 ? 1 : -1;
    const perpX = (-dy / len) * ARC_DEVIATION_PX * perpSign;
    const perpY = (dx / len) * ARC_DEVIATION_PX * perpSign;
    // originからグリッド静止位置(0,0)へ向かう経路。55%地点は残り45%の距離
    const midX = dx * (1 - ARC_MID_FRACTION) + perpX;
    const midY = dy * (1 - ARC_MID_FRACTION) + perpY;
    const midScale = lerp(scaleFrom, 1, ARC_MID_FRACTION);
    const midTilt = lerp(tilt, 0, ARC_MID_FRACTION);

    return el.animate(
      [
        {
          offset: 0,
          transform: `translate3d(${dx}px, ${dy}px, 0px) scale(${scaleFrom}) rotate3d(${axis},${tilt}deg)`,
          opacity: MATERIALIZE_FROM_OPACITY,
        },
        {
          offset: ARC_MID_FRACTION,
          transform: `translate3d(${midX}px, ${midY}px, 0px) scale(${midScale}) rotate3d(${axis},${midTilt}deg)`,
          opacity: 1,
        },
        { offset: 1, transform: "none", opacity: 1 },
      ],
      { duration: MATERIALIZE_DURATION_MS, delay, easing: MATERIALIZE_EASING, fill: "none" },
    );
  });

  return settle(animations);
}
