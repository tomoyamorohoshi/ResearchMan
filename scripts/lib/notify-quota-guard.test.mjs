// scripts/lib/notify-quota-guard.mjs の純関数部分（shouldSkipForQuota）の単体テスト。
// fetchQuotaUsage はネットワークI/Oのため対象外（他スクリプトと同じくI/O部分は無テストの慣習）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSkipForQuota } from "./notify-quota-guard.mjs";

test("shouldSkipForQuota: criticalは常にfalse（quotaに関わらず送信を試みる）", () => {
  assert.equal(shouldSkipForQuota(199, "critical"), false);
  assert.equal(shouldSkipForQuota(null, "critical"), false);
  assert.equal(shouldSkipForQuota(0, "critical"), false);
});

test("shouldSkipForQuota: routineでtotalUsage>=195はtrue", () => {
  assert.equal(shouldSkipForQuota(195, "routine"), true);
  assert.equal(shouldSkipForQuota(200, "routine"), true);
});

test("shouldSkipForQuota: routineでtotalUsage<195はfalse", () => {
  assert.equal(shouldSkipForQuota(194, "routine"), false);
  assert.equal(shouldSkipForQuota(0, "routine"), false);
});

test("shouldSkipForQuota: routineでtotalUsage===nullはfalse（送信を試みる）", () => {
  assert.equal(shouldSkipForQuota(null, "routine"), false);
});
