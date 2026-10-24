#!/usr/bin/env node
// 座標未登録の会場を Nominatim で引いて data/venue-geo.json に追記する。仕様: docs/EXHIBITION_VISIT_SPEC.md §3
// 使い方: node scripts/geocode-venues.mjs [--dry-run] [--offline]
//   --dry-run  ネットワークは呼ぶが書き込まない（取得予定と結果を表示のみ）
//   --offline  ネットワークを呼ばず、未登録会場を列挙するだけ
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { todayJst } from "./lib/exhibition-status.mjs";
import { appendSystemAlert } from "./lib/system-alerts.mjs";
import { createThrottle, geocodeAll, loadGeo, pendingVenues, writeGeoAtomic } from "./lib/venue-geo.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXH = path.join(ROOT, "data", "exhibition.json");
const GEO = path.join(ROOT, "data", "venue-geo.json");

function repoUrl() {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" });
  const u = r.status === 0 ? r.stdout.trim().replace(/\.git$/, "") : "";
  return /^https?:\/\//.test(u) ? u : "https://github.com/tomoyamorohoshi/ResearchMan";
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const offline = args.has("--offline");

const items = JSON.parse(fs.readFileSync(EXH, "utf8")).items || [];
const geo = loadGeo(GEO);
const todo = pendingVenues(items, geo);
console.log(`未登録会場: ${todo.length} 件`);
if (offline || todo.length === 0) {
  for (const v of todo) console.log(`  - ${v.venue}（${v.prefecture} ${v.city}）`);
  process.exit(0);
}

const userAgent = `ResearchMan-venue-geocoder/1.0 (+${repoUrl()})`;
const { added, failed, skipped, blocked } = await geocodeAll(items, geo, {
  wait: createThrottle(),
  userAgent,
  today: todayJst(),
  onAdded: dryRun ? undefined : (g) => writeGeoAtomic(GEO, g),
  onResult: (v, r) =>
    console.log(r ? `  OK  ${v.venue}: ${r.lat}, ${r.lng}  [${r.displayName}]` : `  --  ${v.venue}: 取得できず（${v.prefecture} ${v.city}）`),
});

if (dryRun) {
  console.log(`dry-run: 追加予定 ${added.length} 件 / 未取得 ${failed.length} 件（書き込みなし）`);
  process.exit(0);
}
const list = (vs) => vs.map((v) => `${v.venue}（${v.prefecture} ${v.city}）`).join("\n");
if (blocked) {
  // 429/403 は「取得できなかった」と「打ち切り」を1件にまとめる
  appendSystemAlert({
    source: "geocode-venues",
    level: "warn",
    title: `Nominatim が HTTP ${blocked} を返したため会場の座標取得を打ち切りました（未処理 ${failed.length + skipped.length}件）`,
    body: list([...failed, ...skipped]),
  });
} else {
  if (failed.length > 0) {
    appendSystemAlert({
      source: "geocode-venues",
      level: "warn",
      title: `会場の座標を取得できませんでした（${failed.length}件）`,
      body: list(failed),
    });
  }
  if (skipped.length > 0) {
    appendSystemAlert({
      source: "geocode-venues",
      level: "warn",
      title: `会場の座標取得が1回の上限（件数または時間）に達しました（${skipped.length}件を次回へ繰り越し）`,
      body: list(skipped),
    });
  }
}
console.log(`追加 ${added.length} 件 / 未取得 ${failed.length} 件`);
