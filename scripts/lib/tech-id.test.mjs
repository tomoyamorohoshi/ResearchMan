// scripts/lib/tech-id.mjs の単体テスト。実行: node --test scripts/lib/tech-id.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toId } from "./tech-id.mjs";

test("π⁴ (Pi4) は括弧内を使って pi4 になる", () => {
  assert.equal(toId("π⁴ (Pi4)"), "pi4");
});
test("コロン以降は落とす", () => {
  assert.equal(toId("Splat Repair: xxx"), "splat-repair");
});
test("括弧付き英名は括弧を除去", () => {
  assert.equal(toId("Foo Bar (Baz)"), "foo-bar");
});
test("全角括弧のみのフォールバック", () => {
  assert.equal(toId("π⁴（Pi4）"), "pi4");
});
test("どうしても空なら空文字", () => {
  assert.equal(toId("π⁴"), "");
  assert.equal(toId(""), "");
});
