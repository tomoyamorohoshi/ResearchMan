/**
 * xpost.ts::generateDraftWithRetry のリトライ挙動のみを対象にした単体テスト
 * （ネットワーク・実際のClaude呼び出しは行わない。queryFnをフェイクに差し替える）。
 * データ読み込み・サムネイル確認を含むgenerateXPost全体は引き続き自動テスト対象外
 * （xpost.ts冒頭コメント参照）。
 *
 * 2026-09-27フォローアップ: 出力JSONにclaims（引用元フィールド名+逐語引用）が必須化された
 * ため、VALID_JSONもその形へ更新し、claims不備（事実歪曲の疑い）での却下がリトライ対象に
 * なることを検証するケースを追加した。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BudgetExceededError } from "./budget.js";
import { generateDraftWithRetry, type XPostQueryFn } from "./xpost.js";
import type { AgentRunResult } from "./sdkRunner.js";

function okResult(text: string): AgentRunResult {
  return { ok: true, text, costUsd: 0.01 };
}

const ENTRY_FIELDS = {
  summary: "無料で開催されたオンラインフェス。反アジアヘイトへの募金を呼びかけた。",
  overview: "通常の有料フェスとは異なり、視聴者から寄付を募る形で無料開催された。",
};

const VALID_JSON = JSON.stringify({
  postA: {
    text: "88risingが無料でオンラインフェスを開催。\n\n反アジアヘイトへの募金を呼びかけた。\n\nこの発信力、どう見る？",
    claims: [{ sourceField: "summary", quote: "無料で開催されたオンラインフェス" }],
  },
  postB: {
    text: "有料フェスとは異なる無料開催という形。\n\n88risingは視聴者からの寄付を募った。\n\n収益より発信を選んだ判断。",
    claims: [{ sourceField: "overview", quote: "視聴者から寄付を募る形で無料開催" }],
  },
});

test("generateDraftWithRetry: 1回目で成功すれば2回目は呼ばない", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return okResult(VALID_JSON);
  };
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("generateDraftWithRetry: 1回目が検証エラー(JSON不正)なら1回だけ再生成し、2回目成功なら成功を返す", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return calls === 1 ? okResult("これはJSONではありません") : okResult(VALID_JSON);
  };
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
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
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("generateDraftWithRetry: 2回とも例外を投げれば失敗を返す（合計2回で打ち切り）", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    throw new Error("タイムアウト");
  };
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, false);
  assert.equal(calls, 2);
});

test("generateDraftWithRetry: BudgetExceededErrorは再試行せず即座に伝播する（1回のみ呼ばれる）", async () => {
  let calls = 0;
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return { ok: true, text: VALID_JSON, costUsd: 999 }; // XPOST_BUDGET_USDを超過させる
  };
  await assert.rejects(() => generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn), BudgetExceededError);
  assert.equal(calls, 1);
});

test("generateDraftWithRetry: 2回とも検証エラーなら失敗理由に「再生成後も失敗」を含む", async () => {
  const queryFn: XPostQueryFn = async () => okResult("不正なJSON");
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /再生成後も失敗/);
});

// ── claims（引用照合）不備での却下・リトライ（レビュー指摘2026-09-27の機械的ガード） ──────

test("generateDraftWithRetry: 1回目のclaimsが事実データに存在しない引用（捏造の疑い）なら却下され、1回だけ再生成する", async () => {
  let calls = 0;
  const fabricated = JSON.stringify({
    postA: {
      text: "88risingが即興でフェスを無料開催。\n\n反アジアヘイトへの募金を呼びかけた。\n\nこの発信力、どう見る？",
      claims: [{ sourceField: "summary", quote: "即興でフェスを開催" }], // 原文に存在しない捏造引用
    },
    postB: {
      text: "有料フェスとは異なる無料開催という形。\n\n88risingは視聴者からの寄付を募った。\n\n収益より発信を選んだ判断。",
      claims: [{ sourceField: "overview", quote: "視聴者から寄付を募る形で無料開催" }],
    },
  });
  const queryFn: XPostQueryFn = async () => {
    calls += 1;
    return calls === 1 ? okResult(fabricated) : okResult(VALID_JSON);
  };
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("generateDraftWithRetry: claimsが空配列なら却下される", async () => {
  const noClaimsJson = JSON.stringify({
    postA: { text: "1行目\n\n本文\n\n締め", claims: [] },
    postB: { text: "1行目\n\n本文\n\n締め", claims: [] },
  });
  const queryFn: XPostQueryFn = async () => okResult(noClaimsJson);
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, false);
});

test("generateDraftWithRetry: 改行が2箇所未満（壁テキスト）なら却下される", async () => {
  const noLineBreaksJson = JSON.stringify({
    postA: { text: "改行が無い一文だけの投稿文です", claims: [{ sourceField: "summary", quote: "無料で開催されたオンラインフェス" }] },
    postB: { text: "1行目\n\n本文\n\n締め", claims: [{ sourceField: "overview", quote: "視聴者から寄付を募る形で無料開催" }] },
  });
  const queryFn: XPostQueryFn = async () => okResult(noLineBreaksJson);
  const result = await generateDraftWithRetry("prompt", ENTRY_FIELDS, queryFn);
  assert.equal(result.ok, false);
});
