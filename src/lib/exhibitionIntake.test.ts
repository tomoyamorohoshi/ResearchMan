// src/lib/exhibitionIntake.ts の単体テスト（SPEC §6.1 / §11）。
// 実行: npx tsx --test src/lib/exhibitionIntake.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateIntakeUrl,
  intakeKey,
  emptyIntakeData,
  addToQueue,
  applyResults,
  pendingItems,
  sweepTombstones,
  MAX_PENDING,
  MAX_DAILY,
  TOMBSTONE_DAYS,
  type IntakeData,
} from "./exhibitionIntake";

const ok = (u: string) => {
  const r = validateIntakeUrl(u);
  assert.equal(r.ok, true, `expected ok: ${u}`);
  return r.ok ? r.url : "";
};
const ng = (u: unknown) => {
  const r = validateIntakeUrl(u);
  assert.equal(r.ok, false, `expected reject: ${String(u)}`);
};

test("X: 正規形はそのまま、query/fragment を除去", () => {
  assert.equal(ok("https://x.com/ayupys/status/2105985301751693583"), "https://x.com/ayupys/status/2105985301751693583");
  assert.equal(ok("https://x.com/ayupys/status/2105985301751693583?s=20&t=abc#frag"), "https://x.com/ayupys/status/2105985301751693583");
  assert.equal(ok("https://www.x.com/a_b/status/1/"), "https://x.com/a_b/status/1");
});

test("twitter 系は https://x.com に正規化", () => {
  assert.equal(ok("https://twitter.com/foo/status/123"), "https://x.com/foo/status/123");
  assert.equal(ok("https://mobile.twitter.com/foo/status/123?x=1"), "https://x.com/foo/status/123");
});

test("Instagram: /p /reel を www.instagram.com/{p|reel}/{id}/ に正規化", () => {
  assert.equal(ok("https://www.instagram.com/p/Dd6XYiYk386/"), "https://www.instagram.com/p/Dd6XYiYk386/");
  assert.equal(ok("https://instagram.com/p/Dd6XYiYk386?igsh=xx"), "https://www.instagram.com/p/Dd6XYiYk386/");
  assert.equal(ok("https://www.instagram.com/reel/AbC_d-1/#x"), "https://www.instagram.com/reel/AbC_d-1/");
});

test("拒否: http / 他ホスト / userinfo / ポート / javascript / punycode / 長すぎ / 非文字列", () => {
  ng("http://x.com/a/status/1");
  ng("https://example.com/a/status/1");
  ng("https://evil.com/https://x.com/a/status/1");
  ng("https://user:pw@x.com/a/status/1");
  ng("https://user@x.com/a/status/1");
  ng("https://x.com:8443/a/status/1");
  ng("javascript:alert(1)");
  ng("https://xn--x-.com/a/status/1");
  ng("https://x.com.evil.com/a/status/1");
  ng("https://x.com/a/status/" + "1".repeat(300));
  ng(undefined);
  ng(123);
  ng("");
  ng("not a url");
});

test("拒否: パス形式不正", () => {
  ng("https://x.com/user/status/abc");
  ng("https://x.com/user");
  ng("https://x.com/user/status/");
  ng("https://x.com/user/status/12/extra");
  ng("https://x.com/user/likes/12");
  ng("https://www.instagram.com/someuser/");
  ng("https://www.instagram.com/p/");
  ng("https://www.instagram.com/stories/u/123/");
  ng("https://www.instagram.com/p/a/b");
});

test("intakeKey: 16桁hex・決定的・URLで変わる", () => {
  const a = intakeKey("https://x.com/a/status/1");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, intakeKey("https://x.com/a/status/1"));
  assert.notEqual(a, intakeKey("https://x.com/a/status/2"));
});

const NOW = Date.parse("2026-10-04T03:00:00Z"); // JST 12:00
const U = (n: number) => `https://x.com/u/status/${n}`;

test("addToQueue: 追加→pending、同一URLは duplicate（冪等）", () => {
  const r1 = addToQueue(emptyIntakeData(), U(1), NOW);
  assert.equal(r1.result, "accepted");
  assert.equal(Object.keys(r1.data.items).length, 1);
  const item = r1.data.items[intakeKey(U(1))];
  assert.deepEqual(
    { url: item.url, ts: item.ts, status: item.status, attempts: item.attempts },
    { url: U(1), ts: NOW, status: "pending", attempts: 0 },
  );
  const r2 = addToQueue(r1.data, U(1), NOW + 1000);
  assert.equal(r2.result, "duplicate");
  assert.equal(Object.keys(r2.data.items).length, 1);
  assert.equal(r2.data.items[intakeKey(U(1))].ts, NOW, "ts を更新しない");
});

test("addToQueue: pending が上限(50)なら limit_pending、保存しない", () => {
  const d: IntakeData = emptyIntakeData();
  // 日次上限に当たらないよう過去日の ts で pending を詰める
  for (let i = 0; i < MAX_PENDING; i++) {
    d.items[intakeKey(U(i))] = { url: U(i), ts: NOW - 3 * 86400000, status: "pending", attempts: 0 };
  }
  const r = addToQueue(d, U(999), NOW);
  assert.equal(r.result, "limit_pending");
  assert.equal(Object.keys(r.data.items).length, MAX_PENDING);
  // 既存 pending の再投稿は上限でも duplicate
  assert.equal(addToQueue(d, U(0), NOW).result, "duplicate");
});

test("addToQueue: 当日(JST)受付が30件なら limit_daily。前日分は数えない", () => {
  const d: IntakeData = emptyIntakeData();
  for (let i = 0; i < MAX_DAILY; i++) {
    d.items[intakeKey(U(i))] = { url: U(i), ts: NOW - 1000, status: "added", attempts: 0, processedAt: NOW - 500 };
  }
  assert.equal(addToQueue(d, U(999), NOW).result, "limit_daily");
  // JST 日付境界: NOW(JST 2026-10-04 12:00) の 13時間前は JST 10-03 23:00 → 前日
  const d2: IntakeData = emptyIntakeData();
  for (let i = 0; i < MAX_DAILY; i++) {
    d2.items[intakeKey(U(i))] = { url: U(i), ts: NOW - 13 * 3600000, status: "added", attempts: 0, processedAt: NOW - 500 };
  }
  assert.equal(addToQueue(d2, U(999), NOW).result, "accepted");
});

test("addToQueue: 処理済み(30日内)は already_processed、30日超は掃除され再受付", () => {
  const key = intakeKey(U(1));
  const processed = (processedAt: number): IntakeData => ({
    version: 1,
    items: { [key]: { url: U(1), ts: processedAt - 1000, status: "rejected", attempts: 1, processedAt } },
  });
  const day = 86400000;
  assert.equal(addToQueue(processed(NOW - 29 * day), U(1), NOW).result, "already_processed");
  const r = addToQueue(processed(NOW - (TOMBSTONE_DAYS + 1) * day), U(1), NOW);
  assert.equal(r.result, "accepted");
  assert.equal(r.data.items[key].status, "pending");
});

test("sweepTombstones: 30日超の処理済みのみ削除、pending は残す", () => {
  const day = 86400000;
  const d: IntakeData = {
    version: 1,
    items: {
      a: { url: U(1), ts: 1, status: "added", attempts: 0, processedAt: NOW - 31 * day },
      b: { url: U(2), ts: 1, status: "unverified", attempts: 0, processedAt: NOW - 1 * day },
      c: { url: U(3), ts: 1, status: "pending", attempts: 3 },
    },
  };
  const s = sweepTombstones(d, NOW);
  assert.deepEqual(Object.keys(s.items).sort(), ["b", "c"]);
});

test("pendingItems: pending のみ {url,ts,attempts}、ts 昇順", () => {
  let d = addToQueue(emptyIntakeData(), U(2), NOW + 10).data;
  d = addToQueue(d, U(1), NOW).data;
  d.items[intakeKey(U(3))] = { url: U(3), ts: NOW, status: "added", attempts: 0, processedAt: NOW };
  assert.deepEqual(pendingItems(d), [
    { url: U(1), ts: NOW, attempts: 0 },
    { url: U(2), ts: NOW + 10, attempts: 0 },
  ]);
});

test("applyResults: added/rejected/unverified は処理済み化、retry は pending のまま attempts+1", () => {
  let d = emptyIntakeData();
  for (const n of [1, 2, 3, 4]) d = addToQueue(d, U(n), NOW).data;
  const later = NOW + 5000;
  const { data, updated } = applyResults(
    d,
    [
      { url: U(1), status: "added", exhibitionId: "2026-foo-bar" },
      { url: U(2), status: "rejected", reason: "not an exhibition" },
      { url: U(3), status: "unverified", reason: "no official" },
      { url: U(4), status: "retry" },
    ],
    later,
  );
  assert.equal(updated, 4);
  const it = (n: number) => data.items[intakeKey(U(n))];
  assert.equal(it(1).status, "added");
  assert.equal(it(1).exhibitionId, "2026-foo-bar");
  assert.equal(it(1).processedAt, later);
  assert.equal(it(2).status, "rejected");
  assert.equal(it(2).reason, "not an exhibition");
  assert.equal(it(3).status, "unverified");
  assert.equal(it(4).status, "pending");
  assert.equal(it(4).attempts, 1);
  assert.equal(it(4).processedAt, undefined);
});

test("applyResults: 未知URL・不正status・不正URL は無視、処理済みへの再PATCHも無視", () => {
  const d = addToQueue(emptyIntakeData(), U(1), NOW).data;
  const { data, updated } = applyResults(
    d,
    [
      { url: U(99), status: "added" },
      { url: U(1), status: "bogus" as never },
      { url: "javascript:1", status: "added" },
    ],
    NOW + 1,
  );
  assert.equal(updated, 0);
  assert.equal(data.items[intakeKey(U(1))].status, "pending");
  const first = applyResults(d, [{ url: U(1), status: "added" }], NOW + 2);
  assert.equal(first.updated, 1);
  const again = applyResults(first.data, [{ url: U(1), status: "rejected" }], NOW + 3);
  assert.equal(again.updated, 0);
  assert.equal(again.data.items[intakeKey(U(1))].status, "added");
});

test("applyResults: 入力を破壊しない（純関数）", () => {
  const d = addToQueue(emptyIntakeData(), U(1), NOW).data;
  const snapshot = JSON.stringify(d);
  applyResults(d, [{ url: U(1), status: "added" }], NOW + 1);
  assert.equal(JSON.stringify(d), snapshot);
});

test("X: ユーザー名は小文字化して正規化", () => {
  assert.equal(ok("https://x.com/AyuPys/status/123"), "https://x.com/ayupys/status/123");
});

test("intakeKey: X は status id のみ、IG は大小区別", () => {
  assert.equal(intakeKey("https://x.com/a/status/123"), intakeKey("https://x.com/b/status/123"));
  assert.notEqual(intakeKey("https://x.com/a/status/123"), intakeKey("https://x.com/a/status/124"));
  assert.notEqual(
    intakeKey("https://www.instagram.com/p/AbC/"),
    intakeKey("https://www.instagram.com/p/abc/"),
  );
  assert.notEqual(
    intakeKey("https://www.instagram.com/p/AbC/"),
    intakeKey("https://www.instagram.com/reel/AbC/"),
  );
});

test("同一ツイートを別ユーザー名・大小違いで再投稿すると duplicate", () => {
  const u1 = ok("https://x.com/Foo/status/999");
  const u2 = ok("https://twitter.com/bar/status/999");
  const first = addToQueue(emptyIntakeData(), u1, 1_000_000);
  assert.equal(first.result, "accepted");
  assert.equal(addToQueue(first.data, u2, 1_000_001).result, "duplicate");
});
