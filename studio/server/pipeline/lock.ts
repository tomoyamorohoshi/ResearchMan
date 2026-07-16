/**
 * デイリー3ジョブ（launchd/Windowsタスクスケジューラ）と共有する git 排他ロック
 * （os.tmpdir()/researchman-git.lock）のStudio側実装。DESIGN.md §「lock」: Studioは
 * 待機ループをせず、取得できなければ即座にジョブをerror扱いにする（デイリー側は
 * 最大30分待つが、Studioはユーザーが画面の前で待っているUIなので即時失敗の方が適切）。
 * stale判定（90分超過）はデイリーのplist（launchd/com.researchman.autoresearch.plist、
 * Windowsではscripts/windows/run-job.mjs）の閾値5400秒と同じにして、クラッシュ後の
 * 残骸を双方が同じ基準で救済できるようにする。
 */
import { mkdirSync, rmdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_LOCK_PATH = join(tmpdir(), "researchman-git.lock");
export const STALE_MS = 90 * 60 * 1000;

export function isLockStale(mtimeMs: number, now: number, staleMs: number = STALE_MS): boolean {
  return now - mtimeMs > staleMs;
}

export interface LockHandle {
  release: () => void;
}

/**
 * ロック取得を1回だけ試みる（リトライ・待機なし）。取得済みで stale でなければ null。
 */
export function tryAcquireLock(lockPath: string = DEFAULT_LOCK_PATH): LockHandle | null {
  try {
    mkdirSync(lockPath);
    return { release: () => releaseLock(lockPath) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  try {
    const stat = statSync(lockPath);
    if (isLockStale(stat.mtimeMs, Date.now())) {
      rmdirSync(lockPath);
      mkdirSync(lockPath);
      return { release: () => releaseLock(lockPath) };
    }
  } catch {
    // stat/rmdir失敗 = 他プロセスが並行して操作中の可能性。安全側で取得失敗扱いにする。
  }
  return null;
}

/**
 * ジョブキューのワーカー（pipeline/jobQueue.ts）向け: lockを取得せず、現在埋まっていそうかだけを
 * 読み取り専用で確認する（副作用なし。mkdir/rmdirは一切しない）。ワーカーはこれで「空いていそう」
 * と判断した場合のみ、通常どおりパイプライン関数（自前でtryAcquireLockする）を呼び出す。
 * peekしてから実際のacquireまでの間に他プロセスが割り込む極小のレース窓は残るが、その場合は
 * パイプライン側が通常の「デイリージョブ実行中です」でerror終了するだけで安全（DESIGN.md参照）。
 */
export function isLockHeld(lockPath: string = DEFAULT_LOCK_PATH): boolean {
  let stat;
  try {
    stat = statSync(lockPath);
  } catch {
    return false; // 存在しない = 空き
  }
  return !isLockStale(stat.mtimeMs, Date.now());
}

export function releaseLock(lockPath: string = DEFAULT_LOCK_PATH): void {
  try {
    rmdirSync(lockPath);
  } catch {
    // 既に無い/権限エラー等は無視（次回のstale判定が最終的に救済する）
  }
}

export interface AcquireLockWithWaitOptions {
  maxWaitMs?: number;
  intervalMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 20_000;

/**
 * アワードリサーチ(P5)専用: デイリー/他Studioジョブと同じ researchman-git.lock を、
 * 即時失敗ではなく一定間隔でポーリングしながら最大 maxWaitMs 待って取得する
 * （caseResearch.ts等の既存パイプラインは「Studioはユーザーが待っているUIなので即時失敗」
 * という前提だが、アワードは低優先バックグラウンドジョブのため、他ジョブの完了を
 * 待てばよい。待機自体はP1〜P4では一切行わず、P5でロックが必要になった時点でのみ
 * この関数を使う — awardResearch.ts参照）。maxWaitMs超過でもロックを取得できなければ
 * null（呼び出し側でエラー扱いにする）。
 */
export async function acquireLockWithWait(
  lockPath: string = DEFAULT_LOCK_PATH,
  options: AcquireLockWithWaitOptions = {},
): Promise<LockHandle | null> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const handle = tryAcquireLock(lockPath);
    if (handle) return handle;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

export interface LockResolution {
  lock: LockHandle | null;
  /** true ならこの呼び出し元が取得した（=このスコープの終わりで自分がrelease責任を持つ）。
   * externalLockを渡された場合はfalse（release責任は呼び出し元に残る）。 */
  ownsLock: boolean;
}

/**
 * 「両方」（Case→Tech直列実行）でのlock取得→解放→再取得ギャップ対策
 * （adversarial-reviewer指摘#2: Caseがlockを解放してからTechが再取得するまでの間に
 * デイリージョブがlockを奪うと「両方」がCaseのみ反映に degrade する）。
 * combinedResearch.ts が1回だけ acquire() してCase/Tech両方の実行関数へ
 * externalLock として渡すことで、個々のパイプラインは再取得も自分でのreleaseもしない
 * （ownsLock=falseなら呼び出し元のfinallyでrelease）。単独実行時（externalLock未指定）は
 * 従来どおり自前で取得・解放する。
 */
export function resolveLock(
  externalLock: LockHandle | undefined,
  acquire: () => LockHandle | null,
): LockResolution {
  if (externalLock) return { lock: externalLock, ownsLock: false };
  return { lock: acquire(), ownsLock: true };
}
