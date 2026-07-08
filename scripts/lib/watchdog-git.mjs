/**
 * ウォッチドッグ（scripts/watchdog.mjs）専用のgit操作ヘルパー。
 *
 * 2026-07-08にメインセッション側で新たなコミット(68fd009, 8117fa2)がmainに積まれた実績が
 * あるため、watchdogが行うすべてのgit操作は commit の前に必ず `git pull --rebase` する。
 * すべて spawnSync・例外を投げない設計（呼び出し側はok/reasonで結果を判定する）。
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(__dirname, "..", "..");

function run(cmd, args, cwd) {
  try {
    return spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  } catch (e) {
    return { status: 1, stdout: "", stderr: e.message, error: e };
  }
}

// add → (差分なければ終了) → commit → pull --rebase → push。
// pull --rebase失敗時はrebase --abortしてfalseを返す（コミットはローカルに残る）。
// push失敗時もfalse（コミットはローカルに残存。呼び出し側でreasonをレポートに出す）。
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

  const pull = run("git", ["pull", "--rebase"], cwd);
  if (pull.status !== 0) {
    run("git", ["rebase", "--abort"], cwd);
    return { ok: false, committed: true, reason: "pull --rebase失敗" };
  }

  const push = run("git", ["push"], cwd);
  if (push.status !== 0) {
    return { ok: false, committed: true, reason: "push失敗（コミットはローカル残存）" };
  }

  return { ok: true, committed: true };
}

// pull --rebase → revert --no-edit <hash> → push。
// revert失敗時はrevert --abortしてfalse（コンフリクトの可能性をreasonに明記）。
export function gitSafeRevertAndPush({ commitHash, cwd = DEFAULT_ROOT }) {
  if (!commitHash) return { ok: false, reason: "commitHash未指定" };

  const pull = run("git", ["pull", "--rebase"], cwd);
  if (pull.status !== 0) {
    run("git", ["rebase", "--abort"], cwd);
    return { ok: false, reason: "pull --rebase失敗" };
  }

  const revert = run("git", ["revert", "--no-edit", commitHash], cwd);
  if (revert.status !== 0) {
    run("git", ["revert", "--abort"], cwd);
    return { ok: false, reason: "revert失敗（コンフリクトの可能性）" };
  }

  const push = run("git", ["push"], cwd);
  if (push.status !== 0) {
    return { ok: false, reason: "revertコミットはローカル残存（push失敗）" };
  }

  return { ok: true };
}
