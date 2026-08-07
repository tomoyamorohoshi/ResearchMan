/**
 * `git push` を1回だけ、ロック保護つきで試みる軽量ヘルパー（scripts/watchdog.mjs の
 * checkUnpushedCommits 専用）。
 *
 * scripts/lib/watchdog-git.mjs の acquireLock/releaseLock（`os.tmpdir()/researchman-git.lock`
 * をmkdirSyncで取得、stale閾値5400秒、Atomics.waitでの同期sleep）と同じロックドメインを
 * 使うコピー。watchdog-git.mjs側は内部関数としてexportしていないため、ここに複製した
 * （設計指示どおり。既存関数を無理に使い回さない）。
 *
 * 未pushコミットの検知〜監査(4スクリプト)がすべて通過した後に「push詰まりからの復旧」
 * として1回だけ叩く用途のため、pull --rebaseはしない（=commitを増やさない。単純な
 * push再試行のみ）。失敗しても無限リトライしない（呼び出し側がレポートに記録するだけ）。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const LOCK_PATH = path.join(os.tmpdir(), "researchman-git.lock");
const LOCK_STALE_MS = 5400 * 1000;
const LOCK_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const LOCK_POLL_MS = 2000;

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Atomics.waitが使えない環境（無いはずだが念のため）は待たずに抜ける
  }
}

function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_PATH);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") return false;
    }
    try {
      const st = fs.statSync(LOCK_PATH);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        try {
          fs.rmdirSync(LOCK_PATH);
        } catch {}
        continue;
      }
    } catch {}
    if (Date.now() >= deadline) return false;
    sleepSync(Math.min(LOCK_POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

function releaseLock() {
  try {
    fs.rmdirSync(LOCK_PATH);
  } catch {}
}

// ロックを取得して `git push` を1回だけ試みる。例外を投げず {ok, reason} を返す。
export function pushOnce(cwd) {
  if (!acquireLock()) {
    return { ok: false, reason: "gitロック取得タイムアウト" };
  }
  try {
    // 検知側（checkUnpushedCommits）は origin/main..main を明示的に見ているため、pushも
    // 現在のcheckout状態に依存させず origin main を明示する（過去に日次ジョブが誤ブランチに
    // commitした実績があり、main以外がcheckoutされた状態でも未pushのmainを確実にpushする）。
    const push = spawnSync("git", ["push", "origin", "main"], { cwd, encoding: "utf-8" });
    if (push.status === 0) return { ok: true };
    return { ok: false, reason: `push失敗: ${(push.stderr || push.stdout || "").trim() || `exit ${push.status}`}` };
  } catch (e) {
    return { ok: false, reason: `push実行時に例外: ${e.message}` };
  } finally {
    releaseLock();
  }
}
