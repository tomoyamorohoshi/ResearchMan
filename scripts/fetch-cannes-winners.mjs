#!/usr/bin/env node
// Cannes Lions 受賞一覧の取得ラッパー。
// 使い方: node scripts/fetch-cannes-winners.mjs <year> [entry_type_id ...]
//   WSL の colab CLI で scripts/colab/scrape_lovethework.py を Colab CPU ランタイム上で実行し、
//   標準出力の JSON ブロックを受けて data/cannes/<year>-winners.json に保存する。
//   id 指定あり: 既存ファイルのその部門だけ置き換え（無ければ新規作成）。id 省略: 全部門で作り直し。
// 設計: docs/CANNES_10Y_DESIGN.md 3-7節
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'colab', 'scrape_lovethework.py');
const COLAB = '~/.local/bin/colab';
const TIMEOUT_SEC = 3600;

export function extractJsonBlock(text) {
  const b = text.indexOf('===JSON_BEGIN===');
  const e = text.indexOf('===JSON_END===');
  if (b < 0 || e < 0 || e < b) throw new Error('JSON_BEGIN/JSON_END block not found in colab output');
  return JSON.parse(text.slice(b + '===JSON_BEGIN==='.length, e).trim());
}

export function toWslPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

export function parseUsage(text) {
  return text.split(/\r?\n/).find((l) => /balance/i.test(l))?.trim() ?? text.trim().slice(-200);
}

function categoryRecord(r) {
  const rec = {
    category: r.category,
    entryTypeId: r.entryTypeId,
    slug: r.slug ?? null,
    sourceUrl: r.sourceUrl,
    tableUrl: r.tableUrl,
    headings: r.headings,
    counts: r.counts,
    complete: !!r.complete,
  };
  if (!r.complete) {
    rec.incomplete = true;
    rec.mismatches = r.mismatches ?? [];
    if (r.headingsMissing) rec.headingsMissing = true;
  }
  return rec;
}

function winnerRecords(r) {
  return (r.cards ?? []).map((c) => ({
    category: r.category,
    subcategory: c.subcategory,
    level: c.level,
    title: c.title,
    brand: c.brand,
    product: c.product,
    agency: c.agency,
    location: c.location,
    prize: c.prize,
    entryUrl: c.entryUrl,
    sourceUrl: r.sourceUrl,
  }));
}

// results: scrape_lovethework.py の results 配列。existing: 部分実行時に引き継ぐ既存出力(or null)
export function buildOutput(year, results, existing, generatedAt = new Date().toISOString()) {
  const found = results.filter((r) => r.exists);
  const notFound = results.filter((r) => !r.exists).map((r) => r.entryTypeId);
  let categories = found.map(categoryRecord);
  let winners = found.flatMap(winnerRecords);
  let prevNotFound = [];
  if (existing) {
    const replaced = new Set(results.map((r) => r.entryTypeId));
    const replacedNames = new Set(found.map((r) => r.category));
    categories = [...existing.categories.filter((c) => !replaced.has(c.entryTypeId)), ...categories];
    winners = [...existing.winners.filter((w) => !replacedNames.has(w.category)), ...winners];
    prevNotFound = (existing.notFound ?? []).filter((id) => !replaced.has(id));
  }
  return {
    year,
    source: 'lovethework.com (Cannes Lions results table + winners-shortlists headings)',
    generatedAt,
    note: 'Grand Prix/Gold/Silver/Bronze(+Titanium等)のみ。Shortlistは見出し件数の参考値のみ(counts.Shortlist)。部門名はその年の公式名のまま。complete=見出し件数と取得件数が全レベルで一致。',
    categories,
    notFound: [...prevNotFound, ...notFound],
    winners,
  };
}

function wsl(cmd, opts = {}) {
  const r = spawnSync('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', cmd], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
  return r;
}

function main() {
  const [yearArg, ...ids] = process.argv.slice(2);
  const year = Number(yearArg);
  if (!Number.isInteger(year)) {
    console.error('usage: node scripts/fetch-cannes-winners.mjs <year> [entry_type_id ...]');
    process.exit(2);
  }
  const usageBefore = parseUsage(wsl(`${COLAB} usage`).stdout || '');
  console.error(`[colab usage before] ${usageBefore}`);
  const t0 = Date.now();
  const args = [year, ...ids].map((a) => `'${String(a).replace(/'/g, '')}'`).join(' ');
  const r = wsl(`${COLAB} run --timeout ${TIMEOUT_SEC} '${toWslPath(SCRIPT)}' ${args}`);
  const wall = Math.round((Date.now() - t0) / 1000);
  if (r.stderr) fs.writeFileSync(path.join(ROOT, 'tmp-colab-stderr.log'), r.stderr);
  const usageAfter = parseUsage(wsl(`${COLAB} usage`).stdout || '');
  console.error(`[colab usage after] ${usageAfter}  (wall ${wall}s)`);
  if (r.status !== 0) {
    console.error(`colab run failed (exit ${r.status}). stderr tail:\n${(r.stderr || '').slice(-1500)}`);
    process.exit(1);
  }
  fs.rmSync(path.join(ROOT, 'tmp-colab-stderr.log'), { force: true });
  const { results } = extractJsonBlock(r.stdout);
  const outPath = path.join(ROOT, 'data', 'cannes', `${year}-winners.json`);
  const existing = ids.length && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  const out = buildOutput(year, results, existing);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  for (const c of out.categories) {
    const cols = Object.entries(c.counts).map(([k, v]) => `${k} ${v.heading}/${v.scraped ?? '-'}`).join(' ');
    console.log(`${c.complete ? 'OK ' : 'NG '} ${c.category}: ${cols}`);
  }
  console.log(`notFound: ${out.notFound.join(",") || "(none)"}  winners: ${out.winners.length}  -> ${outPath}`);
  console.log(`colab: before=${usageBefore} | after=${usageAfter} | wall=${wall}s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
