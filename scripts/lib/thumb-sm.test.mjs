// 縮小サムネ生成の「作り直し判定」「出力ファイル名」の単体テスト。
// 実行: node --test scripts/lib/thumb-sm.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRebuild, smFileName } from "./thumb-sm.mjs";

test("縮小版が無ければ作る", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: null }), true);
});

test("元画像が新しければ作り直す", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 200, smMtimeMs: 100 }), true);
});

test("縮小版が同時刻以降ならスキップ（冪等）", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: 100 }), false);
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: 200 }), false);
});

test("force なら常に作る", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 100, smMtimeMs: 200, force: true }), true);
});

test("missingOnly なら縮小版があれば元が新しくてもスキップ、無ければ作る", () => {
  assert.equal(needsRebuild({ srcMtimeMs: 200, smMtimeMs: 100, missingOnly: true }), false);
  assert.equal(needsRebuild({ srcMtimeMs: 200, smMtimeMs: null, missingOnly: true }), true);
});

test("smFileName: jpg/jpeg を .webp に", () => {
  assert.equal(smFileName("a-b.jpg"), "a-b.webp");
  assert.equal(smFileName("a.JPEG"), "a.webp");
  assert.equal(smFileName("a.png"), null);
});
