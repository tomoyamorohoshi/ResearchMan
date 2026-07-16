/**
 * ideaResearch.ts のうち、依存注入なしで単体テスト可能な純粋関数のみ検証する
 * （パイプライン本体はAgent SDK/git/ネットワークに依存するためE2Eの領分。
 * caseResearch.test.tsと同じ方針）。
 *
 * H-4再発防止: push失敗時のジョブ更新で、techResearch.ts(buildPushFailPatch)/addCase.tsは
 * costを記録するのに、caseResearch.ts/ideaResearch.tsのpush失敗パッチだけcostが欠落していた
 * （失敗ジョブのコスト集計が2種だけ抜ける）。caseResearch.tsと同じ形でbuildPushFailPatchを
 * 抽出し、costが乗ることを検証する。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildPushFailPatch } from "./ideaResearch.js";

test("buildPushFailPatch: costUsdをcostフィールドとして含める", () => {
  const patch = buildPushFailPatch("push に失敗しました", "abc123", 2.5);
  assert.equal(patch.cost, 2.5);
});

test("buildPushFailPatch: message/commitHashもそのまま反映する", () => {
  const patch = buildPushFailPatch("push に失敗しました", "abc123", 2.5);
  assert.equal(patch.status, "error");
  assert.equal(patch.error, "push に失敗しました");
  assert.equal(patch.commit, "abc123");
  assert.equal(patch.progress, undefined);
});
