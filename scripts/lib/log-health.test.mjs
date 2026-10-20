// scripts/lib/log-health.mjs の findRecentJobFailure のテスト（node:test）。
// 実行: node --test scripts/lib/log-health.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findRecentJobFailure } from "./log-health.mjs";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
// run-job が書く `date` 形式: "Mon Oct 19 23:40:00 JST 2026"（ローカル時刻として書く）
const fmt = (d) => `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} JST ${d.getFullYear()}`;
const startLine = (d) => `===== Tuneup start: ${fmt(d)} =====`;

const failBlock = (d) =>
  [startLine(d), "── 分析パス1: リサーチ計画 ──", "分析パス1失敗: Claude CLI エラー: spawnSync claude.exe ENAMETOOLONG", `チューンアップエラー終了: ${fmt(d)}`, ""].join("\n");
const okBlock = (d) => [startLine(d), "反映まで確認OK", ""].join("\n");

test("findRecentJobFailure: 直近のrunが1回でもerrorなら失敗行つきで返す（連続2回を待たない）", () => {
  const now = Date.now();
  const log = okBlock(new Date(now - 9 * 86400000)) + failBlock(new Date(now - 3600000));
  const r = findRecentJobFailure(log, 2 * 86400000);
  assert.ok(r);
  assert.match(r.excerpt, /分析パス1失敗/);
});

test("findRecentJobFailure: 失敗が窓より古い／直近runが成功／ログ空なら null", () => {
  const now = Date.now();
  assert.equal(findRecentJobFailure(failBlock(new Date(now - 5 * 86400000)), 2 * 86400000), null);
  assert.equal(findRecentJobFailure(failBlock(new Date(now - 7200000)) + okBlock(new Date(now - 3600000)), 2 * 86400000), null);
  assert.equal(findRecentJobFailure("", 2 * 86400000), null);
});
