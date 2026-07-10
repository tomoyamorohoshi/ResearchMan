/**
 * audit.ts の git 操作のうち、実git挙動への依存が強く誤りが致命的な gitRestorePaths /
 * rollbackTouchedFiles を、一時gitリポジトリのfixtureで検証する。
 *
 * adversarial-reviewer指摘#1の再発防止: `git restore -- <paths>` は既定でINDEXを
 * ソースにするため、`git add` 済み（staged）の内容に対しては実質no-op（index/working tree
 * ともに新内容のまま残る）。次のデイリーjobはpathspec無し`git commit`のためindex全体
 * （researchSources.ts等）を巻き込みcommitしてしまい「明示パスのみ」制約に違反する。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gitRestorePaths } from "./audit.js";

function makeTempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "studio-audit-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(path.join(dir, "a.txt"), "original\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test("gitRestorePaths: addでstage済みの変更もHEADへ完全に戻す（index/working tree両方）", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(path.join(dir, "a.txt"), "modified\n");
    execFileSync("git", ["add", "a.txt"], { cwd: dir });

    const result = gitRestorePaths(dir, ["a.txt"]);
    assert.equal(result.ok, true);

    const content = readFileSync(path.join(dir, "a.txt"), "utf-8");
    assert.equal(content, "original\n", "working treeがHEADへ戻っていない");

    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
    assert.equal(status.trim(), "", `indexにstaged差分が残っている: ${status}`);
  } finally {
    cleanup(dir);
  }
});

test("gitRestorePaths: add前（working treeのみの変更）でも従来どおり戻せる", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(path.join(dir, "a.txt"), "modified-not-staged\n");
    // git add はしない

    const result = gitRestorePaths(dir, ["a.txt"]);
    assert.equal(result.ok, true);

    const content = readFileSync(path.join(dir, "a.txt"), "utf-8");
    assert.equal(content, "original\n");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf-8" });
    assert.equal(status.trim(), "");
  } finally {
    cleanup(dir);
  }
});

test("gitRestorePaths: 空配列はno-op（okのみ返す）", () => {
  const dir = makeTempRepo();
  try {
    const result = gitRestorePaths(dir, []);
    assert.equal(result.ok, true);
  } finally {
    cleanup(dir);
  }
});
