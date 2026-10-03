// scripts/lib/exhibition-status.mjs の単体テスト（SPEC §3.2 / §11）。
// 実行: node --test scripts/lib/exhibition-status.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, todayJst, daysBetween, isValidYmd } from "./exhibition-status.mjs";

test("computeStatus: 開始前日は upcoming", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-04"), "upcoming");
});
test("computeStatus: 開始日は ongoing", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-05"), "ongoing");
});
test("computeStatus: 会期中は ongoing", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-12"), "ongoing");
});
test("computeStatus: 終了日当日は ongoing", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-20"), "ongoing");
});
test("computeStatus: 終了翌日は ended", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-20", "2026-10-21"), "ended");
});
test("computeStatus: 年またぎ会期", () => {
  assert.equal(computeStatus("2026-12-20", "2027-01-11", "2026-12-31"), "ongoing");
  assert.equal(computeStatus("2026-12-20", "2027-01-11", "2027-01-11"), "ongoing");
  assert.equal(computeStatus("2026-12-20", "2027-01-11", "2027-01-12"), "ended");
  assert.equal(computeStatus("2026-12-20", "2027-01-11", "2026-12-19"), "upcoming");
});
test("computeStatus: 単日開催（start==end）", () => {
  assert.equal(computeStatus("2026-10-05", "2026-10-05", "2026-10-05"), "ongoing");
  assert.equal(computeStatus("2026-10-05", "2026-10-05", "2026-10-06"), "ended");
});

test("todayJst: UTC 14:59:59 は同日、15:00:00 で翌日（JST境界）", () => {
  assert.equal(todayJst(new Date("2026-10-04T14:59:59Z")), "2026-10-04");
  assert.equal(todayJst(new Date("2026-10-04T15:00:00Z")), "2026-10-05");
});
test("todayJst: 年末の JST 境界で年が変わる", () => {
  assert.equal(todayJst(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
});
test("todayJst: 引数省略で YYYY-MM-DD", () => {
  assert.match(todayJst(), /^\d{4}-\d{2}-\d{2}$/);
});
test("JST境界: UTC 15:00 をまたぐと終了日翌日扱いになる", () => {
  const end = "2026-10-20";
  assert.equal(computeStatus("2026-10-05", end, todayJst(new Date("2026-10-20T14:59:00Z"))), "ongoing");
  assert.equal(computeStatus("2026-10-05", end, todayJst(new Date("2026-10-20T15:00:00Z"))), "ended");
});

test("daysBetween: 日数差（b - a）", () => {
  assert.equal(daysBetween("2026-10-04", "2026-10-04"), 0);
  assert.equal(daysBetween("2026-10-04", "2026-10-11"), 7);
  assert.equal(daysBetween("2026-10-11", "2026-10-04"), -7);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2); // うるう年
});

test("isValidYmd: 実在する YYYY-MM-DD のみ true", () => {
  assert.equal(isValidYmd("2026-10-04"), true);
  assert.equal(isValidYmd("2028-02-29"), true);
  assert.equal(isValidYmd("2026-02-29"), false);
  assert.equal(isValidYmd("2026-13-01"), false);
  assert.equal(isValidYmd("2026-10-32"), false);
  assert.equal(isValidYmd("2026-1-4"), false);
  assert.equal(isValidYmd("2026/10/04"), false);
  assert.equal(isValidYmd(""), false);
  assert.equal(isValidYmd(undefined), false);
  assert.equal(isValidYmd(20261004), false);
});
