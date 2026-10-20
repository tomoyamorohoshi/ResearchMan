// scripts/lib/claude-cli.mjs の引数組み立てテスト（CLI は起動しない）。
// 実行: node --test scripts/lib/claude-cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, runClaude } from "./claude-cli.mjs";

const disallowed = (args) => args.find((a) => a.startsWith("--disallowedTools="));

test("buildClaudeArgs: 既定の禁止ツールは従来どおり Write,Edit,NotebookEdit（Bash は含まない）", () => {
  const args = buildClaudeArgs({ model: "sonnet", allowedTools: "WebSearch" });
  assert.equal(disallowed(args), "--disallowedTools=Write,Edit,NotebookEdit");
  assert.ok(args.includes("--allowedTools=WebSearch"));
  // プロンプトは引数に含めない（stdin 渡し。Windows のコマンドライン長上限 ENAMETOOLONG 対策）
  assert.equal(args.at(-1), "--dangerously-skip-permissions");
});

test("buildClaudeArgs: extraDisallowedTools で Bash を追加できる（重複なし）", () => {
  const args = buildClaudeArgs({ model: "sonnet", extraDisallowedTools: "Bash" });
  assert.equal(disallowed(args), "--disallowedTools=Write,Edit,NotebookEdit,Bash");
  const dup = buildClaudeArgs({ model: "sonnet", extraDisallowedTools: "Bash,Write" });
  assert.equal(disallowed(dup), "--disallowedTools=Write,Edit,NotebookEdit,Bash");
});

test("runClaude: 4万文字超のプロンプトも argv に含めず stdin(input) で渡す", () => {
  const prompt = "あ".repeat(45000) + "END";
  let captured;
  const fakeSpawn = (bin, args, opts) => {
    captured = { bin, args, opts };
    return { status: 0, stdout: "OK", stderr: "" };
  };
  const out = runClaude("claude", prompt, { timeout: 1234, model: "sonnet", allowedTools: "WebSearch" }, fakeSpawn);
  assert.equal(out, "OK");
  assert.ok(captured.args.every((a) => !a.includes("END") && a.length < 200), "argv にプロンプトが入っていない");
  assert.equal(captured.opts.input, prompt);
  assert.equal(captured.opts.timeout, 1234);
  assert.equal(captured.opts.stdio[0], "pipe");
  assert.ok(captured.args.includes("--print"));
});

test("runClaude: 終了コード非0・spawnエラーは従来どおり例外", () => {
  assert.throws(() => runClaude("c", "p", { model: "m" }, () => ({ status: 1, stdout: "o", stderr: "e" })), /終了コード 1/);
  assert.throws(() => runClaude("c", "p", { model: "m" }, () => ({ error: new Error("boom") })), /Claude CLI エラー: boom/);
});
