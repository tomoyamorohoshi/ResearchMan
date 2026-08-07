// scripts/lib/push-once.mjs の単体テスト（node:test）。
// 実git操作を伴うため、os.tmpdir()配下に使い捨てのbareリポジトリ(origin)と
// 作業クローンを作成して検証する（本番リポジトリ・logs配下は一切触らない）。
// 実行: node --test scripts/lib/push-once.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { pushOnce } from "./push-once.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

function setupOriginAndClone(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `researchman-push-once-${tag}-`));
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
  git(["push", "origin", "main"], workDir);

  return { base, originDir, workDir };
}

test("pushOnce: git push origin main で明示的にmainブランチをpushする（引数なしgit pushではない）", () => {
  const { base, originDir, workDir } = setupOriginAndClone("basic");
  try {
    fs.writeFileSync(path.join(workDir, "file.txt"), "updated\n");
    git(["commit", "-am", "update"], workDir);
    const localMainHead = git(["rev-parse", "main"], workDir).trim();

    const result = pushOnce(workDir);
    assert.equal(result.ok, true);

    const originMainHead = git(["rev-parse", "refs/heads/main"], originDir).trim();
    assert.equal(originMainHead, localMainHead);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("pushOnce: mainではない別ブランチをcheckoutした状態でも、未pushのmainをoriginへ反映する", () => {
  // このリポジトリで過去に「日次ジョブが誤ブランチにcommitした」実績があり、
  // watchdogのpush再試行時にcheckoutがmainでない状況が現実に起こりうる。
  // `git push`（引数なし）だと現在のcheckoutブランチがpushされてしまい、
  // 未pushのmainが放置される（本テストが検知するバグ）。
  const { base, originDir, workDir } = setupOriginAndClone("other-branch");
  try {
    // mainに未pushコミットを積む
    fs.writeFileSync(path.join(workDir, "file.txt"), "updated-on-main\n");
    git(["commit", "-am", "update main"], workDir);
    const localMainHead = git(["rev-parse", "main"], workDir).trim();

    // 別ブランチへcheckoutした状態でpushOnceを呼ぶ（mainではない）
    git(["checkout", "-b", "other-branch"], workDir);
    assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], workDir).trim(), "other-branch");

    const result = pushOnce(workDir);
    assert.equal(result.ok, true);

    // originのmainが更新されていること（other-branchがpushされたのではない）
    const originMainHead = git(["rev-parse", "refs/heads/main"], originDir).trim();
    assert.equal(originMainHead, localMainHead);

    // other-branchはoriginに存在しない（pushOnceがcurrent branchをpushしていないこと）
    let otherBranchExists = true;
    try {
      git(["rev-parse", "refs/heads/other-branch"], originDir);
    } catch {
      otherBranchExists = false;
    }
    assert.equal(otherBranchExists, false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
