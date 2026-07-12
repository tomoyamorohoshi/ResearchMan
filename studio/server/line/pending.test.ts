import assert from "node:assert/strict";
import test from "node:test";
import { expiryFrom, isPendingExpired, loadPending, savePending, type LinePending } from "./pending.js";

test("expiryFrom: 基準時刻+30分になる", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  assert.equal(expiryFrom(now), "2026-07-12T00:30:00.000Z");
});

test("isPendingExpired: null は期限切れ扱い", () => {
  assert.equal(isPendingExpired(null, new Date()), true);
});

test("isPendingExpired: 期限内はfalse・期限を過ぎたらtrue", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  const p: LinePending = { userId: "U123", state: "menu", expiresAt: expiryFrom(now) };
  assert.equal(isPendingExpired(p, new Date("2026-07-12T00:29:59.000Z")), false);
  assert.equal(isPendingExpired(p, new Date("2026-07-12T00:30:00.000Z")), true);
  assert.equal(isPendingExpired(p, new Date("2026-07-12T00:40:00.000Z")), true);
});

test("save/loadPending: 保存した内容がそのまま読み戻せる（サーバ再起動耐性の実体）", async () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  const p: LinePending = {
    userId: "U999",
    state: "final_confirm",
    kind: "Technology",
    theme: "t2",
    viewpoint: "",
    refs: "",
    count: 3,
    expiresAt: expiryFrom(now),
  };
  await savePending(p);
  try {
    const loaded = await loadPending();
    assert.deepEqual(loaded, p);
  } finally {
    await savePending(null);
  }
});

test("save/loadPending: null保存後はloadPendingがnullを返す", async () => {
  await savePending(null);
  const loaded: LinePending | null = await loadPending();
  assert.equal(loaded, null);
});
