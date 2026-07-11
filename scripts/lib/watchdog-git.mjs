/**
 * ウォッチドッグ（scripts/watchdog.mjs）専用のgit操作ヘルパー。
 *
 * 2026-07-08にメインセッション側で新たなコミット(68fd009, 8117fa2)がmainに積まれた実績が
 * あるため、watchdogが行うすべてのgit操作は commit の前に必ず `git pull --rebase` する。
 * push/pull --rebaseが失敗した場合は1回だけ全体（pull --rebase→push）をリトライしてから
 * 諦める（完全な解決ではなく緩和策。それでも失敗した場合はreasonで呼び出し側に伝える）。
 * すべて spawnSync・例外を投げない設計（呼び出し側はok/reasonで結果を判定する）。
 *
 * ロックについて（敵対的レビューで検出された自己デッドロックの修正・2026-07-08）:
 * 当初はlaunchd plist側が`os.tmpdir()/researchman-git.lock`をwatchdog.mjsの実行全体にわたって
 * 保持していたが、watchdog.mjs内の項目1(10時更新の死活)が`launchctl kickstart`で
 * 他ジョブ（同じロックを使う既存3ジョブ）を起こすため、watchdogがロックを握ったまま
 * 待っても kickstart されたジョブは永遠にロックを取れず、5分待って必ずタイムアウトし、
 * 「kickstartで復旧」が常に空振りする＋その後ロック解放後に元のジョブも動いて二重実行
 * になる自己デッドロックが実測で確認された。
 * 対策として、ロックの所有権を「plistが実行全体を握る」から「この2関数が実際にgitへ
 * 書き込む直前だけ短く握る」方式に変更した。これによりwatchdog.mjsがkickstartを呼ぶ
 * 時点ではロックを保持しておらず、kickstartされたジョブは自分自身のゲート
 * （`.last-*-run.txt`の`run-if-due.mjs --daily-at`判定）で二重実行を防ぎつつ、
 * 通常どおりロックを取得して走れる。
 */
import fs from "fs";
import os from "os";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(__dirname, "..", "..");

const LOCK_PATH = path.join(os.tmpdir(), "researchman-git.lock");
// 既存3ジョブ・tuneupと同じ90分staleしきい値（kill -9等の残骸奪取）
const LOCK_STALE_MS = 5400 * 1000;
// watchdog自身のgit操作はadd/commit/pull/pushのみで短時間に終わる想定。
// 既存ジョブ（パイプライン全体を包む数十分待ち）ほど長く待つ必要はない
const LOCK_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const LOCK_POLL_MS = 2000;

// イベントループを使わない同期スリープ（このモジュールはspawnSyncベースの同期API のため）
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Atomics.waitが使えない環境（無いはずだが念のため）は待たずに抜ける
  }
}

// `os.tmpdir()/researchman-git.lock` を短時間だけ取得する。staleなら奪取。
// 取得できなければfalse（呼び出し側はロック取得失敗として扱う）。
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
        continue; // stale奪取後すぐ再トライ
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

function run(cmd, args, cwd) {
  try {
    return spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  } catch (e) {
    return { status: 1, stdout: "", stderr: e.message, error: e };
  }
}

// pull --rebase → push。失敗時は abort/reasonを返す。
function pullRebaseOnce(cwd) {
  const pull = run("git", ["pull", "--rebase"], cwd);
  if (pull.status !== 0) {
    run("git", ["rebase", "--abort"], cwd);
    return { ok: false, reason: "pull --rebase失敗" };
  }
  return { ok: true };
}

// pull --rebase → push のシーケンスを最大2回（1回リトライ）試みる。
// pushが非fast-forwardで失敗する典型要因は「pull --rebase後、pushする前に別のpushが
// 割り込んだ」ケースなので、リトライは pull --rebase からやり直す。
function pullRebaseAndPushWithRetry(cwd, attempts = 2) {
  let lastReason = "";
  for (let i = 0; i < attempts; i++) {
    const pull = pullRebaseOnce(cwd);
    if (!pull.ok) {
      lastReason = pull.reason;
      continue;
    }
    const push = run("git", ["push"], cwd);
    if (push.status === 0) return { ok: true };
    lastReason = "push失敗（コミットはローカル残存）";
  }
  return { ok: false, reason: lastReason || "pull --rebase/push失敗" };
}

// add → (差分なければ終了) → commit → [ロック取得] → pull --rebase → push（1回リトライ）→ [ロック解放]。
// ロック取得失敗時はcommitはローカルに残したまま{ok:false}を返す（呼び出し側でreasonをレポートに出す）。
export function gitSafeCommitAndPush({ addPaths, commitMessage, cwd = DEFAULT_ROOT }) {
  if (!addPaths || !addPaths.length) {
    return { ok: false, committed: false, reason: "addPaths未指定" };
  }

  const add = run("git", ["add", ...addPaths], cwd);
  if (add.status !== 0) {
    return { ok: false, committed: false, reason: `git add失敗: ${(add.stderr || add.stdout || "").trim()}` };
  }

  const diff = run("git", ["diff", "--cached", "--quiet"], cwd);
  if (diff.status === 0) {
    return { ok: true, committed: false };
  }

  const commit = run("git", ["commit", "-m", commitMessage], cwd);
  if (commit.status !== 0) {
    return { ok: false, committed: false, reason: `git commit失敗: ${(commit.stderr || commit.stdout || "").trim()}` };
  }

  if (!acquireLock()) {
    return { ok: false, committed: true, reason: "gitロック取得タイムアウト（コミットはローカル残存）" };
  }
  try {
    const result = pullRebaseAndPushWithRetry(cwd);
    if (!result.ok) return { ok: false, committed: true, reason: result.reason };
    return { ok: true, committed: true };
  } finally {
    releaseLock();
  }
}

// [ロック取得] → pull --rebase → revert --no-edit <hash> → push（1回リトライ）→ [ロック解放]。
// revert失敗時はrevert --abortしてfalse（コンフリクトの可能性をreasonに明記）。
export function gitSafeRevertAndPush({ commitHash, cwd = DEFAULT_ROOT }) {
  if (!commitHash) return { ok: false, reason: "commitHash未指定" };

  if (!acquireLock()) {
    return { ok: false, reason: "gitロック取得タイムアウト" };
  }
  try {
    const pull = pullRebaseOnce(cwd);
    if (!pull.ok) return { ok: false, reason: pull.reason };

    const revert = run("git", ["revert", "--no-edit", commitHash], cwd);
    if (revert.status !== 0) {
      run("git", ["revert", "--abort"], cwd);
      return { ok: false, reason: "revert失敗（コンフリクトの可能性）" };
    }

    // revertコミット自体は作成済みなので、以降はpushのみ1回リトライ
    // （再度revertし直す必要はない。pull --rebaseからのフルリトライにするとrevertの
    // 二重適用を招きうるため、pushだけを短く再試行する）
    let push = run("git", ["push"], cwd);
    if (push.status !== 0) {
      const retryPull = pullRebaseOnce(cwd);
      if (retryPull.ok) push = run("git", ["push"], cwd);
    }
    if (push.status !== 0) {
      return { ok: false, reason: "revertコミットはローカル残存（push失敗）" };
    }
    return { ok: true };
  } finally {
    releaseLock();
  }
}
