// node --test scripts/lib/exhibition-finalize.test.mjs
// 「監査 FAIL の日でも投稿は保留リストか intake キューに残る」を固定する。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { stageFinalize, discardStaleFinalize, runFinalize, FINALIZE_REL } from "./exhibition-finalize.mjs";
import { appendPending, processPending, readPending } from "./exhibition-pending.mjs";
import { guardAudit } from "./exhibition-guard.mjs";

const TODAY = "2026-11-07";
let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "exh-fin-")); });
after(() => { fs.rmSync(root, { recursive: true, force: true }); });
const fresh = () => fs.mkdtempSync(path.join(root, "r-"));

const entry = (over = {}) => ({
  title: "展A", artists: [], venue: "会場", venueType: "other", prefecture: "東京都", city: "港区", startDate: "", endDate: "",
  admission: "UNKNOWN", tags: [], score: 60, matchReason: "", officialUrl: "", sources: [], excludeCategory: "none",
  origin: "intake", intakeUrl: "https://x.com/o/status/1", ...over,
});
const deps = () => ({
  fetchHtml: async () => ({ status: 404, body: "" }),
  saveThumb: async (id) => `/thumbnails/exhibition/${id}.jpg`,
  now: () => "2026-11-07T01:00:00.000Z",
});

// 保留から追加できる日を作る: 計画を staged するところまで（auto-research-exhibition.mjs 相当）
async function runDay(r, { audit }) {
  await appendPending(r, [entry({ startDate: "2026-12-01", endDate: "2026-12-10" })], TODAY);
  const out = await processPending({ root: r, data: { version: 1, statusAsOf: TODAY, items: [] }, today: TODAY, deps: deps(), opts: {} });
  assert.equal(out.added.length, 1);
  const patched = [];
  await stageFinalize(r, { intakePatch: [{ url: "https://x.com/o/status/2", status: "added" }], pendingPlan: out.plan, today: TODAY });
  let fin;
  const gate = guardAudit({ audit: () => ({ status: audit }), revert: () => {}, onPass: () => { fin = runFinalize({ root: r, patch: async (res) => { patched.push(...res); } }); } });
  await fin;
  return { gate, patched };
}

test("監査 FAIL の日: PATCH も保留リスト更新も確定されず、投稿は保留リストに残る。次回起動で未確定の計画は破棄される", async () => {
  const r = fresh();
  const { gate, patched } = await runDay(r, { audit: 1 });
  assert.equal(gate.ok, false);
  assert.equal(patched.length, 0);
  assert.equal((await readPending(r)).items.length, 1); // 巻き戻された data.json の分は保留に残っている
  assert.ok(fs.existsSync(path.join(r, FINALIZE_REL)));
  assert.equal(await discardStaleFinalize(r), true);
  assert.ok(!fs.existsSync(path.join(r, FINALIZE_REL)));
  assert.equal(await discardStaleFinalize(r), false);
});

test("監査通過の日: PATCH と保留リスト更新が確定される", async () => {
  const r = fresh();
  const { gate, patched } = await runDay(r, { audit: 0 });
  assert.equal(gate.ok, true);
  assert.deepEqual(patched.map((x) => x.status), ["added"]);
  assert.equal((await readPending(r)).items.length, 0);
  assert.ok(!fs.existsSync(path.join(r, FINALIZE_REL)));
});

test("runFinalize: 計画が無ければ何もしない / PATCH 失敗でも保留リストは更新する", async () => {
  const r = fresh();
  assert.equal((await runFinalize({ root: r, patch: async () => { throw new Error("x"); } })).none, true);
  await appendPending(r, [entry()], TODAY);
  const out = await processPending({ root: r, data: { version: 1, statusAsOf: TODAY, items: [] }, today: TODAY, deps: deps(), opts: {} });
  await stageFinalize(r, { intakePatch: [{ url: "u", status: "added" }], pendingPlan: out.plan, today: TODAY });
  const f = await runFinalize({ root: r, patch: async () => { throw new Error("503"); } });
  assert.equal(f.ok, false);
  assert.match(f.error, /PATCH 失敗/);
  assert.equal((await readPending(r)).items[0].attempts, 1);
});
