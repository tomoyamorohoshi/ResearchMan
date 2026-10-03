// node --test scripts/lib/exhibition-notify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideExhibitionNotify } from "./exhibition-notify.mjs";

test("0件は routine（ダイジェスト）", () => {
  assert.deepEqual(decideExhibitionNotify({ count: 0, cases: [] }), { send: true, priority: "routine", reason: "新規追加なし（ダイジェスト用）" });
});
test("80点以上(highlight)を含む回のみ critical", () => {
  assert.equal(decideExhibitionNotify({ count: 2, cases: [{ score: 72 }, { score: 85, highlight: true }] }).priority, "critical");
});
test("70点以上は routine", () => {
  const r = decideExhibitionNotify({ count: 1, cases: [{ score: 70, highlight: false }] });
  assert.deepEqual([r.send, r.priority], [true, "routine"]);
});
test("70点未満のみは通知しない（unverified があれば routine）", () => {
  assert.equal(decideExhibitionNotify({ count: 1, cases: [{ score: 65 }] }).send, false);
  assert.equal(decideExhibitionNotify({ count: 1, cases: [{ score: 65 }], unverified: [{ title: "x" }] }).send, true);
});
