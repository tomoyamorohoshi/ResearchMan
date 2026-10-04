// parseIntakeBlobText（Blob 本文 → IntakeData）のテスト。壊れた Blob は空扱いせず例外にする。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntakeBlobText, StoreCorruptError } from "./exhibitionIntakeStore";
import { enqueueUrl, listPendingItems, applyIntakeResults, type IntakeBlobApi } from "./exhibitionIntakeStore";
import { intakeKey } from "./exhibitionIntake";

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


// ── 1件1オブジェクト方式（共有ファイルの read-modify-write を持たない） ──
const PREFIX = "exhibition-intake/items/";
const LEGACY = "exhibition-intake/intake.json";
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 4, 3, 0, 0); // 2026-10-04 12:00 JST
const xUrl = (n: number) => `https://x.com/u/status/${1000 + n}`;
const pathOf = (url: string) => `${PREFIX}${intakeKey(url)}.json`;

type Entry = { text: string; uploadedAt: Date };
// 実 Blob を模したフェイク。create は atomic（既存なら "exists"）、await で譲って並列を再現する。
function fakeApi(opts: { staleGet?: (path: string) => boolean } = {}) {
  const store = new Map<string, Entry>();
  const tick = () => new Promise<void>((r) => setTimeout(r, Math.random() * 3));
  const api: IntakeBlobApi = {
    async list(prefix) {
      await tick();
      return [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([pathname, e]) => ({ pathname, uploadedAt: e.uploadedAt }));
    },
    async get(pathname) {
      await tick();
      if (opts.staleGet?.(pathname)) return null;
      return store.get(pathname)?.text ?? null;
    },
    async create(pathname, text) {
      await tick();
      if (store.has(pathname)) return "exists";
      store.set(pathname, { text, uploadedAt: new Date(NOW) });
      return "created";
    },
    async overwrite(pathname, text) {
      await tick();
      store.set(pathname, { text, uploadedAt: new Date(NOW) });
    },
    async del(pathnames) {
      await tick();
      for (const p of pathnames) store.delete(p);
    },
  };
  return { api, store };
}
const readItem = (store: Map<string, Entry>, url: string) => JSON.parse(store.get(pathOf(url))!.text);

test("enqueueUrl: 並列 POST N 件が全件残る（共有ファイルが無いのでロストしない）", async () => {
  const { api, store } = fakeApi();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => enqueueUrl(xUrl(i), NOW, api)));
  assert.ok(results.every((r) => r === "accepted"));
  assert.equal([...store.keys()].filter((k) => k.startsWith(PREFIX)).length, 12);
  assert.equal((await listPendingItems(NOW, api)).length, 12);
});

test("enqueueUrl: 同一 URL の並列 POST は1件だけ accepted、残りは duplicate", async () => {
  const { api, store } = fakeApi();
  const results = await Promise.all(Array.from({ length: 6 }, () => enqueueUrl(xUrl(1), NOW, api)));
  assert.equal(results.filter((r) => r === "accepted").length, 1);
  assert.equal(results.filter((r) => r === "duplicate").length, 5);
  assert.equal(store.size, 1);
  assert.deepEqual(readItem(store, xUrl(1)), { url: xUrl(1), ts: NOW, status: "pending", attempts: 0 });
});

test("enqueueUrl: 処理済みは already_processed／作成競合時に get が stale でも duplicate（黙って消えない）", async () => {
  const { api, store } = fakeApi();
  await enqueueUrl(xUrl(1), NOW, api);
  await applyIntakeResults([{ url: xUrl(1), status: "added", exhibitionId: "e1" }], NOW, api);
  assert.equal(await enqueueUrl(xUrl(1), NOW, api), "already_processed");
  const stale = fakeApi({ staleGet: () => true });
  await enqueueUrl(xUrl(2), NOW, stale.api);
  assert.equal(await enqueueUrl(xUrl(2), NOW, stale.api), "duplicate");
  assert.equal(stale.store.size, 1);
  assert.equal(store.size, 1);
});

test("enqueueUrl: 当日30件で limit_daily、list の uploadedAt で概算（反映遅れは許容）", async () => {
  const { api, store } = fakeApi();
  for (let i = 0; i < 30; i++) store.set(`${PREFIX}seed${i}.json`, { text: "{}", uploadedAt: new Date(NOW) });
  assert.equal(await enqueueUrl(xUrl(99), NOW, api), "limit_daily");
  assert.equal(store.has(pathOf(xUrl(99))), false);
});

test("enqueueUrl: 直近の未処理が50件以上で limit_pending", async () => {
  const { api, store } = fakeApi();
  for (let i = 0; i < 50; i++) store.set(`${PREFIX}seed${i}.json`, { text: "{}", uploadedAt: new Date(NOW - DAY * 2) });
  assert.equal(await enqueueUrl(xUrl(99), NOW, api), "limit_pending");
});

test("listPendingItems: pending のみ ts 昇順で返し、処理済みは返さない", async () => {
  const { api } = fakeApi();
  await enqueueUrl(xUrl(2), NOW + 2, api);
  await enqueueUrl(xUrl(1), NOW + 1, api);
  await enqueueUrl(xUrl(3), NOW + 3, api);
  await applyIntakeResults([{ url: xUrl(3), status: "rejected" }], NOW, api);
  assert.deepEqual((await listPendingItems(NOW, api)).map((i) => i.url), [xUrl(1), xUrl(2)]);
});

const legacyBlob = (items: Record<string, unknown>) => JSON.stringify({ version: 1, items });
const legacyItem = (url: string, over = {}) => ({ url, ts: 5, status: "pending", attempts: 1, ...over });

test("旧 intake.json の pending は GET に合流し、新形式に処理済みがある URL は除外（旧ファイルは書き換えない）", async () => {
  const { api, store } = fakeApi();
  const a = xUrl(1), b = xUrl(2), c = xUrl(3);
  const text = legacyBlob({ [intakeKey(a)]: legacyItem(a), [intakeKey(b)]: legacyItem(b), [intakeKey(c)]: legacyItem(c, { status: "added" }) });
  store.set(LEGACY, { text, uploadedAt: new Date(NOW - DAY) });
  await applyIntakeResults([{ url: b, status: "added", exhibitionId: "e2" }], NOW, api);
  const items = await listPendingItems(NOW, api);
  assert.deepEqual(items.map((i) => i.url), [a]);
  assert.equal(items[0].attempts, 1);
  assert.equal(store.get(LEGACY)!.text, text);
});

test("PATCH: 新形式に無い URL は旧 pending から新形式 item を処理済みで作成（retry は pending attempts+1）。未知 URL は無視", async () => {
  const { api, store } = fakeApi();
  const a = xUrl(1), r = xUrl(2), unknown = xUrl(3);
  store.set(LEGACY, { text: legacyBlob({ [intakeKey(a)]: legacyItem(a), [intakeKey(r)]: legacyItem(r) }), uploadedAt: new Date(NOW) });
  const n = await applyIntakeResults(
    [{ url: a, status: "added", exhibitionId: "e1", reason: "ok" }, { url: r, status: "retry" }, { url: unknown, status: "added" }],
    NOW, api,
  );
  assert.equal(n, 2);
  assert.deepEqual(readItem(store, a), { url: a, ts: 5, status: "added", attempts: 1, processedAt: NOW, exhibitionId: "e1", reason: "ok" });
  assert.deepEqual(readItem(store, r), { url: r, ts: 5, status: "pending", attempts: 2 });
  assert.equal(store.has(pathOf(unknown)), false);
});

test("PATCH: 新形式 item を上書き（added/unverified）、retry は attempts+1、処理済みへの再 PATCH は無視", async () => {
  const { api, store } = fakeApi();
  await enqueueUrl(xUrl(1), NOW, api);
  await enqueueUrl(xUrl(2), NOW, api);
  const n = await applyIntakeResults(
    [{ url: xUrl(1), status: "unverified", reason: "r" }, { url: xUrl(2), status: "retry" }],
    NOW + 10, api,
  );
  assert.equal(n, 2);
  assert.equal(readItem(store, xUrl(1)).status, "unverified");
  assert.equal(readItem(store, xUrl(1)).processedAt, NOW + 10);
  assert.equal(readItem(store, xUrl(2)).attempts, 1);
  assert.equal(await applyIntakeResults([{ url: xUrl(1), status: "added" }], NOW + 20, api), 0);
  assert.equal(readItem(store, xUrl(1)).status, "unverified");
});

test("PATCH: 30日超の処理済み tombstone は del で掃除、pending は古くても残す", async () => {
  const { api, store } = fakeApi();
  const old = new Date(NOW - 31 * DAY);
  store.set(`${PREFIX}oldDone.json`, { text: JSON.stringify({ url: xUrl(8), ts: 1, status: "added", attempts: 0, processedAt: 1 }), uploadedAt: old });
  store.set(`${PREFIX}oldPending.json`, { text: JSON.stringify({ url: xUrl(9), ts: 1, status: "pending", attempts: 0 }), uploadedAt: old });
  await applyIntakeResults([], NOW, api);
  assert.equal(store.has(`${PREFIX}oldDone.json`), false);
  assert.equal(store.has(`${PREFIX}oldPending.json`), true);
});
