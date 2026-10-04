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


// ── pending/ と done/ を prefix で分離した 1件1オブジェクト方式（共有ファイルの read-modify-write なし） ──
const PENDING = "exhibition-intake/pending/";
const DONE = "exhibition-intake/done/";
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 4, 3, 0, 0); // 2026-10-04 12:00 JST
const xUrl = (n: number) => `https://x.com/u/status/${1000 + n}`;
const pPath = (url: string) => `${PENDING}${intakeKey(url)}.json`;
const dPath = (url: string) => `${DONE}${intakeKey(url)}.json`;

type Entry = { text: string; uploadedAt: Date };
// 実 Blob を模したフェイク。create は atomic（既存なら "exists"）、await で譲って並列を再現する。
function fakeApi(opts: { failCreate?: boolean; failCreateButStores?: boolean; failListPrefix?: string } = {}) {
  const store = new Map<string, Entry>();
  const tick = () => new Promise<void>((r) => setTimeout(r, Math.random() * 3));
  const api: IntakeBlobApi = {
    async list(prefix) {
      await tick();
      if (opts.failListPrefix === prefix) throw new Error("list failed");
      return [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([pathname, e]) => ({ pathname, uploadedAt: e.uploadedAt }));
    },
    async get(pathname) {
      await tick();
      return store.get(pathname)?.text ?? null;
    },
    async exists(pathname) {
      await tick();
      return store.has(pathname);
    },
    async create(pathname, text) {
      await tick();
      if (store.has(pathname)) return "exists";
      if (opts.failCreateButStores) store.set(pathname, { text, uploadedAt: new Date(NOW) });
      if (opts.failCreate || opts.failCreateButStores) throw new Error("put failed");
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
const readJson = (store: Map<string, Entry>, path: string) => JSON.parse(store.get(path)!.text);
const seed = (store: Map<string, Entry>, path: string, body: object | string, uploadedAt: number) =>
  store.set(path, { text: typeof body === "string" ? body : JSON.stringify(body), uploadedAt: new Date(uploadedAt) });

test("enqueueUrl: 並列 POST N 件が全件残る（共有ファイルが無いのでロストしない）", async () => {
  const { api, store } = fakeApi();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => enqueueUrl(xUrl(i), NOW, api)));
  assert.ok(results.every((r) => r === "accepted"));
  assert.equal([...store.keys()].filter((k) => k.startsWith(PENDING)).length, 12);
  assert.equal((await listPendingItems(api)).length, 12);
});

test("enqueueUrl: 同一 URL の並列 POST は1件だけ accepted、残りは duplicate", async () => {
  const { api, store } = fakeApi();
  const results = await Promise.all(Array.from({ length: 6 }, () => enqueueUrl(xUrl(1), NOW, api)));
  assert.equal(results.filter((r) => r === "accepted").length, 1);
  assert.equal(results.filter((r) => r === "duplicate").length, 5);
  assert.equal(store.size, 1);
  assert.deepEqual(readJson(store, pPath(xUrl(1))), { url: xUrl(1), ts: NOW, status: "pending", attempts: 0 });
});

test("PATCH 後: done が作成され pending は消える。再 POST は already_processed、再 PATCH は無視", async () => {
  const { api, store } = fakeApi();
  await enqueueUrl(xUrl(1), NOW, api);
  const n = await applyIntakeResults([{ url: xUrl(1), status: "added", exhibitionId: "e1", reason: "ok" }], NOW + 10, api);
  assert.equal(n, 1);
  assert.equal(store.has(pPath(xUrl(1))), false);
  assert.deepEqual(readJson(store, dPath(xUrl(1))), {
    url: xUrl(1), ts: NOW, status: "added", attempts: 0, processedAt: NOW + 10, exhibitionId: "e1", reason: "ok",
  });
  assert.equal(await enqueueUrl(xUrl(1), NOW + 20, api), "already_processed");
  assert.equal(await applyIntakeResults([{ url: xUrl(1), status: "rejected" }], NOW + 30, api), 0);
  assert.equal(readJson(store, dPath(xUrl(1))).status, "added");
});

test("PATCH: unverified/rejected も done へ。未知 URL・不正 status は無視", async () => {
  const { api, store } = fakeApi();
  await enqueueUrl(xUrl(1), NOW, api);
  await enqueueUrl(xUrl(2), NOW, api);
  const n = await applyIntakeResults(
    [{ url: xUrl(1), status: "unverified", reason: "r" }, { url: xUrl(2), status: "rejected" }, { url: xUrl(3), status: "added" }],
    NOW, api,
  );
  assert.equal(n, 2);
  assert.equal(readJson(store, dPath(xUrl(1))).status, "unverified");
  assert.equal(readJson(store, dPath(xUrl(2))).status, "rejected");
  assert.equal(store.has(dPath(xUrl(3))), false);
});

test("PATCH retry: pending を上書きして attempts+1（done は作らない）", async () => {
  const { api, store } = fakeApi();
  await enqueueUrl(xUrl(1), NOW, api);
  assert.equal(await applyIntakeResults([{ url: xUrl(1), status: "retry" }], NOW + 1, api), 1);
  assert.equal(readJson(store, pPath(xUrl(1))).attempts, 1);
  assert.equal(store.has(dPath(xUrl(1))), false);
  assert.deepEqual((await listPendingItems(api)).map((i) => i.attempts), [1]);
});

test("listPendingItems: pending prefix のみ、ts 昇順（done は返さない）", async () => {
  const { api } = fakeApi();
  await enqueueUrl(xUrl(2), NOW + 2, api);
  await enqueueUrl(xUrl(1), NOW + 1, api);
  await enqueueUrl(xUrl(3), NOW + 3, api);
  await applyIntakeResults([{ url: xUrl(3), status: "rejected" }], NOW, api);
  assert.deepEqual((await listPendingItems(api)).map((i) => i.url), [xUrl(1), xUrl(2)]);
});

test("limit_pending: pending prefix の件数が50以上（反映遅れは許容する概算）", async () => {
  const { api, store } = fakeApi();
  for (let i = 0; i < 50; i++) seed(store, `${PENDING}seed${i}.json`, { url: "u", ts: NOW - 2 * DAY, status: "pending", attempts: 0 }, NOW - 2 * DAY);
  assert.equal(await enqueueUrl(xUrl(99), NOW, api), "limit_pending");
  assert.equal(store.has(pPath(xUrl(99))), false);
});

test("limit_daily: pending と done を合わせ、本文の ts が JST 当日のものを30件で上限（受付が昨日の done は数えない）", async () => {
  const { api, store } = fakeApi();
  const item = (ts: number, status = "pending") => ({ url: "u", ts, status, attempts: 0 });
  for (let i = 0; i < 29; i++) seed(store, `${i % 2 ? PENDING : DONE}seed${i}.json`, item(NOW - 1000, i % 2 ? "pending" : "added"), NOW);
  for (let i = 0; i < 20; i++) seed(store, `${DONE}old${i}.json`, item(NOW - DAY, "added"), NOW);
  assert.equal(await enqueueUrl(xUrl(98), NOW, api), "accepted");
  assert.equal(await enqueueUrl(xUrl(99), NOW, api), "limit_daily");
});

test("sweep: 30日超の done のみ del、pending は古くても残す／失敗しても PATCH は成功", async () => {
  const { api, store } = fakeApi();
  const old = NOW - 31 * DAY;
  seed(store, `${DONE}oldDone.json`, { url: xUrl(8), ts: 1, status: "added", attempts: 0, processedAt: 1 }, old);
  seed(store, `${DONE}freshDone.json`, { url: xUrl(7), ts: 1, status: "added", attempts: 0, processedAt: NOW }, NOW);
  seed(store, `${PENDING}oldPending.json`, { url: xUrl(9), ts: 1, status: "pending", attempts: 0 }, old);
  await applyIntakeResults([], NOW, api);
  assert.equal(store.has(`${DONE}oldDone.json`), false);
  assert.equal(store.has(`${DONE}freshDone.json`), true);
  assert.equal(store.has(`${PENDING}oldPending.json`), true);

  const f = fakeApi({ failListPrefix: DONE });
  seed(f.store, pPath(xUrl(1)), { url: xUrl(1), ts: NOW, status: "pending", attempts: 0 }, NOW);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await applyIntakeResults([{ url: xUrl(1), status: "added" }], NOW, f.api), 1);
  } finally {
    console.warn = warn;
  }
  assert.equal(f.store.has(dPath(xUrl(1))), true);
});

test("put 失敗: 実在しなければ throw（accepted を返さない）、実在すれば duplicate", async () => {
  const f1 = fakeApi({ failCreate: true });
  await assert.rejects(enqueueUrl(xUrl(1), NOW, f1.api), /put failed/);
  assert.equal(f1.store.size, 0);
  const f2 = fakeApi({ failCreateButStores: true });
  assert.equal(await enqueueUrl(xUrl(1), NOW, f2.api), "duplicate");
});
