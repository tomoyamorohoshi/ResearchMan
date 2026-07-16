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
 * 将来課題: queued状態のジョブをキャンセルするAPIは未実装（LINEの既存「キャンセル」は
 * ウィザード専用のため流用しない）。
 */
import { getJob, listJobs, preparePipelineRun, updateJob, type Job } from "../jobs.js";
import { isLockHeld } from "./lock.js";

const queue: string[] = [];
const QUEUE_POLL_INTERVAL_MS = 15_000;
let workerTimer: ReturnType<typeof setTimeout> | null = null;

export function enqueueJob(jobId: string): void {
  queue.push(jobId);
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
export async function recoverQueueOnStartup(): Promise<void> {
  const jobs = await listJobs();

  const queuedJobs = jobs
    .filter((j: Job) => j.status === "queued")
    .sort((a: Job, b: Job) => (a.at < b.at ? -1 : 1));
  for (const j of queuedJobs) enqueueJob(j.id);

  const orphanedRunning = jobs.filter((j: Job) => j.status === "running" && j.tab !== "awards");
  for (const j of orphanedRunning) {
    await updateJob(j.id, {
      status: "error",
      progress: undefined,
      error: "サーバ再起動により中断されました。もう一度実行してください。",
    }).catch(() => {});
  }
}
