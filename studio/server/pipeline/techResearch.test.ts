/**
 * techResearch.ts のうち、依存注入で単体テスト可能な部分のみ検証する
 * （パイプライン本体はAgent SDK/git/ネットワークに依存するためE2Eの領分。
 * caseResearch.test.ts と同じ方針）。
 *
 * adversarial-reviewer指摘#1・#3の再発防止: 「両方」でCase成功→Tech失敗のとき、
 * 失敗パス（lock取得不可・fail()・push失敗）がジョブの resultCards/commit/cost を
 * 明示的に上書きしないと、combinedResearch.ts のリセット前に残っていたCase側の値
 * （またはstaleな値）を techPhase が引き継いでしまい、カード二重化・コスト誤算・
 * commit誤表記の原因になる。失敗パスは必ず resultCards=[]・costを明示的に書く
 * （push失敗のみ、commit済みのためcommitHashとresultCardsを保持する）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildFailPatch, buildLockUnavailablePatch, buildPushFailPatch } from "./techResearch.js";

test("buildLockUnavailablePatch: エラー状態かつresultCards/commit/costを明示的に空にする", () => {
  const patch = buildLockUnavailablePatch();
  assert.equal(patch.status, "error");
  assert.deepEqual(patch.resultCards, []);
  assert.equal(patch.commit, null);
  assert.equal(patch.cost, 0);
  assert.match(patch.error ?? "", /デイリージョブ実行中/);
});

test("buildFailPatch: エラー状態・resultCards空・commit null・コストはその時点の実消費額を記録する", () => {
  const patch = buildFailPatch("収集フェーズで候補が得られませんでした", 0.42);
  assert.equal(patch.status, "error");
  assert.deepEqual(patch.resultCards, []);
  assert.equal(patch.commit, null);
  assert.equal(patch.cost, 0.42);
  assert.equal(patch.error, "収集フェーズで候補が得られませんでした");
});

test("buildFailPatch: コスト0でも明示的にcost:0を書く（フィールドが省略されない）", () => {
  const patch = buildFailPatch("失敗", 0);
  assert.equal(patch.cost, 0);
  assert.ok("cost" in patch);
});

test("buildPushFailPatch: commit済みのためcommitHash/resultCards/costを保持したままerror状態にする", () => {
  const cards = [{ kind: "tech" as const, id: "a", url: "https://x/technology/a" }];
  const patch = buildPushFailPatch("push に失敗しました", "abcdef123456", cards, 0.77);
  assert.equal(patch.status, "error");
  assert.deepEqual(patch.resultCards, cards);
  assert.equal(patch.commit, "abcdef123456");
  assert.equal(patch.cost, 0.77);
  assert.match(patch.error ?? "", /push に失敗/);
});
