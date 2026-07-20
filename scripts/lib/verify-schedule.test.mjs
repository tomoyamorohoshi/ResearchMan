// scripts/lib/verify-schedule.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/verify-schedule.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { latestIncident, dueVerification } from "./verify-schedule.mjs";

const INCIDENTS = [
  { at: "2026-07-01T00:00:00+09:00", kind: "studio-down", recovered: true, detail: "old" },
  { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "latest" },
  { at: "2026-07-10T00:00:00+09:00", kind: "studio-down", recovered: true, detail: "mid" },
];

test("latestIncident: at が最も新しいものを返す（配列の並び順に依存しない）", () => {
  assert.equal(latestIncident(INCIDENTS).detail, "latest");
});

test("latestIncident: 空配列・undefinedはnull", () => {
  assert.equal(latestIncident([]), null);
  assert.equal(latestIncident(undefined), null);
});

test("dueVerification: +1日は true", () => {
  assert.equal(dueVerification(INCIDENTS, "2026-07-22"), true);
});

test("dueVerification: +3日は true", () => {
  assert.equal(dueVerification(INCIDENTS, "2026-07-24"), true);
});

test("dueVerification: +7日は true", () => {
  assert.equal(dueVerification(INCIDENTS, "2026-07-28"), true);
});

test("dueVerification: +1/+3/+7以外はfalse", () => {
  assert.equal(dueVerification(INCIDENTS, "2026-07-21"), false); // 当日
  assert.equal(dueVerification(INCIDENTS, "2026-07-23"), false); // +2
  assert.equal(dueVerification(INCIDENTS, "2026-07-25"), false); // +4
  assert.equal(dueVerification(INCIDENTS, "2026-07-29"), false); // +8
});

test("dueVerification: インシデントが無ければfalse", () => {
  assert.equal(dueVerification([], "2026-07-22"), false);
  assert.equal(dueVerification(undefined, "2026-07-22"), false);
});

test("dueVerification: at が不正な日付文字列ならfalse（例外を投げない）", () => {
  assert.equal(dueVerification([{ at: "not-a-date", kind: "studio-down" }], "2026-07-22"), false);
});
