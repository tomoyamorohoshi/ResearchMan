/**
 * add-case ジョブのロールバック対象をジョブレコード（Job.pendingRollback）へ永続化するヘルパー。
 *
 * addCase.ts のローカル配列（trackedTouched / newUntracked）はプロセスごと殺される
 * （tsx watch の再起動等）とcatchのロールバックが走らず失われ、exhibition.json・サムネ等の
 * 部分書き込みが作業ツリーに残る（2026-11-07 23:37 の実例）。そこで「ファイルを書く前」に
 * 追跡対象をジョブにも保存し、起動時復元（jobQueue.ts::recoverQueueOnStartup）が戻せるようにする。
 */
import { updateJob } from "../jobs.js";

/** 配列へ追加（先に追跡）してから、累積スナップショットをジョブへ保存する。保存失敗はパイプラインを止めない。 */
export async function trackForRollback(
  jobId: string,
  trackedTouched: string[],
  newUntracked: string[],
  add: { tracked?: string[]; untracked?: string[] },
): Promise<void> {
  if (add.tracked) trackedTouched.push(...add.tracked);
  if (add.untracked) newUntracked.push(...add.untracked);
  await updateJob(jobId, {
    pendingRollback: { tracked: [...trackedTouched], untracked: [...newUntracked] },
  }).catch((e) => {
    console.error(`[studio] pendingRollback の保存に失敗しました (job ${jobId}):`, e);
  });
}

/** commit成功時・通常経路のロールバック完了時に呼ぶ。 */
export async function clearPendingRollback(jobId: string): Promise<void> {
  await updateJob(jobId, { pendingRollback: undefined }).catch(() => {});
}
