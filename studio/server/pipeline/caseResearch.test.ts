/**
 * caseResearch.ts のうち、依存注入で単体テスト可能な部分のみ検証する
 * （パイプライン本体はAgent SDK/git/ネットワークに依存するためE2Eの領分）。
 *
 * adversarial-reviewer指摘#2の再発防止: commit成功後に例外が起きると、従来は
 * catchブロックが無条件にrollbackTouchedFiles()を呼んでいた。commit(場合によっては
 * push)済みのファイルに対してrmを実行すると「コミット済みファイルの未コミット削除」が
 * working treeに残ってしまう（意図せぬ破壊）。committed=true以降はロールバックを
 * 一切呼ばないことを保証する。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildPushFailPatch, rollbackIfNotCommitted, terminalStatus } from "./caseResearch.js";

test("rollbackIfNotCommitted: committed=trueならrollbackを一切呼ばない", async () => {
  let called = false;
  const result = await rollbackIfNotCommitted(true, ["data/cases.json"], ["public/thumbnails/a.jpg"], async () => {
    called = true;
  });
  assert.equal(called, false, "commit成功後にrollbackが呼ばれてはいけない");
  assert.equal(result.rolledBack, false);
});

test("rollbackIfNotCommitted: committed=falseかつ触ったファイルがあればrollbackを呼ぶ", async () => {
  let calledWith: [string[], string[]] | null = null;
  const result = await rollbackIfNotCommitted(
    false,
    ["data/cases.json"],
    ["public/thumbnails/a.jpg"],
    async (tracked, untracked) => {
      calledWith = [tracked, untracked];
    },
  );
  assert.equal(result.rolledBack, true);
  assert.deepEqual(calledWith, [["data/cases.json"], ["public/thumbnails/a.jpg"]]);
});

test("rollbackIfNotCommitted: committed=falseでも何も触っていなければrollbackを呼ばない", async () => {
  let called = false;
  const result = await rollbackIfNotCommitted(false, [], [], async () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(result.rolledBack, false);
});

// ── terminalStatus（P4 adversarial-review指摘#1の再発防止） ─────────────
// combined実行中（ownsLock=false）はCase/Techそれぞれの内部終端をstatus:"running"のまま
// 据え置く。そうしないと、SSE購読側がCaseフェーズ完了時点のstatus:"done"を「ジョブ全体の
// 終了」と誤認し、Techフェーズの結果が届く前にストリームを閉じてしまう
// （combinedResearch.ts::phaseFromJob は status ではなく error フィールドの有無で
// 成否を判定するよう変更済みなので、running据え置きでも成否の伝達は失われない）。

test("terminalStatus: 単独実行（ownsLock=true）は指定した終端statusをそのまま返す", () => {
  assert.equal(terminalStatus(true, "done"), "done");
  assert.equal(terminalStatus(true, "error"), "error");
});

test("terminalStatus: combined実行中（ownsLock=false）はdone/errorどちらもrunningに据え置く", () => {
  assert.equal(terminalStatus(false, "done"), "running");
  assert.equal(terminalStatus(false, "error"), "running");
});

// ── buildPushFailPatch（H-4再発防止: push失敗時のジョブ更新にcostが乗ること） ─────────
// techResearch.ts/addCase.tsのpush失敗パッチは実行時までの消費costUsdを記録するが、
// caseResearch.tsだけこのcostが欠落しており、失敗ジョブのコスト集計が抜け落ちていた。

test("buildPushFailPatch: costUsdをcostフィールドとして含める", () => {
  const patch = buildPushFailPatch("push に失敗しました", "abc123", 1.23);
  assert.equal(patch.cost, 1.23);
});

test("buildPushFailPatch: message/commitHashもそのまま反映する", () => {
  const patch = buildPushFailPatch("push に失敗しました", "abc123", 1.23);
  assert.equal(patch.status, "error");
  assert.equal(patch.error, "push に失敗しました");
  assert.equal(patch.commit, "abc123");
  assert.equal(patch.progress, undefined);
});
