/**
 * フェーズ所要時間の実測記録（DESIGN.md §10 P4 #6）。
 *
 * 各パイプラインの setProgress() 呼び出し（=フェーズ切替）の間隔を jobId ごとに積算し、
 * job JSON の phaseDurationsMs（ミリ秒）へ記録する。将来 eta.ts の静的な目安分（分）を
 * 実測ベースへ較正するための素材で、UI表示は当面既存の静的マッピングのままでよい
 * （タスク指示: 「値だけ実測で見直し」）。
 *
 * jobId ごとに状態を持つため、同一プロセス内で複数ジョブが並行してもフェーズ計測が
 * 混線しない（combinedResearch.ts のようにCase→Techを同一jobIdで直列実行する場合は、
 * finishJob() で一度状態をクリアしてからTech側が新規に計測を始める）。
 */
const state = new Map<string, { lastPhase: string | null; lastAt: number; durationsMs: Record<string, number> }>();

function accumulate(
  s: { lastPhase: string | null; lastAt: number; durationsMs: Record<string, number> },
  now: number,
): void {
  if (s.lastPhase === null) return;
  s.durationsMs[s.lastPhase] = (s.durationsMs[s.lastPhase] ?? 0) + Math.max(0, now - s.lastAt);
}

/**
 * フェーズを切り替える。直前フェーズがあれば、その経過時間を積算してから
 * 現在までの積算値（コピー）を返す（呼び出し側はこれをそのままjob JSONへ書ける）。
 */
export function startPhase(jobId: string, phase: string, now: number = Date.now()): Record<string, number> {
  let s = state.get(jobId);
  if (!s) {
    s = { lastPhase: null, lastAt: now, durationsMs: {} };
    state.set(jobId, s);
  }
  accumulate(s, now);
  s.lastPhase = phase;
  s.lastAt = now;
  return { ...s.durationsMs };
}

/**
 * ジョブ終了時に呼ぶ。最終フェーズの経過時間も積算した確定値を返し、内部状態を破棄する
 * （メモリリーク防止。同一jobIdを再利用することは無い前提だが、念のため次回計測は
 * ゼロから始まるようにする）。
 */
export function finishJob(jobId: string, now: number = Date.now()): Record<string, number> {
  const s = state.get(jobId);
  if (!s) return {};
  accumulate(s, now);
  state.delete(jobId);
  return { ...s.durationsMs };
}
