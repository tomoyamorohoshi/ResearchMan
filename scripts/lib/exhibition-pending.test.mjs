// node --test scripts/lib/exhibition-pending.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { appendPending, processPending, commitPending, readPending, PENDING_REL, PENDING_MAX_DAYS } from "./exhibition-pending.mjs";

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
  const out = await processPending({
    root: r, data: emptyData(), today: TODAY,
    deps: deps({ reinvestigate: async () => ({ startDate: "2027-01-10", endDate: "2027-03-01" }) }),
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

test("壊れた pending ファイルは warning を返し data を変えない", async () => {
  const r = fresh();
  fs.mkdirSync(path.join(r, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(r, PENDING_REL), "{not json");
  const out = await processPending({ root: r, data: emptyData(), today: TODAY, deps: deps(), opts: {} });
  assert.ok(out.warning);
  assert.equal(out.added.length, 0);
});
