/**
 * gitロック（os.tmpdir()/researchman-git.lock ディレクトリ）の共有実装。
 * 日次ジョブ(scripts/windows/run-job.mjs)・Studio(studio/server/pipeline/lock.ts)・
 * watchdog-git.mjs・push-once.mjs が同じ判定ロジックを使う（意味の不一致を防ぐため共有）。
 *
 * 再発防止の背景（2026-09-29）: ロック保持プロセスが finally の走らない強制死をすると
 * ロックが残骸化し、mtime 90分ルールが働くまで全ジョブが停止した。そこでロック内に
 * owner.json({pid, startedAt, label})を置き、保持PIDが死んでいれば即時奪取/空き扱いにする。
 *
 * 判定（inspectLock）:
 *   free  : ロック無し
 *   dead  : owner.json が有効で PID が死亡 → 即時奪取可
 *   stale : owner.json が無い/壊れている/PIDが生存でも mtime が STALE_MS 超 → 奪取可
 *           （旧形式・書き込み途中は従来のmtimeルール。PID再利用で永久に残るのも防ぐ）
 *   held  : 上記以外（保持中）
 *
 * 注意（トレードオフ）: owner の pid は「ロックを取った本体プロセス」（run-job.mjs / Studio）。
 * 本体が強制死して子プロセス（claude等）だけが残った場合、子の生存とは無関係に奪取される
 * （クラッシュからの復帰を優先。残った子が並走してgit操作する可能性は許容する）。
 *
 * 奪取の原子性: 死亡/staleロックの掃除は「掃除人ミューテックス（lockPath + ".reap" ディレクトリのmkdir）」
 * を取った1プロセスだけが、その中で判定をやり直してから消す。判定後に他プロセスが新ロックを取り直していても
 * 壊さない（旧実装の「再確認→rmdir→mkdir」は非原子で、勝者の新ロックを別プロセスが壊せた）。
 * 取得の最終決着は常に mkdir のアトミック性なので、勝者は常に1。ミューテックスは数ms保持で、
 * 掃除人が強制死した残骸は REAP_MUTEX_STALE_MS 超で除去する。
 * 解放は owner が自分(pid+startedAt)のときだけ行う（奪取された旧保持者のfinallyが新保持者を壊さない）。
 */
import fs from "fs";
import os from "os";
import path from "path";

export const DEFAULT_LOCK_PATH = path.join(os.tmpdir(), "researchman-git.lock");
export const STALE_MS = 5400 * 1000; // 90分
export const OWNER_FILE = "owner.json";

/** PIDが生存しているか。確実に「存在しない」(ESRCH)と言えるときだけfalse。それ以外は保守的に生存扱い。 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "ESRCH" ? false : true; // EPERM等は存在する
  }
}

/** owner.json を読む。無い/壊れている/pid不正なら null。 */
export function readOwner(lockPath) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(lockPath, OWNER_FILE), "utf-8"));
    if (o && Number.isInteger(o.pid) && o.pid > 0) return o;
  } catch {}
  return null;
}

export function inspectLock(lockPath, now = Date.now(), staleMs = STALE_MS) {
  let st;
  try {
    st = fs.statSync(lockPath);
  } catch {
    return { state: "free", owner: null, mtimeMs: 0 };
  }
  const owner = readOwner(lockPath);
  if (owner && !isPidAlive(owner.pid)) return { state: "dead", owner, mtimeMs: st.mtimeMs };
  if (now - st.mtimeMs > staleMs) return { state: "stale", owner, mtimeMs: st.mtimeMs };
  return { state: "held", owner, mtimeMs: st.mtimeMs };
}

/** 空き扱い（free/dead/stale）なら false、保持中なら true。読み取り専用。 */
export function isHeld(lockPath = DEFAULT_LOCK_PATH) {
  const s = inspectLock(lockPath).state;
  return s === "held";
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}

/**
 * owner.json を消してから rmdir（非空でも消せる）。例外は投げない。無条件削除なので、
 * 自分の所有か確認済みの箇所（奪取後のtombstone等）でのみ使う。通常の解放は releaseOwnedLock。
 * WindowsのEBUSY/EPERM対策で rmdir は短くリトライする（失敗放置だとowner無しの空ロック=90分待ちに退化する）。
 */
export function removeLockDir(lockPath = DEFAULT_LOCK_PATH) {
  try {
    fs.unlinkSync(path.join(lockPath, OWNER_FILE));
  } catch {}
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmdirSync(lockPath);
      return;
    } catch (e) {
      if (e.code === "ENOENT") return;
      sleepSync(20);
    }
  }
}

// このプロセスが取得したロック: lockPath -> owner.jsonに書いたstartedAt（書けなかった場合は null）
const ownedByThisProcess = new Map();

/** 自分(pid+startedAt)が取得したロックのときだけ解放する。奪取されて他者のものなら何もしない。 */
export function releaseOwnedLock(lockPath = DEFAULT_LOCK_PATH) {
  if (!ownedByThisProcess.has(lockPath)) return;
  const startedAt = ownedByThisProcess.get(lockPath);
  ownedByThisProcess.delete(lockPath);
  const owner = readOwner(lockPath);
  if (owner) {
    if (owner.pid !== process.pid || owner.startedAt !== startedAt) return; // 他者のロック
  } else if (startedAt !== null) {
    return; // 自分が書いたownerが消えている=奪取済み（または破壊済み）。触らない
  }
  removeLockDir(lockPath);
}

function writeOwner(lockPath, label) {
  const startedAt = new Date().toISOString();
  try {
    fs.writeFileSync(path.join(lockPath, OWNER_FILE), JSON.stringify({ pid: process.pid, startedAt, label }));
    return startedAt;
  } catch {
    // 書けなくてもロック自体は取得済み。owner無し=旧形式扱い(mtimeルール)にフォールバックするだけ。
    return null;
  }
}

const REAP_MUTEX_STALE_MS = 30 * 1000;

/**
 * 掃除人ミューテックスを取り、その中で判定をやり直して dead/stale なら消す。
 * 戻り値: 掃除した場合は判定スナップショット、それ以外（他の掃除人が作業中・保持中・既に空き）は null。
 */
function reap(lockPath, log) {
  const mutex = `${lockPath}.reap`;
  try {
    fs.mkdirSync(mutex);
  } catch (e) {
    if (e.code === "EEXIST") {
      try {
        if (Date.now() - fs.statSync(mutex).mtimeMs > REAP_MUTEX_STALE_MS) fs.rmdirSync(mutex); // 強制死した掃除人の残骸
      } catch {}
    }
    return null;
  }
  try {
    const snap = inspectLock(lockPath); // ミューテックス内で判定し直す（判定〜削除の間に取り直された新ロックを壊さない）
    if (snap.state !== "dead" && snap.state !== "stale") return null;
    if (snap.state === "dead") log(`死亡ロック奪取: pid=${snap.owner.pid} label=${snap.owner.label ?? "?"}`);
    else log(`staleロック奪取: ${new Date().toISOString()}`);
    removeLockDir(lockPath);
    return snap;
  } finally {
    try {
      fs.rmdirSync(mutex);
    } catch {}
  }
}

/**
 * ロック取得を1回だけ試みる（待機なし）。空き/死亡/staleなら奪取して true。保持中なら false。
 * 他の掃除人と競合したときだけ数msのリトライを行う。
 */
export function tryAcquire(lockPath = DEFAULT_LOCK_PATH, label = "unknown", opts = {}) {
  const log = opts.log ?? (() => {});
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      fs.mkdirSync(lockPath);
      ownedByThisProcess.set(lockPath, writeOwner(lockPath, label));
      return true;
    } catch (e) {
      if (e.code === "EEXIST") {
        // 通常経路
      } else if (e.code === "EPERM" || e.code === "EACCES" || e.code === "EBUSY") {
        sleepSync(10); // Windowsで削除/リネーム途中のパスへのmkdirは一時的にEPERMになる
        continue;
      } else {
        throw e;
      }
    }
    const snap = inspectLock(lockPath);
    if (snap.state === "held") return false;
    if (snap.state === "free") continue; // 直前に解放された。再mkdir
    if (!reap(lockPath, log)) sleepSync(10); // 他の掃除人が作業中。少し待って再判定
  }
  return false;
}

/**
 * 残骸ロック（dead/stale）を掃除する。掃除したら {state, ageSec}、保持中/無し/他者が先に処理したら null。
 * owner.json入りの非空ディレクトリでも掃除できる（watchdog.mjs の cleanupStaleGitLock 用）。
 */
export function cleanupStaleLock(lockPath = DEFAULT_LOCK_PATH, now = Date.now()) {
  const pre = inspectLock(lockPath, now);
  if (pre.state !== "dead" && pre.state !== "stale") return null;
  const snap = reap(lockPath, () => {});
  if (!snap) return null;
  return { state: snap.state, ageSec: (now - pre.mtimeMs) / 1000 };
}
