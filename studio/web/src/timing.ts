/**
 * Researching/Thinking 表示の最低表示時間。
 *
 * fetchが早く終わってもUIがちらつかないよう、fetch完了とこの最低時間の
 * 両方が満たされてから results へ遷移させる（呼び出し側で
 * Promise.all([fetch, minDelay()]) する）。
 */
const REDUCED_MOTION_DELAY_MS = 300;
const NORMAL_DELAY_MS = 1500;

export function minDelay(): Promise<void> {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ms = reduced ? REDUCED_MOTION_DELAY_MS : NORMAL_DELAY_MS;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
