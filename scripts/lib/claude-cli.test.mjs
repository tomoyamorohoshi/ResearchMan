// scripts/lib/claude-cli.mjs の引数組み立てテスト（CLI は起動しない）。
// 実行: node --test scripts/lib/claude-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs } from "./claude-cli.mjs";

const disallowed = (args) => args.find((a) => a.startsWith("--disallowedTools="));

test("buildClaudeArgs: 既定の禁止ツールは従来どおり Write,Edit,NotebookEdit（Bash は含まない）", () => {
  const args = buildClaudeArgs("P", { model: "sonnet", allowedTools: "WebSearch" });
  assert.equal(disallowed(args), "--disallowedTools=Write,Edit,NotebookEdit");
  assert.ok(args.includes("--allowedTools=WebSearch"));
  assert.equal(args.at(-1), "P");
});

test("buildClaudeArgs: extraDisallowedTools で Bash を追加できる（重複なし）", () => {
  const args = buildClaudeArgs("P", { model: "sonnet", extraDisallowedTools: "Bash" });
  assert.equal(disallowed(args), "--disallowedTools=Write,Edit,NotebookEdit,Bash");
  const dup = buildClaudeArgs("P", { model: "sonnet", extraDisallowedTools: "Bash,Write" });
  assert.equal(disallowed(dup), "--disallowedTools=Write,Edit,NotebookEdit,Bash");
});
