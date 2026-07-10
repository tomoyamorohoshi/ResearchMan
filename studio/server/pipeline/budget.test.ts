/**
 * budget.ts の純粋関数テスト（node:test）。
 * DESIGN.md §8「コスト: ジョブ単位の予算上限（超過で停止・LINE通知）」の判定ロジック。
 * 上限発火はここ（ユニットテスト）でのみ検証する。実ジョブでは発火させない
 * （STUDIO_JOB_BUDGET_USD の既定 $5 は通常のジョブコストより十分大きい）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BudgetExceededError,
  DEFAULT_JOB_BUDGET_USD,
  assertWithinBudget,
  createJobBudgetTracker,
  resolveJobBudgetUsd,
} from "./budget.js";

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

// ── createJobBudgetTracker（独立レビュー指摘#2: 「両方」はCase/Techで予算を共有する） ──
// Case/Techが各自 resolveJobBudgetUsd() で独立の予算を持つと、combinedは実質2倍の予算に
// なってしまう。combinedResearch.ts が1つの共有トラッカーを生成し、externalLockと同じ
// 注入パターンでCase/Tech両方へ渡す（lock.ts::resolveLockと同じ考え方）。

test("createJobBudgetTracker: 既定はresolveJobBudgetUsd()の値をlimitUsdにする", () => {
  const tracker = createJobBudgetTracker();
  assert.equal(tracker.limitUsd, DEFAULT_JOB_BUDGET_USD);
  assert.equal(tracker.spentUsd, 0);
});

test("createJobBudgetTracker: limitUsdを明示指定できる", () => {
  const tracker = createJobBudgetTracker(2.5);
  assert.equal(tracker.limitUsd, 2.5);
});

test("createJobBudgetTracker.add: spentUsdを累積する", () => {
  const tracker = createJobBudgetTracker(5);
  tracker.add(1);
  tracker.add(2);
  assert.equal(tracker.spentUsd, 3);
});

test("createJobBudgetTracker.add: 累積が上限を超えたらBudgetExceededErrorを投げる", () => {
  const tracker = createJobBudgetTracker(3);
  tracker.add(2);
  assert.throws(() => tracker.add(2), BudgetExceededError, "2+2=4 > limit 3 のはず");
});

test("createJobBudgetTracker: 1つのトラッカーを2フェーズで共有すると合算で予算判定される（combined想定）", () => {
  // Case→Tech直列（combinedResearch.tsと同じ使い方）。Caseだけなら予算内でも、
  // Tech分を加算した結果として超過するケースを再現する。
  const shared = createJobBudgetTracker(3);
  shared.add(2); // Caseフェーズの消費
  assert.equal(shared.spentUsd, 2, "Case単体では予算内");
  assert.throws(() => shared.add(1.5), BudgetExceededError, "Case+Techの合算(3.5)は上限(3)を超えるはず");
});

test("createJobBudgetTracker: 超過後もspentUsdは加算済みの値を保持する（超過額の把握のため）", () => {
  const tracker = createJobBudgetTracker(3);
  try {
    tracker.add(4);
  } catch {
    // 無視（超過を確認するのはassert.throws側の役目ではなく、ここではspentUsdの状態を見る）
  }
  assert.equal(tracker.spentUsd, 4);
});
