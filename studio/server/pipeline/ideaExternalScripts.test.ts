/**
 * ideaExternalScripts.ts::runSearchCases の単体テスト。
 *
 * 独立レビュー指摘#1: 従来は spawnSync で scripts/search-cases.mjs（読み取り専用・
 * ネットワークなしの高速スクリプト）を呼んでいたが、これも他のspawnSync同様イベントループを
 * ブロックする。audit.ts::run()（非同期spawn）経由に置き換えたことを、実際にscripts/
 * search-cases.mjsを起動しつつイベントループが生きていることで確認する
 * （search-cases.mjs自体は読み取り専用でデータを変更しないため実行して安全）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runSearchCases } from "./ideaExternalScripts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root

test("runSearchCases: 実行中もイベントループがブロックされない（非同期spawn）", async () => {
  const ticks: number[] = [];
  const timer = setInterval(() => ticks.push(Date.now()), 20);
  try {
    const hits = await runSearchCases(ROOT, ["新聞"], 5);
    assert.ok(Array.isArray(hits));
    assert.ok(ticks.length >= 1, `イベントループがブロックされていた可能性がある（tick数=${ticks.length}）`);
  } finally {
    clearInterval(timer);
  }
});

test("runSearchCases: キーワードにヒットする実データを返す（機能そのものの回帰確認）", async () => {
  const hits = await runSearchCases(ROOT, ["新聞"], 5);
  assert.ok(hits.length > 0, "data/cases.jsonに「新聞」関連事例が実在する前提");
  assert.ok(hits[0].id);
});

test("runSearchCases: キーワード空配列は子プロセスを起動せず空配列を返す", async () => {
  const hits = await runSearchCases(ROOT, [], 5);
  assert.deepEqual(hits, []);
});

test("runSearchCases: 空白のみのキーワードは除外される", async () => {
  const hits = await runSearchCases(ROOT, ["  ", ""], 5);
  assert.deepEqual(hits, []);
});

// ── 同期ヘルパのimport不使用の確認（独立レビュー指摘#1） ─────────────────
// ideaResearch.ts・ideaExternalScripts.ts のソース自体に spawnSync が残っていないことを
// 静的に確認する（P4当初実装のP4#1修正後もこの2ファイルにspawnSyncが残っていた回帰の
// 再発防止）。
// spawnSync( という「呼び出し」構文だけを検出する（説明コメント中の語としての言及は
// 誤検知しないよう、関数呼び出し形のみを対象にする）。
const SPAWN_SYNC_CALL_RE = /\bspawnSync\s*\(/;

test("ideaExternalScripts.ts のソースに spawnSync 呼び出しが残っていない", () => {
  const src = readFileSync(path.join(__dirname, "ideaExternalScripts.ts"), "utf-8");
  assert.doesNotMatch(src, SPAWN_SYNC_CALL_RE);
});

test("ideaResearch.ts のソースに spawnSync呼び出し・run-idea-layouts-precompute.mjsの直接importが残っていない", () => {
  const src = readFileSync(path.join(__dirname, "ideaResearch.ts"), "utf-8");
  assert.doesNotMatch(src, SPAWN_SYNC_CALL_RE);
  assert.doesNotMatch(src, /from ["'].*run-idea-layouts-precompute\.mjs["']/);
});
