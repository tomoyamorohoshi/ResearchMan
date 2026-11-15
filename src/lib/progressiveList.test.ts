import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_VISIBLE,
  VISIBLE_STEP,
  nextVisibleCount,
  hasMoreToShow,
  resolveVisibleCount,
  type VisibleState,
} from "./progressiveList";

test("定数: 初期60件・追加60件", () => {
  assert.equal(INITIAL_VISIBLE, 60);
  assert.equal(VISIBLE_STEP, 60);
});

test("nextVisibleCount: stepずつ増え、総件数を超えない", () => {
  assert.equal(nextVisibleCount(60, 2503), 120);
  assert.equal(nextVisibleCount(2460, 2503), 2503);
  assert.equal(nextVisibleCount(2503, 2503), 2503);
  assert.equal(nextVisibleCount(10, 0), 0);
});

test("hasMoreToShow: 描画済み<総件数のときだけtrue", () => {
  assert.equal(hasMoreToShow(60, 2503), true);
  assert.equal(hasMoreToShow(2503, 2503), false);
  assert.equal(hasMoreToShow(60, 30), false);
});

test("resolveVisibleCount: キーが同じなら保持分、違えば先頭からやり直し（初期値）", () => {
  const st: VisibleState = { key: "k1", count: 180 };
  assert.equal(resolveVisibleCount(st, "k1", 2503), 180);
  assert.equal(resolveVisibleCount(st, "k2", 2503), 60);
});

test("resolveVisibleCount: 総件数が少なければ総件数で頭打ち（件数が減った場合も）", () => {
  assert.equal(resolveVisibleCount({ key: "k", count: 180 }, "k", 100), 100);
  assert.equal(resolveVisibleCount({ key: "a", count: 180 }, "b", 20), 20);
  assert.equal(resolveVisibleCount({ key: "k", count: 60 }, "k", 0), 0);
});
