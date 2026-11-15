// 無限スクロール（段階描画）の件数ロジック。副作用なしの純関数だけを置く。
// 描画件数は「フィルタ/ソート/検索のキー」とセットで持ち、キーが変わったら先頭（初期件数）から描き直す。

export const INITIAL_VISIBLE = 60;
export const VISIBLE_STEP = 60;

export type VisibleState = { key: string; count: number };

export function nextVisibleCount(current: number, total: number, step: number = VISIBLE_STEP): number {
  return Math.min(current + step, Math.max(total, 0));
}

export function hasMoreToShow(visible: number, total: number): boolean {
  return visible < total;
}

// 実際に描く件数。キー不一致（絞り込み等が変わった）なら初期件数、総件数を超える分は切り詰める
export function resolveVisibleCount(state: VisibleState, key: string, total: number): number {
  const base = state.key === key ? state.count : INITIAL_VISIBLE;
  return Math.min(base, Math.max(total, 0));
}
