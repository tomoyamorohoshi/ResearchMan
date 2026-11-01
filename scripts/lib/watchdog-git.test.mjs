// scripts/lib/watchdog-git.mjs の gitSafeCommitAndPush のテスト（node:test）。
// 使い捨てのbare origin＋作業クローン＋テスト専用lockPathで検証する（本番ロックは使わない）。
// 実行: node --test scripts/lib/watchdog-git.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { gitSafeCommitAndPush } from "./watchdog-git.mjs";
import { tryAcquire, releaseOwnedLock } from "./git-lock.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function setup(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `researchman-wdgit-${tag}-`));
  const originDir = path.join(base, "origin.git");
  const workDir = path.join(base, "work");
  fs.mkdirSync(originDir);
  git(["init", "--bare", "-b", "main", originDir], base);
  git(["init", "-b", "main", workDir], base);
  git(["config", "user.email", "test@example.com"], workDir);
  git(["config", "user.name", "Test"], workDir);
  git(["remote", "add", "origin", originDir], workDir);
  fs.writeFileSync(path.join(workDir, "file.txt"), "init\n");
  git(["add", "file.txt"], workDir);
  git(["commit", "-m", "init"], workDir);
  git(["push", "-u", "origin", "main"], workDir);
  return { base, workDir, lockPath: path.join(base, "test-git.lock") };
}

test("gitSafeCommitAndPush: ロックが他者に保持されている間は add も commit もしない", () => {
  const { base, workDir, lockPath } = setup("held");
  try {
    assert.ok(tryAcquire(lockPath, "test-holder"));
    try {
      fs.writeFileSync(path.join(workDir, "file.txt"), "someone else's work in progress\n");
      const headBefore = git(["rev-parse", "HEAD"], workDir);
      const r = gitSafeCommitAndPush({
        addPaths: ["file.txt"],
        commitMessage: "should not happen",
        cwd: workDir,
        lockPath,
        lockWaitMs: 300,
      });
      assert.deepEqual(r, { ok: false, committed: false, reason: "gitロック取得タイムアウト（未コミット）" });
      assert.equal(git(["rev-parse", "HEAD"], workDir), headBefore);
      assert.equal(git(["diff", "--cached", "--name-only"], workDir), "");
    } finally {
      releaseOwnedLock(lockPath);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("gitSafeCommitAndPush: ロックが空いていればcommit→pushし、ロックを解放する", () => {
  const { base, workDir, lockPath } = setup("free");
  try {
    fs.writeFileSync(path.join(workDir, "file.txt"), "updated\n");
    const r = gitSafeCommitAndPush({ addPaths: ["file.txt"], commitMessage: "upd", cwd: workDir, lockPath, lockWaitMs: 300 });
    assert.deepEqual(r, { ok: true, committed: true });
    assert.equal(git(["rev-parse", "HEAD"], workDir), git(["rev-parse", "origin/main"], workDir));
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("gitSafeCommitAndPush: 差分なしなら committed:false で ok、ロックは解放される", () => {
  const { base, workDir, lockPath } = setup("nodiff");
  try {
    const r = gitSafeCommitAndPush({ addPaths: ["file.txt"], commitMessage: "x", cwd: workDir, lockPath, lockWaitMs: 300 });
    assert.deepEqual(r, { ok: true, committed: false });
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
