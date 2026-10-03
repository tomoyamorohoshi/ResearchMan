/**
 * Exhibition 日次収集で追加したページの本番反映確認。
 *
 * verify-deploy.mjs は home/サムネ/cases.json 新規ページのみ検査し、
 * Vercelビルド完了は保証しない（OPERATIONS.md「verify-deployの限界」）。
 * このスクリプトが os.tmpdir()/researchman-exhibition-last-add.json の追加分について
 * /exhibition/{id} が 200 を返すまでポーリングする（最大360秒）。
 * 追加0件なら即 exit 0。
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { httpGet } from "./verify-video.mjs";

const SITE = "https://research-man.vercel.app";
const SUMMARY_PATH = path.join(os.tmpdir(), "researchman-exhibition-last-add.json");
const MAX_TRIES = 24;
const INTERVAL_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let summary = { count: 0, cases: [] };
try {
  summary = JSON.parse(await fs.readFile(SUMMARY_PATH, "utf-8"));
} catch {}

if (!summary.count) {
  console.log("[verify-exhibition] 追加0件 → 確認不要");
  process.exit(0);
}

const paths = summary.cases.map((c) => `/exhibition/${c.id}`);
console.log(`[verify-exhibition] ${paths.length}ページの反映確認中（最大${(MAX_TRIES * INTERVAL_MS) / 1000}秒）...`);

for (let i = 1; i <= MAX_TRIES; i++) {
  const results = [];
  for (const p of paths) {
    const res = await httpGet(`${SITE}${p}`, { maxBytes: 2000 });
    results.push({ p, ok: res?.status === 200 });
  }
  if (results.every((r) => r.ok)) {
    console.log(`[verify-exhibition] ✓ 全ページ200（試行${i}回目）: ${paths.join(", ")}`);
    process.exit(0);
  }
  if (i < MAX_TRIES) await sleep(INTERVAL_MS);
  else {
    const ng = results.filter((r) => !r.ok).map((r) => r.p);
    console.log(`[verify-exhibition] ⏳ 時間切れ: 未反映 ${ng.join(", ")}`);
    process.exit(1);
  }
}
