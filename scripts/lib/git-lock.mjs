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
    return { state: "free", owner: null };
  }
  const owner = readOwner(lockPath);
  if (owner && !isPidAlive(owner.pid)) return { state: "dead", owner };
  if (now - st.mtimeMs > staleMs) return { state: "stale", owner };
  return { state: "held", owner };
}

/** 空き扱い（free/dead/stale）なら false、保持中なら true。読み取り専用。 */
export function isHeld(lockPath = DEFAULT_LOCK_PATH) {
  const s = inspectLock(lockPath).state;
  return s === "held";
}

/** owner.json を消してから rmdir（ロックディレクトリが非空でも解放できる）。例外は投げない。 */
export function removeLockDir(lockPath = DEFAULT_LOCK_PATH) {
  try {
    fs.unlinkSync(path.join(lockPath, OWNER_FILE));
  } catch {}
  try {
    fs.rmdirSync(lockPath);
  } catch {}
}

function writeOwner(lockPath, label) {
  try {
    fs.writeFileSync(
      path.join(lockPath, OWNER_FILE),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), label }),
    );
  } catch {
    // 書けなくてもロック自体は取得済み。owner無し=旧形式扱い(mtimeルール)にフォールバックするだけ。
  }
}

/**
 * ロック取得を1回だけ試みる（待機なし）。空き/死亡/staleなら奪取して true。保持中なら false。
 * 奪取は「判定時と同じownerのままか」を再確認してから行い、他者が取り直した新品ロックの破壊を避ける。
 */
export function tryAcquire(lockPath = DEFAULT_LOCK_PATH, label = "unknown", opts = {}) {
  const log = opts.log ?? (() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lockPath);
      writeOwner(lockPath, label);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const { state, owner } = inspectLock(lockPath);
    if (state === "held") return false;
    if (state === "free") continue; // 直前に解放された。再mkdir
    // dead / stale: 再確認（判定後に別プロセスが奪取・再取得していないか）
    const again = readOwner(lockPath);
    if ((again && again.pid) !== (owner && owner.pid) || (again && again.startedAt) !== (owner && owner.startedAt)) return false;
    if (state === "dead") log(`死亡ロック奪取: pid=${owner.pid} label=${owner.label ?? "?"}`);
    else log(`staleロック奪取: ${new Date().toISOString()}`);
    removeLockDir(lockPath);
  }
  return false;
}
