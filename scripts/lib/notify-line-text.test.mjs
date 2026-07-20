// scripts/lib/notify-line-text.mjs の純関数部分の単体テスト（node:test）。
// 実行: node --test scripts/lib/notify-line-text.test.mjs
//
// 背景: job 66218d63のStudioジョブ失敗で送られたエラー通知が「本日分はスキップし、
// 明日10時に再実行します」という日次ジョブ専用の文言だったが、Studio(LINE単発)ジョブには
// 「明日」という概念が無く、実際には嘘の案内だった。呼び出し元（daily=run-job.mjs経由 /
// studio=studio側パイプライン経由）で本文を出し分ける。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildErrorBodyLines } from "./notify-line-text.mjs";

test("buildErrorBodyLines: context省略（daily既定）は従来どおり「明日10時に再実行」文言", () => {
  const lines = buildErrorBodyLines(undefined, "darwin");
  assert.deepEqual(lines, [
    "本日分はスキップし、明日10時に再実行します。",
    "ログ: ~/Library/Logs/researchman-*.log",
  ]);
});

test("buildErrorBodyLines: context=daily はplatformに応じてログパスを出し分ける（Windows）", () => {
  const lines = buildErrorBodyLines("daily", "win32");
  assert.deepEqual(lines, [
    "本日分はスキップし、明日10時に再実行します。",
    "ログ: ~/.researchman/logs/researchman-*.log",
  ]);
});

test("buildErrorBodyLines: context=studio はStudio専用の再実行案内になる（日次専用文言を含まない）", () => {
  const lines = buildErrorBodyLines("studio", "win32");
  assert.deepEqual(lines, ["LINEから同じ依頼を再送すると再実行できます"]);
  assert.ok(!lines.join("\n").includes("明日10時"));
});
