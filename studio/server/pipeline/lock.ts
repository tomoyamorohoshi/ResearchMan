/**
 * デイリー3ジョブ（launchd）と共有する git 排他ロック（/tmp/researchman-git.lock）の
 * Studio側実装。DESIGN.md §「lock」: Studioは待機ループをせず、取得できなければ
 * 即座にジョブをerror扱いにする（デイリー側は最大30分待つが、Studioはユーザーが
 * 画面の前で待っているUIなので即時失敗の方が適切）。
 * stale判定（90分超過）はデイリーのplist（launchd/com.researchman.autoresearch.plist）の
 * 閾値5400秒と同じにして、クラッシュ後の残骸を双方が同じ基準で救済できるようにする。
 */
import { mkdirSync, rmdirSync, statSync } from "node:fs";

export const DEFAULT_LOCK_PATH = "/tmp/researchman-git.lock";
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

export function releaseLock(lockPath: string = DEFAULT_LOCK_PATH): void {
  try {
    rmdirSync(lockPath);
  } catch {
    // 既に無い/権限エラー等は無視（次回のstale判定が最終的に救済する）
  }
}
