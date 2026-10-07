/**
 * ジョブ中断（LINE「停止」。line/webhook.ts / jobs.ts::cancelActiveJobs 参照）のための
 * プロセス内レジストリ。
 *
 * - jobId → AbortController を保持する。ジョブ実行（パイプラインのexecute）は
 *   runInJobContext() の中で行い、AsyncLocalStorage 経由で「いまどのジョブのコードか」を
 *   下層（sdkRunner.ts など）へ引き回す。引数の持ち回しを増やさずに済む。
 * - キャンセルは sticky: 一度cancelされたジョブIDは isJobCancelled() が真を返し続け、
 *   以後のSDK呼び出しは即座に失敗する（リトライでパイプラインが続行しない）。
 * - commit/push に着手した後は中断できない（データ不整合を避けるため）。パイプラインは
 *   gitAdd の直前に beginCommit() を呼ぶ。これはキャンセル済みなら CancelledError を投げ、
 *   そうでなければ「commit中」フラグを立てる（同期処理なのでチェックとフラグ設定の間に
 *   割り込みは入らない）。以後の requestCancel は "too-late" を返しabortしない。
 * - サーバ再起動後はレジストリが空になる。生きたコントローラが無いジョブの requestCancel は
 *   記録だけして "cancelled" を返す（呼び出し側がジョブファイルをcancelledにする）。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const CANCELLED_MESSAGE = "キャンセルされました";

export class CancelledError extends Error {
  constructor() {
    super(CANCELLED_MESSAGE);
    this.name = "CancelledError";
  }
}

interface Entry {
  controller: AbortController;
  committing: boolean;
}

const store = new AsyncLocalStorage<{ jobId: string }>();
const entries = new Map<string, Entry>();
const cancelledIds = new Set<string>();

/** ジョブ実行を fn の間だけコンテキストに載せる。キャンセル済みなら fn を実行せず undefined を返す。 */
export async function runInJobContext<T>(jobId: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (cancelledIds.has(jobId)) return undefined;
  const reuse = entries.has(jobId); // 入れ子（awardsの再開など）では外側の登録を共有する
  if (!reuse) entries.set(jobId, { controller: new AbortController(), committing: false });
  try {
    return await store.run({ jobId }, fn);
  } finally {
    if (!reuse) entries.delete(jobId);
  }
}

function currentEntry(): { jobId: string; entry: Entry | undefined } | undefined {
  const ctx = store.getStore();
  if (!ctx) return undefined;
  return { jobId: ctx.jobId, entry: entries.get(ctx.jobId) };
}

/** 現在のジョブコンテキストのAbortSignal（コンテキスト外ならundefined）。 */
export function currentJobSignal(): AbortSignal | undefined {
  return currentEntry()?.entry?.controller.signal;
}

/** 現在のジョブコンテキストのAbortController（SDKのoptions.abortController用）。 */
export function currentJobAbortController(): AbortController | undefined {
  return currentEntry()?.entry?.controller;
}

export function isJobCancelled(jobId: string): boolean {
  return cancelledIds.has(jobId);
}

/** 現在のコンテキストのジョブがキャンセル済みか（コンテキスト外はfalse）。 */
export function isCancelledInContext(): boolean {
  const ctx = store.getStore();
  return !!ctx && cancelledIds.has(ctx.jobId);
}

/** キャンセル済みならCancelledErrorを投げる（コンテキスト外では何もしない）。 */
export function throwIfCancelled(): void {
  if (isCancelledInContext()) throw new CancelledError();
}

/**
 * git add/commit/push に着手する直前に呼ぶ。キャンセル済みならCancelledError、そうでなければ
 * 以後は中断不可（requestCancelが"too-late"を返す）にする。
 */
export function beginCommit(): void {
  throwIfCancelled();
  const cur = currentEntry();
  if (cur?.entry) cur.entry.committing = true;
}

/** 「両方」(Case→Tech) の次フェーズ開始時など、commit完了後に再び中断可能へ戻す。 */
export function endCommitPhase(): void {
  const cur = currentEntry();
  if (cur?.entry) cur.entry.committing = false;
}

export type CancelRequestResult = "cancelled" | "too-late";

/**
 * ジョブの中断を要求する。commit/push着手済みなら何もせず "too-late"。
 * それ以外はキャンセルを記録（sticky）し、生きたコントローラがあればabortする。
 */
export function requestCancel(jobId: string): CancelRequestResult {
  const entry = entries.get(jobId);
  if (entry?.committing) return "too-late";
  cancelledIds.add(jobId);
  entry?.controller.abort();
  return "cancelled";
}
