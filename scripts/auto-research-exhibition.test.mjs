// scripts/auto-research-exhibition.mjs の統合テスト（node:test）。--status-only は Claude/ネットワークを一切使わない。
// 実行: node --test scripts/auto-research-exhibition.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "auto-research-exhibition.mjs");

function item(over) {
  return {
    id: "x", slug: "x", title: "t", artists: [], venue: "v", venueType: "museum", prefecture: "東京都", city: "c",
    startDate: "2026-09-01", endDate: "2026-10-03", status: "ongoing", admission: "無料", tags: ["light"], score: 70,
    matchReason: "m", sources: [{ name: "o", url: "https://e.example/x", kind: "official" }], link: "https://e.example/x",
    thumbnail: "/thumbnails/exhibition/x.jpg", addedAt: "2026-09-01T00:00:00.000Z", origin: "auto", highlight: false, ...over,
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exh-job-test-"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exh-job-tmp-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const data = {
    version: 1,
    statusAsOf: "2026-10-03",
    items: [item({}), item({ id: "y", slug: "y", startDate: "2026-10-04", endDate: "2026-10-30", status: "upcoming" })],
  };
  fs.writeFileSync(path.join(root, "data/exhibition.json"), JSON.stringify(data, null, 2));
  return { root, tmp, dataPath: path.join(root, "data/exhibition.json") };
}

function run({ root, tmp }, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf-8",
    env: { ...process.env, EXHIBITION_JOB_ROOT: root, EXHIBITION_JOB_TODAY: "2026-10-04", EXHIBITION_JOB_TMPDIR: tmp },
  });
}

test("--status-only: ended 遷移・statusAsOf 更新・サマリー0件を書く（Claude 不使用）", () => {
  const s = setup();
  const r = run(s, ["--status-only"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(fs.readFileSync(s.dataPath, "utf-8"));
  assert.equal(out.statusAsOf, "2026-10-04");
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].status, "ended");
  assert.equal(out.items[0].thumbnail, "/thumbnails/exhibition/x.jpg");
  assert.equal(out.items[1].status, "ongoing");
  const summary = JSON.parse(fs.readFileSync(path.join(s.tmp, "researchman-exhibition-last-add.json"), "utf-8"));
  assert.deepEqual(summary, { count: 0, cases: [] });
});

test("サマリー JSON は stale な前回値があっても 0 件で必ず上書きされる", () => {
  const s = setup();
  const sp = path.join(s.tmp, "researchman-exhibition-last-add.json");
  fs.writeFileSync(sp, JSON.stringify({ count: 3, cases: [{ id: "old", title: "old", year: "2026-01-01" }] }));
  const r = run(s, ["--status-only"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(sp, "utf-8")), { count: 0, cases: [] });
});

test("--dry-run: data もサマリーも変更しない", () => {
  const s = setup();
  const before = fs.readFileSync(s.dataPath, "utf-8");
  const r = run(s, ["--status-only", "--dry-run"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(s.dataPath, "utf-8"), before);
  assert.equal(fs.existsSync(path.join(s.tmp, "researchman-exhibition-last-add.json")), false);
});
