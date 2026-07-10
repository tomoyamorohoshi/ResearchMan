/**
 * budget.ts の純粋関数テスト（node:test）。
 * DESIGN.md §8「コスト: ジョブ単位の予算上限（超過で停止・LINE通知）」の判定ロジック。
 * 上限発火はここ（ユニットテスト）でのみ検証する。実ジョブでは発火させない
 * （STUDIO_JOB_BUDGET_USD の既定 $5 は通常のジョブコストより十分大きい）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BudgetExceededError, DEFAULT_JOB_BUDGET_USD, assertWithinBudget, resolveJobBudgetUsd } from "./budget.js";

// ── resolveJobBudgetUsd ──────────────────────────────────────────
test("resolveJobBudgetUsd: 環境変数未設定は既定値($5)", () => {
  assert.equal(resolveJobBudgetUsd({}), DEFAULT_JOB_BUDGET_USD);
  assert.equal(DEFAULT_JOB_BUDGET_USD, 5);
});

test("resolveJobBudgetUsd: STUDIO_JOB_BUDGET_USD で上書きできる", () => {
  assert.equal(resolveJobBudgetUsd({ STUDIO_JOB_BUDGET_USD: "12.5" }), 12.5);
});

test("resolveJobBudgetUsd: 数値化できない値は既定値にフォールバック", () => {
  assert.equal(resolveJobBudgetUsd({ STUDIO_JOB_BUDGET_USD: "abc" }), DEFAULT_JOB_BUDGET_USD);
});

test("resolveJobBudgetUsd: 0以下の値は既定値にフォールバック（予算0は誤設定とみなす）", () => {
  assert.equal(resolveJobBudgetUsd({ STUDIO_JOB_BUDGET_USD: "0" }), DEFAULT_JOB_BUDGET_USD);
  assert.equal(resolveJobBudgetUsd({ STUDIO_JOB_BUDGET_USD: "-3" }), DEFAULT_JOB_BUDGET_USD);
});

test("resolveJobBudgetUsd: 空文字は既定値にフォールバック", () => {
  assert.equal(resolveJobBudgetUsd({ STUDIO_JOB_BUDGET_USD: "" }), DEFAULT_JOB_BUDGET_USD);
});

// ── assertWithinBudget ───────────────────────────────────────────
test("assertWithinBudget: 予算内なら例外を投げない", () => {
  assert.doesNotThrow(() => assertWithinBudget(4.99, 5));
  assert.doesNotThrow(() => assertWithinBudget(0, 5));
});

test("assertWithinBudget: 予算超過は BudgetExceededError を投げる", () => {
  assert.throws(() => assertWithinBudget(5.01, 5), BudgetExceededError);
});

test("assertWithinBudget: BudgetExceededError は costUsd/budgetUsdを保持し、日本語メッセージを持つ", () => {
  try {
    assertWithinBudget(7.2, 5);
    assert.fail("throw されるはず");
  } catch (err) {
    assert.ok(err instanceof BudgetExceededError);
    assert.equal(err.costUsd, 7.2);
    assert.equal(err.budgetUsd, 5);
    assert.match(err.message, /予算上限/);
  }
});

test("assertWithinBudget: ちょうど予算値と同額は超過扱いにしない（境界値）", () => {
  assert.doesNotThrow(() => assertWithinBudget(5, 5));
});
