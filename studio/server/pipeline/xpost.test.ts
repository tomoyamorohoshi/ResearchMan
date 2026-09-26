/**
 * xpost.ts::generateDraftWithRetry のリトライ挙動のみを対象にした単体テスト
 * （ネットワーク・実際のClaude呼び出しは行わない。queryFnをフェイクに差し替える）。
 * データ読み込み・サムネイル確認を含むgenerateXPost全体は引き続き自動テスト対象外
 * （xpost.ts冒頭コメント参照）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BudgetExceededError } from "./budget.js";
import { generateDraftWithRetry, type XPostQueryFn } from "./xpost.js";
import type { AgentRunResult } from "./sdkRunner.js";

function okResult(text: string): AgentRunResult {
  return { ok: true, text, costUsd: 0.01 };
}

const VALID_JSON = '{"postA": "こんにちは、これは事例紹介です。", "postB": "別の切り口の投稿文です。"}';

test("generateDraftWithRetry: 1回目で成功すれば2回目は呼ばない", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return okResult(VALID_JSON);
  };
  const result = await generateDraftWithRetry("prompt", queryFn);
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("generateDraftWithRetry: 1回目が検証エラー(JSON不正)なら1回だけ再生成し、2回目成功なら成功を返す", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return calls === 1 ? okResult("これはJSONではありません") : okResult(VALID_JSON);
  };
  const result = await generateDraftWithRetry("prompt", queryFn);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("generateDraftWithRetry: 1回目が例外(タイムアウト等)を投げても1回だけ再生成し、2回目成功なら成功を返す", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    if (calls === 1) throw new Error("生成がタイムアウトしました（90秒）");
    return okResult(VALID_JSON);
  };
  const result = await generateDraftWithRetry("prompt", queryFn);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("generateDraftWithRetry: 2回とも例外を投げれば失敗を返す（合計2回で打ち切り）", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    throw new Error("タイムアウト");
  };
  const result = await generateDraftWithRetry("prompt", queryFn);
  assert.equal(result.ok, false);
  assert.equal(calls, 2);
});

test("generateDraftWithRetry: BudgetExceededErrorは再試行せず即座に伝播する（1回のみ呼ばれる）", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return { ok: true, text: VALID_JSON, costUsd: 999 }; // XPOST_BUDGET_USDを超過させる
  };
  await assert.rejects(() => generateDraftWithRetry("prompt", queryFn), BudgetExceededError);
  assert.equal(calls, 1);
});

test("generateDraftWithRetry: 2回とも検証エラーなら失敗理由に「再生成後も失敗」を含む", async () => {
  const queryFn: XPostQueryFn = async () => okResult("不正なJSON");
  const result = await generateDraftWithRetry("prompt", queryFn);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /再生成後も失敗/);
});
