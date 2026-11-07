// 結合テスト: processCandidates(ownerIntake) が作った data を audit-exhibition.mjs に通して PASS すること。
// ケース: H1-A（投稿URLが TAB で照合失敗）/ H1-B（再調査が投稿URLを listing で返す）/ H2（同じ投稿から複数展示）/
//         M2（city 空の公式照合通過）/ M4（公式照合通過・サムネは投稿URLからだけ取れる）/ 終了済み / 1日イベント
// 実行: node --test scripts/lib/exhibition-owner-audit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { processCandidates } from "./exhibition-build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT = path.join(__dirname, "..", "audit-exhibition.mjs");
const VOCAB = path.join(__dirname, "..", "..", "data", "exhibition-tag-vocabulary.json");
const TODAY = "2026-11-07";

function cand(over = {}) {
  return {
    title: "Midnight Session", artists: [], venue: "Tokyo Jazz Club", venueType: "other", prefecture: "東京都", city: "港区",
    startDate: "2026-11-20", endDate: "2026-11-21", admission: "UNKNOWN", tags: [], score: 60, matchReason: "投稿された展示。",
    officialUrl: "", sources: [], excludeCategory: "none", origin: "intake", intakeUrl: "https://x.com/o/status/1", ...over,
  };
}
const page = (extra = "") => `<html><body><h1>Midnight Session</h1><p>Tokyo Jazz Club</p><p>2026年11月20日〜21日</p>${extra}</body></html>`;

test("owner-intake で追加された展示を含む data が audit-exhibition に通る（H1-A/H1-B/H2/M2/M4）", async () => {
  const TAB = "https://www.tokyoartbeat.com/events/-/Z/F9/2026-11-20";
  const pages = {
    [TAB]: "<html><body>別の展示 2026年1月1日</body></html>",
    "https://jazz.example/ok": page(),
    "https://hall.example/beta": "<html><body>x</body></html>",
  };
  const deps = {
    fetchHtml: async (u) => (u in pages ? { status: 200, body: pages[u] } : { status: 404, body: "" }),
    saveThumb: async (id, c) => (c.officialUrl === "https://jazz.example/ok" ? null : `/thumbnails/exhibition/${id}.jpg`), // M4: 公式からは取れない
    now: () => "2026-11-07T01:00:00.000Z",
    reinvestigate: async (c) => (c.title === "Reinvest Show" ? { sources: [{ name: "投稿", url: "https://x.com/o/status/3", kind: "listing" }] } : null),
  };
  const opts = { trustOrigin: true, ownerIntake: true };
  let data = { version: 1, statusAsOf: TODAY, items: [] };
  const cands = [
    cand({ title: "TAB Show", intakeUrl: TAB }), // H1-A
    cand({ title: "Reinvest Show", venue: "Reinvest Hall", intakeUrl: "https://x.com/o/status/3" }), // H1-B
    cand({ title: "Alpha Show", venue: "Alpha Hall", intakeUrl: "https://x.com/o/status/4" }), // H2: 同じ投稿から3件
    cand({ title: "Beta Show", venue: "Beta Hall", intakeUrl: "https://x.com/o/status/4", officialUrl: "https://hall.example/beta" }),
    cand({ title: "Gamma Show", venue: "Gamma Hall", intakeUrl: "https://x.com/o/status/4" }),
    cand({ officialUrl: "https://jazz.example/ok", city: "", intakeUrl: "https://x.com/o/status/5" }), // M2 + M4
    cand({ title: "Old Show", venue: "Old Hall", startDate: "2026-10-01", endDate: "2026-10-05", intakeUrl: "https://x.com/o/status/6" }), // 終了済み
    cand({ title: "One Day", venue: "Day Hall", startDate: "2026-11-30", endDate: "2026-11-30", intakeUrl: "https://x.com/o/status/7" }), // 1日
  ];
  const out = await processCandidates({ data, candidates: cands, today: TODAY, deps, opts });
  data = out.data;
  // Gamma は固有URLが無く link-collision で追加されない。それ以外は全部追加される
  assert.equal(out.added.length, 7, JSON.stringify([out.unverified, out.rejected, out.pending]));
  assert.ok(out.unverified.some((u) => u.title === "Gamma Show" && /link-collision/.test(u.reason)));
  const m4 = out.added.find((i) => i.link === "https://jazz.example/ok");
  assert.ok(m4 && m4.verifiedVia === undefined, "M4: 公式扱いのまま");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exh-ownaud-"));
  try {
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.mkdirSync(path.join(root, "public/thumbnails/exhibition"), { recursive: true });
    fs.writeFileSync(path.join(root, "data/exhibition.json"), JSON.stringify(data));
    fs.copyFileSync(VOCAB, path.join(root, "data/exhibition-tag-vocabulary.json"));
    fs.writeFileSync(path.join(root, "data/cases.json"), "[]");
    fs.writeFileSync(path.join(root, "data/tech.json"), "[]");
    fs.writeFileSync(path.join(root, "data/exhibition-profile.json"), JSON.stringify({ seeds: [] }));
    for (const it of data.items) fs.writeFileSync(path.join(root, "public", it.thumbnail), Buffer.alloc(8000, 1));
    const r = spawnSync(process.execPath, [AUDIT], { env: { ...process.env, EXHIBITION_AUDIT_ROOT: root, EXHIBITION_AUDIT_TODAY: TODAY }, encoding: "utf8" });
    const text = (r.stdout || "") + (r.stderr || "");
    assert.equal(r.status, 0, text.slice(0, 1500));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
