// scripts/lib/branch-guard.mjs の純関数部分の単体テスト（node:test）。
// git実行を含まない parseCurrentBranch / isMainBranch だけを対象にする
// （git実行を含む部分はrun-job.mjs側に置き、ここではテストしない）。
// 実行: node --test scripts/lib/branch-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMainBranch, parseCurrentBranch } from "./branch-guard.mjs";

test("isMainBranch: main は true", () => {
  assert.equal(isMainBranch("main"), true);
});

test("isMainBranch: main以外はfalse", () => {
  assert.equal(isMainBranch("mcp-oauth-spike"), false);
  assert.equal(isMainBranch("master"), false);
  assert.equal(isMainBranch(""), false);
  assert.equal(isMainBranch(undefined), false);
  assert.equal(isMainBranch(null), false);
});

test("parseCurrentBranch: git rev-parse --abbrev-ref HEAD の出力（末尾改行）からブランチ名を取り出す", () => {
  assert.equal(parseCurrentBranch("main\n"), "main");
  assert.equal(parseCurrentBranch("mcp-oauth-spike\r\n"), "mcp-oauth-spike");
});

test("parseCurrentBranch: 前後の空白も除去する", () => {
  assert.equal(parseCurrentBranch("  feature/x  \r\n"), "feature/x");
});

test("parseCurrentBranch: 空文字・undefinedは空文字を返す", () => {
  assert.equal(parseCurrentBranch(""), "");
  assert.equal(parseCurrentBranch(undefined), "");
});
