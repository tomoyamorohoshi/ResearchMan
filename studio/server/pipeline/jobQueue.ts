/**
 * デイリーgitロック（researchman-git.lock）が埋まっている間、research/add-case/ideaジョブを
 * FIFOで順番待ちさせるキュー（jobs.ts::createJob が isLockHeld()==true のとき積む）。
 *
 * ワーカーはlockを事前取得して外側から渡すことは絶対にしない（jobs.tsのコメント・DESIGN.md
 * 参照）。isLockHeld()で「空いていそう」と判定した場合のみ、パイプライン関数を普段どおり
 * （externalLock無し）呼び出し、パイプライン自身が自前でtryAcquireLock()する。peekから実際の
 * acquireまでの間に極小のレース窓（daily cronが割り込む可能性）は残るが、その場合パイプラインは
 * 通常どおり「デイリージョブ実行中です」でerror終了するだけで、デッドロックや二重実行にはならない
 * 安全側のトレードオフ。
 *
 * queued状態のジョブはLINE「停止」（jobs.ts::cancelActiveJobs）で removeFromQueue され、
 * status="cancelled" になる（dispatch時のstatus確認でもskippedになる二重の安全策）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getJob, listJobs, preparePipelineRun, updateJob, type Job } from "../jobs.js";
import { rollbackTouchedFiles } from "./audit.js";
import { isLockHeld } from "./lock.js";

// studio/server/pipeline -> repo root（addCase.ts の ROOT と同じ）
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const queue: string[] = [];
const QUEUE_POLL_INTERVAL_MS = 15_000;
let workerTimer: ReturnType<typeof setTimeout> | null = null;

export function enqueueJob(jobId: string): void {
  queue.push(jobId);
}

/** キャンセル(LINE「停止」)されたqueuedジョブをFIFOから外す（dispatchさせない）。 */
export function removeFromQueue(jobId: string): void {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i] === jobId) queue.splice(i, 1);
}

/** テスト・診断用: 現在のFIFO内容のコピー。 */
export function queueSnapshot(): string[] {
  return [...queue];
}

/** キュー先頭を1回だけ処理しようと試みる（テストから直接呼べるよう、setTimeoutループ本体とは分離）。
 * 戻り値で結果を返す（テストのassertを楽にするため）。 */
export type ProcessQueueResult = "empty" | "busy" | "dispatched" | "skipped";

export async function processQueueOnce(): Promise<ProcessQueueResult> {
  if (queue.length === 0) return "empty";
  if (isLockHeld()) return "busy"; // まだ埋まっている。次tickで再試行（先頭はshiftしない）

  const jobId = queue.shift()!;
  const job = await getJob(jobId);
  if (!job || job.status !== "queued") return "skipped"; // 消滅/想定外の状態変化はスキップし次へ進む

  try {
    const prepared = preparePipelineRun(job.tab as "research" | "idea" | "add-case", job.request);
    await updateJob(jobId, { status: "running", progress: prepared.initialProgress });
    await prepared.execute(jobId); // パイプライン内部が自前でtryAcquireLock()する。完了(lock解放含む)まで待つ
  } catch (err) {
    console.error(`[studio] queued job dispatch failed: ${jobId}`, err);
    await updateJob(jobId, {
      status: "error",
      progress: undefined,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  }
  return "dispatched";
}

/** サーバ起動時に一度だけ呼ぶ、常駐ワーカー（15秒間隔・二重起動防止つき）。
 * setIntervalではなく自己再スケジュール型のsetTimeoutにして、1件の処理に時間がかかっても
 * 次のtickと重複起動しないようにする（同時実行は常に高々1本）。 */
export function startQueueWorker(intervalMs: number = QUEUE_POLL_INTERVAL_MS): void {
  if (workerTimer) return; // 二重起動防止（既存のactiveJobIds流儀に倣う）
  const tick = async (): Promise<void> => {
    try {
      await processQueueOnce();
    } catch (err) {
      console.error("[studio] queue worker tick failed", err);
    }
    workerTimer = setTimeout(tick, intervalMs);
  };
  workerTimer = setTimeout(tick, intervalMs);
}

/** サーバ起動時の復元（index.tsから呼ぶ）:
 * 1. status:"queued" のジョブを投入時刻(at)昇順でFIFOへ再登録
 * 2. status:"running" かつ tab!=="awards" の孤児ジョブ（プロセス死の残骸）をerrorへ落とす
 *    （awardsは既存のrecoverAwardJobsOnStartupが別途処理するので触らない）
 */
export async function recoverQueueOnStartup(
  rollback: (tracked: string[], untracked: string[]) => Promise<void> = (tracked, untracked) =>
    rollbackTouchedFiles(ROOT, tracked, untracked),
): Promise<void> {
  const jobs = await listJobs();

  const orphanedRunning = jobs.filter((j: Job) => j.status === "running" && j.tab !== "awards");
  // add-case はプロセス死でcatchのロールバックが走らず、部分書き込み（exhibition.json・サムネ等）が
  // 作業ツリーに残りうる。ジョブに永続化したロールバック対象を、再実行/error化の前に戻す。
  // rollbackTouchedFilesはHEAD追跡済み（=commit済み）ファイルを消さないので、commit後に死んでいても安全。
  // 失敗したジョブは再実行せず（不整合のまま重ねて書かない）errorにする。
  const rollbackFailedIds = new Set<string>();
  for (const j of orphanedRunning) {
    if (j.tab !== "add-case" || !j.pendingRollback) continue;
    try {
      await rollback(j.pendingRollback.tracked, j.pendingRollback.untracked);
      await updateJob(j.id, { pendingRollback: undefined }).catch(() => {});
    } catch (err) {
      console.error(`[studio] 起動時ロールバックに失敗しました (job ${j.id}):`, err);
      rollbackFailedIds.add(j.id);
      await updateJob(j.id, {
        status: "error",
        progress: undefined,
        error:
          "サーバ再起動により中断され、作業ツリーのロールバックにも失敗しました。data/ と public/thumbnails/ の未commit変更を確認してください。",
      }).catch(() => {});
    }
  }
  // add-case（LINE投稿）は初回の再起動中断に限り、errorにせずqueuedへ戻して自動再実行する。
  const resumable = orphanedRunning.filter((j: Job) => j.tab === "add-case" && (j.restartResumes ?? 0) < 1 && !rollbackFailedIds.has(j.id));
  const resumedIds = new Set<string>();
  for (const j of resumable) {
    const updated = await updateJob(j.id, {
      status: "queued",
      progress: undefined,
      restartResumes: 1,
    }).catch(() => null);
    if (updated) resumedIds.add(j.id);
  }

  const queuedJobs = jobs
    .filter((j: Job) => j.status === "queued" || resumedIds.has(j.id))
    .sort((a: Job, b: Job) => (a.at < b.at ? -1 : 1));
  for (const j of queuedJobs) enqueueJob(j.id);

  for (const j of orphanedRunning) {
    if (resumedIds.has(j.id) || rollbackFailedIds.has(j.id)) continue;
    await updateJob(j.id, {
      status: "error",
      progress: undefined,
      error: "サーバ再起動により中断されました。もう一度実行してください。",
    }).catch(() => {});
  }
}
