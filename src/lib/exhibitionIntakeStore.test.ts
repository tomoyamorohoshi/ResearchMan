// parseIntakeBlobText（Blob 本文 → IntakeData）のテスト。壊れた Blob は空扱いせず例外にする。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntakeBlobText, StoreCorruptError } from "./exhibitionIntakeStore";

const good = { version: 1, items: { k: { url: "https://x.com/a/status/1", ts: 1, status: "pending", attempts: 0 } } };

test("正常な JSON はそのまま返す", () => {
  assert.deepEqual(parseIntakeBlobText(JSON.stringify(good)), good);
});

test("壊れた JSON は StoreCorruptError", () => {
  assert.throws(() => parseIntakeBlobText("{oops"), StoreCorruptError);
});

test("形が不正（version違い・items 無し・値が null・status 不正）は StoreCorruptError", () => {
  for (const bad of [
    { version: 2, items: {} },
    { version: 1 },
    { version: 1, items: { k: null } },
    { version: 1, items: { k: { url: "u", ts: 1, status: "weird", attempts: 0 } } },
    { version: 1, items: { k: { url: 1, ts: 1, status: "pending", attempts: 0 } } },
    [],
    null,
  ]) {
    assert.throws(() => parseIntakeBlobText(JSON.stringify(bad)), StoreCorruptError, JSON.stringify(bad));
  }
});
