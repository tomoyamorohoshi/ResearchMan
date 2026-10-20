// getTechById の単体テスト。実行: npx tsx --test src/lib/tech.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTechById } from "./tech";

test("非ASCII id を生の文字列で引ける", () => {
  assert.equal(getTechById("80億分の1")?.id, "80億分の1");
});

test("パーセントエンコードされた slug でも引ける", () => {
  assert.equal(getTechById(encodeURIComponent("80億分の1"))?.id, "80億分の1");
});

test("不正なエンコードや未知の id は undefined", () => {
  assert.equal(getTechById("%E0%A4%A"), undefined);
  assert.equal(getTechById("no-such-id"), undefined);
});
