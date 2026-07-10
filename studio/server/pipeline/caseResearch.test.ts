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
import { rollbackIfNotCommitted } from "./caseResearch.js";

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
