/**
 * add-case ジョブのロールバック対象をジョブレコード（Job.pendingRollback）へ永続化するヘルパー。
 *
 * addCase.ts のローカル配列（trackedTouched / newUntracked）はプロセスごと殺される
 * （tsx watch の再起動等）とcatchのロールバックが走らず失われ、exhibition.json・サムネ等の
 * 部分書き込みが作業ツリーに残る（2026-11-07 23:37 の実例）。そこで「ファイルを書く前」に
 * 追跡対象をジョブにも保存し、起動時復元（jobQueue.ts::recoverQueueOnStartup）が戻せるようにする。
 */
import path from "node:path";
import { updateJob } from "../jobs.js";

/** 配列へ追加（先に追跡）してから、累積スナップショットをジョブへ保存する。保存失敗はパイプラインを止めない。 */
export async function trackForRollback(
  jobId: string,
  trackedTouched: string[],
  newUntracked: string[],
  add: { tracked?: string[]; untracked?: string[] },
): Promise<void> {
  for (const p of add.tracked ?? []) if (!trackedTouched.includes(p)) trackedTouched.push(p);
  for (const p of add.untracked ?? []) if (!newUntracked.includes(p)) newUntracked.push(p);
  await updateJob(jobId, {
    pendingRollback: { tracked: [...trackedTouched], untracked: [...newUntracked] },
  }).catch((e) => {
    console.error(`[studio] pendingRollback の保存に失敗しました (job ${jobId}):`, e);
  });
}

/**
 * 展示サムネ保存関数（makeSaveThumb）を包み、`<thumbDirRel>/<id>.jpg` を書き込みの「直前」に追跡する。
 * processExhibitionAdd内のsaveThumbはreinvestigate(Claude呼び出し)を含む長い区間で書き込むため、
 * 戻り後にまとめて追跡すると、その間のプロセス死でサムネが孤児として残る。
 * 書かずに終わったパスが記録に残っても、rollbackTouchedFilesは存在しないパスを安全に無視する。
 */
export function withThumbTracking<C>(
  jobId: string,
  trackedTouched: string[],
  newUntracked: string[],
  saveThumb: (id: string, cand: C) => Promise<string | null>,
  thumbDirRel: string,
): (id: string, cand: C) => Promise<string | null> {
  return async (id, cand) => {
    await trackForRollback(jobId, trackedTouched, newUntracked, { untracked: [path.join(thumbDirRel, `${id}.jpg`)] });
    return saveThumb(id, cand);
  };
}

/** commit成功時・通常経路のロールバック完了時に呼ぶ。 */
export async function clearPendingRollback(jobId: string): Promise<void> {
  await updateJob(jobId, { pendingRollback: undefined }).catch(() => {});
}
