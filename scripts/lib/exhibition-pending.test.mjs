// node --test scripts/lib/exhibition-pending.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { appendPending, processPending, commitPending, readPending, PENDING_REL, PENDING_MAX_DAYS, PENDING_MAX_ATTEMPTS, PENDING_MAX_PER_RUN } from "./exhibition-pending.mjs";

const TODAY = "2026-11-07";
let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "exh-pending-")); });
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const entry = (over = {}) => ({
  title: "ジェームズ・タレル展", artists: [], venue: "スーパーブルー京都", venueType: "gallery", prefecture: "京都府", city: "京都市",
  startDate: "", endDate: "", admission: "UNKNOWN", tags: [], score: 60, matchReason: "", officialUrl: "",
  sources: [], excludeCategory: "none", origin: "intake", intakeUrl: "https://x.com/o/status/9", ...over,
});
const deps = (over = {}) => ({
  fetchHtml: async () => ({ status: 404, body: "" }),
  saveThumb: async (id) => `/thumbnails/exhibition/${id}.jpg`,
  now: () => "2026-11-07T01:00:00.000Z",
  ...over,
});
const emptyData = () => ({ version: 1, statusAsOf: TODAY, items: [] });
const fresh = () => fs.mkdtempSync(path.join(root, "r-"));

test("appendPending: 追記・重複排除・pendingSince 付与", async () => {
  const r = fresh();
  assert.equal(await appendPending(r, [entry()], TODAY), 1);
  assert.equal(await appendPending(r, [entry()], TODAY), 0);
  const { items } = await readPending(r);
  assert.equal(items.length, 1);
  assert.equal(items[0].pendingSince, TODAY);
});

test("processPending: 日付が出ていれば追加し、保留から除去される", async () => {
  const r = fresh();
  await appendPending(r, [entry()], "2026-10-01");
  // 再調査の日付は、取得したページで確認できたときだけ採用される（未照合の日付で追加しない）
  const u = "https://venue.example/new";
  const out = await processPending({
    root: r, data: emptyData(), today: TODAY,
    deps: deps({
      fetchHtml: async (url) => (url === u ? { status: 200, body: "<html><body><h1>ジェームズ・タレル展</h1>2027年1月10日〜2027年3月1日</body></html>" } : { status: 404, body: "" }),
      reinvestigate: async () => ({ startDate: "2027-01-10", endDate: "2027-03-01", officialUrl: u }),
    }),
    opts: {},
  });
  assert.equal(out.added.length, 1);
  assert.equal(out.added[0].startDate, "2027-01-10");
  assert.equal(out.added[0].verifiedVia, "owner-intake");
  await commitPending(r, out.plan);
  assert.equal((await readPending(r)).items.length, 0);
});

test("processPending: まだ未発表なら保留に残り attempts が増える", async () => {
  const r = fresh();
  await appendPending(r, [entry()], "2026-10-01");
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps({ reinvestigate: async () => null }), opts: {} });
  assert.equal(out.added.length, 0);
  await commitPending(r, out.plan);
  const { items } = await readPending(r);
  assert.equal(items.length, 1);
  assert.equal(items[0].attempts, 1);
  assert.equal(items[0].lastCheckedAt, TODAY);
});

test("processPending: 打ち切り日数を超えた保留は外れる", async () => {
  const r = fresh();
  await appendPending(r, [entry({ pendingSince: "2025-01-01" })], TODAY);
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps(), opts: {} });
  await commitPending(r, out.plan);
  assert.equal((await readPending(r)).items.length, 0);
  assert.ok(PENDING_MAX_DAYS > 0);
});

test("commitPending: 処理中に追記された分は残る", async () => {
  const r = fresh();
  await appendPending(r, [entry()], TODAY);
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps(), opts: {} });
  await appendPending(r, [entry({ title: "別の展示", intakeUrl: "https://x.com/o/status/10" })], TODAY);
  await commitPending(r, out.plan);
  const titles = (await readPending(r)).items.map((e) => e.title).sort();
  assert.deepEqual(titles, ["ジェームズ・タレル展", "別の展示"].sort());
});

test("M1: 再調査で title が変わっても元の title(pendingTitle)で保留を照合し、黙って落とさない", async () => {
  const r = fresh();
  await appendPending(r, [entry({ pendingTitle: "ジェームズ・タレル展" })], TODAY);
  // 題名がページで確認できて採用された（title が変わった）が、会期はまだ未発表
  const u = "https://venue.example/t";
  const out = await processPending({
    root: r, data: emptyData(), today: TODAY,
    deps: deps({
      fetchHtml: async (url) => (url === u ? { status: 200, body: "<html><body>James Turrell at Super Blue 近日公開</body></html>" } : { status: 404, body: "" }),
      reinvestigate: async () => ({ title: "James Turrell at Super Blue", officialUrl: u }),
    }),
    opts: {},
  });
  assert.equal(out.pending.length, 1);
  await commitPending(r, out.plan);
  const { items } = await readPending(r);
  assert.equal(items.length, 1);
  assert.equal(items[0].pendingTitle, "ジェームズ・タレル展");
  assert.equal(items[0].attempts, 1);
});

test("M6: attempts が上限に達した保留は外れ、理由つきで unverified キューに返る", async () => {
  const r = fresh();
  await appendPending(r, [entry({ attempts: PENDING_MAX_ATTEMPTS - 1 })], TODAY);
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps(), opts: {} });
  assert.equal(out.unverified.length, 1);
  assert.match(out.unverified[0].reason, /pending-expired/);
  await commitPending(r, out.plan);
  assert.equal((await readPending(r)).items.length, 0);
});

test("M6: 1回の処理で再調査する保留は PENDING_MAX_PER_RUN 件まで", async () => {
  const r = fresh();
  await appendPending(r, Array.from({ length: PENDING_MAX_PER_RUN + 3 }, (_, i) => entry({ title: `展${i}`, intakeUrl: `https://x.com/o/status/${100 + i}` })), TODAY);
  let n = 0;
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps({ reinvestigate: async () => { n++; return null; } }), opts: {} });
  assert.equal(n, PENDING_MAX_PER_RUN);
  await commitPending(r, out.plan);
  assert.equal((await readPending(r)).items.length, PENDING_MAX_PER_RUN + 3);
});

test("L5: pendingSince が不正な値なら今日で補正する", async () => {
  const r = fresh();
  await appendPending(r, [entry({ pendingSince: "yesterday" })], TODAY);
  assert.equal((await readPending(r)).items[0].pendingSince, TODAY);
});

test("壊れた pending ファイルは warning を返し data を変えない", async () => {
  const r = fresh();
  fs.mkdirSync(path.join(r, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(r, PENDING_REL), "{not json");
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps(), opts: {} });
  assert.ok(out.warning);
  assert.equal(out.added.length, 0);
});
