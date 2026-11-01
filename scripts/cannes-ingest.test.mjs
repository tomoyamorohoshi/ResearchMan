import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ingest, slugifyId, makeCaseId } from "./cannes-ingest.mjs";
import { tryAcquire, releaseOwnedLock } from "./lib/git-lock.mjs";

const quiet = () => {};
const entriesA = [
  { org: "cannes", year: 2025, category: "Innovation", level: "Silver" },
  { org: "cannes", year: 2025, category: "Pharma", level: "Bronze" },
];
const plan = {
  year: 2025,
  new: [
    { key: "painvisible|aritium", title: "Painvisible", brand: "Aritium", agency: "VML", country: "Spain", sources: [], entries: entriesA },
    { key: "babyminder|eurofarma", title: "Baby Minder", brand: "Eurofarma", agency: "Ogilvy Health", country: "Brazil", sources: [], entries: [entriesA[0]] },
    { key: "onesecondads|budweiser", title: "One Second Ads", brand: "Budweiser", agency: "AFRICA", country: "Brazil", sources: [], entries: [entriesA[0]] },
  ],
};
const mkDraft = (over = {}) => ({
  id: "vml-painvisible", title: "Painvisible", summary: "s", client: "Aritium", agency: "VML Madrid", categories: ["x"],
  award: "x", year: "2025", regions: ["欧州"], link: "https://example.com/p", thumbnail: "", videoId: null,
  overview: "o", background: "b", execution: "e", evaluationImpact: "v", tags: ["Tech/AI"], sources: ["x"], ...over,
});
const mkItem = (key, draft = {}, extra = {}) => ({ key, draft: mkDraft(draft), thumbnailCandidates: ["https://img/1.jpg"], pageUrls: ["https://page/1"], ...extra });

function setup(existing = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cannes-ingest-test-"));
  const casesPath = path.join(dir, "cases.json");
  fs.writeFileSync(casesPath, JSON.stringify(existing, null, 2) + "\n");
  const planPath = path.join(dir, "2025-plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan));
  const thumbDir = path.join(dir, "thumbs");
  fs.mkdirSync(thumbDir);
  const lockPath = path.join(dir, "git.lock");
  const calls = { audits: 0, commits: [], saveThumb: [], saveFromPage: [] };
  const base = {
    year: 2025, casesPath, planPath, thumbDir, lockPath, log: quiet, root: dir,
    saveThumb: async (id, url) => { calls.saveThumb.push([id, url]); fs.writeFileSync(path.join(thumbDir, `${id}.jpg`), "x"); return `/thumbnails/${id}.jpg`; },
    saveFromPage: async (id, url) => { calls.saveFromPage.push([id, url]); return null; },
    runAudits: async () => { calls.audits++; return { ok: true, failed: [] }; },
    gitCommit: async (paths, msg) => { calls.commits.push({ paths, msg }); },
  };
  return { dir, casesPath, thumbDir, lockPath, calls, base };
}
const readCases = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("slugifyId / makeCaseId", () => {
  assert.equal(slugifyId("Kimberly-Clark"), "kimberly-clark");
  assert.equal(slugifyId("Póker  Beer!"), "poker-beer");
  assert.equal(makeCaseId("Eurofarma", "Baby Minder"), "eurofarma-baby-minder");
  assert.equal(makeCaseId("Heinz", "Heinz Look Familiar"), "heinz-look-familiar");
});

test("正常系: 1件追加・id/award/awardEntries/videoId/サムネが5件の書式どおり・commitはパス指定", async () => {
  const t = setup([]);
  const r = await ingest({ ...t.base, drafts: [mkItem("painvisible|aritium")] });
  assert.equal(r.exitCode, 0);
  const cases = readCases(t.casesPath);
  assert.equal(cases.length, 1);
  const c = cases[0];
  assert.equal(c.id, "aritium-painvisible");
  assert.equal(c.year, "2025");
  assert.deepEqual(c.sources, ["Cannes 2025"]);
  assert.deepEqual(c.relatedWorks, []);
  assert.equal(c.award, "Cannes Lions 2025 Innovation Lions Silver / Cannes Lions 2025 Pharma Lions Bronze");
  assert.deepEqual(c.awardEntries, entriesA);
  assert.deepEqual(c.categories, ["Innovation", "Pharma"]);
  assert.equal(c.videoId, "");
  assert.equal(c.thumbnail, "/thumbnails/aritium-painvisible.jpg");
  assert.equal(c.client, "Aritium");
  assert.equal(t.calls.audits, 1);
  assert.equal(t.calls.commits.length, 1);
  assert.deepEqual(t.calls.commits[0].paths.sort(), ["cases.json", "thumbs/aritium-painvisible.jpg"].sort());
  assert.ok(!fs.existsSync(t.lockPath), "ロック解放済み");
});

test("key が plan に無い / 既に取り込み済みはスキップ、他は続行", async () => {
  const existing = [{ id: "aritium-painvisible", title: "Painvisible", client: "Aritium", year: "2025", award: "", awardEntries: entriesA }];
  const t = setup(existing);
  const r = await ingest({ ...t.base, drafts: [mkItem("nope|x"), mkItem("painvisible|aritium"), mkItem("babyminder|eurofarma", { title: "Baby Minder", client: "Eurofarma" })] });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.added, ["eurofarma-baby-minder"]);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped.find((s) => s.key === "nope|x").reason, /plan/);
  assert.match(r.skipped.find((s) => s.key === "painvisible|aritium").reason, /既に/);
});

test("id 衝突は -<year>、それでも衝突ならスキップ", async () => {
  const t1 = setup([{ id: "aritium-painvisible", title: "Other", client: "Z", year: "2020", award: "" }]);
  const r1 = await ingest({ ...t1.base, drafts: [mkItem("painvisible|aritium")] });
  assert.deepEqual(r1.added, ["aritium-painvisible-2025"]);
  const t2 = setup([
    { id: "aritium-painvisible", title: "Other", client: "Z", year: "2020", award: "" },
    { id: "aritium-painvisible-2025", title: "Other2", client: "Z", year: "2020", award: "" },
  ]);
  const r2 = await ingest({ ...t2.base, drafts: [mkItem("painvisible|aritium")] });
  assert.deepEqual(r2.added, []);
  assert.match(r2.skipped[0].reason, /衝突/);
  assert.equal(r2.exitCode, 0);
});

test("サムネ: candidates 順 → 全滅なら pageUrls 順、全滅の作品はスキップ（ファイルも残さない）", async () => {
  const t = setup([]);
  const tried = [];
  const r = await ingest({
    ...t.base,
    saveThumb: async (id, url) => { tried.push(url); if (url !== "https://img/2.jpg") return null; fs.writeFileSync(path.join(t.thumbDir, `${id}.jpg`), "x"); return `/thumbnails/${id}.jpg`; },
    drafts: [mkItem("painvisible|aritium", {}, { thumbnailCandidates: ["https://img/1.jpg", "https://img/2.jpg", "https://img/3.jpg"] })],
  });
  assert.deepEqual(tried, ["https://img/1.jpg", "https://img/2.jpg"]);
  assert.deepEqual(r.added, ["aritium-painvisible"]);

  const t2 = setup([]);
  const r2 = await ingest({
    ...t2.base,
    saveThumb: async () => null,
    saveFromPage: async (id, u) => { t2.calls.saveFromPage.push(u); return null; },
    drafts: [mkItem("painvisible|aritium", {}, { thumbnailCandidates: ["a"], pageUrls: ["https://p/1", "https://p/2"] })],
  });
  assert.deepEqual(t2.calls.saveFromPage, ["https://p/1", "https://p/2"]);
  assert.deepEqual(r2.added, []);
  assert.match(r2.skipped[0].reason, /サムネ/);
  assert.equal(readCases(t2.casesPath).length, 0);
  assert.equal(t2.calls.commits.length, 0);
});

test("dry-run: 何も書かない・ロックもサムネも触らない", async () => {
  const t = setup([]);
  const before = fs.readFileSync(t.casesPath, "utf8");
  const lines = [];
  const r = await ingest({ ...t.base, dryRun: true, log: (s) => lines.push(s), drafts: [mkItem("painvisible|aritium"), mkItem("nope|x")] });
  assert.equal(fs.readFileSync(t.casesPath, "utf8"), before);
  assert.equal(t.calls.saveThumb.length, 0);
  assert.equal(t.calls.audits, 0);
  assert.equal(t.calls.commits.length, 0);
  assert.deepEqual(r.added, ["aritium-painvisible"]);
  assert.ok(lines.join("\n").includes("aritium-painvisible"));
  assert.ok(lines.join("\n").includes("Pharma"));
});

test("監査失敗: cases.json とサムネを元に戻し exit 1、commit しない、ロック解放", async () => {
  const t = setup([]);
  const before = fs.readFileSync(t.casesPath, "utf8");
  const r = await ingest({ ...t.base, runAudits: async () => ({ ok: false, failed: ["audit-integrity"] }), drafts: [mkItem("painvisible|aritium")] });
  assert.equal(r.exitCode, 1);
  assert.equal(fs.readFileSync(t.casesPath, "utf8"), before);
  assert.deepEqual(fs.readdirSync(t.thumbDir), []);
  assert.equal(t.calls.commits.length, 0);
  assert.ok(!fs.existsSync(t.lockPath));
});

test("commit 失敗でも元に戻して exit 1", async () => {
  const t = setup([]);
  const before = fs.readFileSync(t.casesPath, "utf8");
  const r = await ingest({ ...t.base, gitCommit: async () => { throw new Error("boom"); }, drafts: [mkItem("painvisible|aritium")] });
  assert.equal(r.exitCode, 1);
  assert.equal(fs.readFileSync(t.casesPath, "utf8"), before);
  assert.deepEqual(fs.readdirSync(t.thumbDir), []);
  assert.ok(!fs.existsSync(t.lockPath));
});

test("ロックが取れない: 何も書かず exit 1（サムネも残さない）", async () => {
  const t = setup([]);
  const before = fs.readFileSync(t.casesPath, "utf8");
  assert.equal(tryAcquire(t.lockPath, "other"), true);
  try {
    const r = await ingest({ ...t.base, drafts: [mkItem("painvisible|aritium")] });
    assert.equal(r.exitCode, 1);
    assert.equal(fs.readFileSync(t.casesPath, "utf8"), before);
    assert.deepEqual(fs.readdirSync(t.thumbDir), []);
    assert.equal(t.calls.audits, 0);
  } finally {
    releaseOwnedLock(t.lockPath);
  }
});

test("draft に必須本文が無い作品はスキップ", async () => {
  const t = setup([]);
  const r = await ingest({ ...t.base, drafts: [mkItem("painvisible|aritium", { overview: "" })] });
  assert.deepEqual(r.added, []);
  assert.match(r.skipped[0].reason, /draft/);
});
