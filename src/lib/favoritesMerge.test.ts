import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateIncomingItems,
  mergeFavoritesItems,
  MAX_ITEMS,
} from "./favoritesMerge";

test("validateIncomingItems: 正常な ts (Date.now()) は ok:true", () => {
  const result = validateIncomingItems({
    items: { "valid-id": { fav: true, ts: Date.now() } },
  });
  assert.equal(result.ok, true);
});

test("validateIncomingItems: 許容スキュー内の未来 ts (1分後) は ok:true", () => {
  const result = validateIncomingItems({
    items: { "valid-id": { fav: true, ts: Date.now() + 60_000 } },
  });
  assert.equal(result.ok, true);
});

test("validateIncomingItems: 許容スキューを超える未来 ts は ok:false", () => {
  // 上限(想定300000ms)+余裕1000msで確実に超過させる
  const result = validateIncomingItems({
    items: { "valid-id": { fav: true, ts: Date.now() + 301_000 } },
  });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: 極端な未来 ts (悪意ある固着攻撃) は ok:false", () => {
  const result = validateIncomingItems({
    items: { "valid-id": { fav: false, ts: 1e308 } },
  });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: 負の ts は ok:false（既存の下限チェック）", () => {
  const result = validateIncomingItems({
    items: { "valid-id": { fav: true, ts: -1 } },
  });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: 非finite(NaN)な ts は ok:false", () => {
  const result = validateIncomingItems({
    items: { "valid-id": { fav: true, ts: NaN } },
  });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: 非finite(Infinity)な ts は ok:false", () => {
  const result = validateIncomingItems({
    items: { "valid-id": { fav: true, ts: Infinity } },
  });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: MAX_ITEMS を超える件数は ok:false", () => {
  const items: Record<string, { fav: boolean; ts: number }> = {};
  for (let i = 0; i < MAX_ITEMS + 1; i++) {
    items[`id-${i}`] = { fav: true, ts: Date.now() };
  }
  const result = validateIncomingItems({ items });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: 不正な id (パターン不一致) は ok:false", () => {
  const result = validateIncomingItems({
    items: { InvalidID_123: { fav: true, ts: Date.now() } },
  });
  assert.equal(result.ok, false);
});

test("validateIncomingItems: body が object でない場合は ok:false", () => {
  const result = validateIncomingItems("not an object");
  assert.equal(result.ok, false);
});

test("validateIncomingItems: items が欠落している場合は ok:false", () => {
  const result = validateIncomingItems({});
  assert.equal(result.ok, false);
});

test("mergeFavoritesItems: ts が新しい方を採用する（既存動作の回帰確認）", () => {
  const current = { "id-a": { fav: false, ts: 100 } };
  const incoming = { "id-a": { fav: true, ts: 200 } };
  const merged = mergeFavoritesItems(current, incoming);
  assert.deepEqual(merged["id-a"], { fav: true, ts: 200 });
});
