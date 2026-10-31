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
    yearVerified: r.yearVerified === true,
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
    entryTypeId: r.entryTypeId,
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

// 公式部門名の正規化: 大文字小文字・記号・"Lions"/"for" だけを吸収する（曖昧一致はしない）
export function normalizeCategoryName(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && t !== 'lions' && t !== 'lion' && t !== 'for')
    .join(' ');
}

export function checkExpected(categories, expected) {
  if (!Array.isArray(expected)) return { expectedCheck: 'skipped' };
  const have = new Set(categories.map((c) => normalizeCategoryName(c.category)));
  const missingCategories = expected.filter((n) => !have.has(normalizeCategoryName(n)));
  return { expectedCheck: missingCategories.length ? 'failed' : 'ok', missingCategories };
}

// 完全性フラグ（ok / missingCategories / expectedCheck）を付与する。scan/fetchErrors は呼び出し側が設定済みであること
function finalize(out, expected) {
  const { expectedCheck, missingCategories } = checkExpected(out.categories, expected);
  out.expectedCheck = expectedCheck;
  if (missingCategories) out.missingCategories = missingCategories;
  else delete out.missingCategories;
  // 年が未確認の部門・走査の打ち切り(capped/aborted)・取得エラー・0部門・期待部門の欠けはすべて ok:false(fail-closed)
  out.yearUnverifiedIds = out.categories.filter((c) => c.yearVerified !== true).map((c) => c.entryTypeId);
  out.yearVerified = out.categories.length > 0 && out.yearUnverifiedIds.length === 0;
  out.ok =
    (out.fetchErrors ?? []).length === 0 &&
    out.categories.length > 0 &&
    out.yearUnverifiedIds.length === 0 &&
    !out.scan?.capped &&
    !out.scan?.aborted &&
    expectedCheck !== 'failed';
  return out;
}

// 既存出力をオフラインで再検証（ネットワーク不要）
export function revalidateOutput(existing, expected) {
  const out = { ...existing };
  out.fetchErrors = existing.fetchErrors ?? [];
  out.scan = existing.scan ?? { recorded: false };
  const { ok, expectedCheck, missingCategories, yearVerified, yearUnverifiedIds, ...rest } = out; // 並び順を保つため再構成
  return finalize({ ...rest }, expected);
}

export function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// results: scrape_lovethework.py の results 配列。existing: 部分実行時に引き継ぐ既存出力(or null)
// opts: { expected: 公式部門名の配列|undefined, scan: scrape の走査範囲記録 }
export function buildOutput(year, results, existing, generatedAt = new Date().toISOString(), opts = {}) {
  const found = results.filter((r) => r.exists === true);
  const absent = results.filter((r) => r.exists === false);
  const errs = results.filter((r) => r.exists !== true && r.exists !== false);
  const fetchErrors = errs.map((r) => ({
    entryTypeId: r.entryTypeId,
    tableUrl: r.tableUrl,
    httpStatus: r.fetchError?.httpStatus ?? null,
    error: r.fetchError?.error ?? r.error ?? 'unknown',
  }));
  const notFoundDetail = absent.map((r) => ({ entryTypeId: r.entryTypeId, httpStatus: r.httpStatus ?? null }));
  let categories = found.map(categoryRecord);
  let winners = found.flatMap(winnerRecords);
  let prevNotFoundDetail = [];
  let prevFetchErrors = [];
  // scan = 直近の「全走査」の記録。id 指定の部分実行は partialRuns に追記し、全走査の capped/aborted を上書きしない
  let scan = opts.scan;
  let partialRuns = existing?.partialRuns ?? [];
  if (scan?.explicit) {
    partialRuns = [...partialRuns, { at: generatedAt, ...scan }];
    scan = existing?.scan;
  }
  if (existing) {
    // 置換対象は「結果が確定した id」(発見 or 確定404)。fetchError の id は旧データを温存する
    const replaced = new Set([...found, ...absent].map((r) => r.entryTypeId));
    const allIds = new Set(results.map((r) => r.entryTypeId));
    const idByName = new Map(existing.categories.map((c) => [c.category, c.entryTypeId]));
    const winnerId = (w) => w.entryTypeId ?? idByName.get(w.category);
    categories = [...existing.categories.filter((c) => !replaced.has(c.entryTypeId)), ...categories];
    winners = [...existing.winners.filter((w) => !replaced.has(winnerId(w))), ...winners];
    const prevDetail = existing.notFoundDetail ?? (existing.notFound ?? []).map((id) => ({ entryTypeId: id, httpStatus: null }));
    prevNotFoundDetail = prevDetail.filter((d) => !allIds.has(d.entryTypeId));
    prevFetchErrors = (existing.fetchErrors ?? []).filter((e) => !allIds.has(e.entryTypeId));
  }
  const allNotFound = [...prevNotFoundDetail, ...notFoundDetail];
  const allFetchErrors = [...prevFetchErrors, ...fetchErrors];
  const out = {
    year,
    source: 'lovethework.com (Cannes Lions results table + winners-shortlists headings)',
    generatedAt,
    note: 'Grand Prix/Gold/Silver/Bronze(+Titanium等)のみ。Shortlistは見出し件数の参考値のみ(counts.Shortlist)。部門名はその年の公式名のまま。complete=見出し件数と取得件数が全レベルで一致。ok=取得エラー無し・走査完了・期待部門リスト(data/cannes/expected-categories.json)と一致(リスト無しは skipped)。yearVerified=結果表HTMLの年マーカーで年を確認済み。',
    ok: false,
    scan: scan ?? { recorded: false },
    partialRuns,
    categories,
    notFound: allNotFound.map((d) => d.entryTypeId),
    notFoundDetail: allNotFound,
    fetchErrors: allFetchErrors,
    winners,
  };
  return finalize(out, opts.expected);
}

export function loadExpected(year, file = path.join(ROOT, 'data', 'cannes', 'expected-categories.json')) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'))[String(year)]?.categories;
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
  const argv = process.argv.slice(2);
  const revalidate = argv[0] === '--revalidate';
  const [yearArg, ...ids] = revalidate ? argv.slice(1) : argv;
  const year = Number(yearArg);
  if (!Number.isInteger(year)) {
    console.error('usage: node scripts/fetch-cannes-winners.mjs [--revalidate] <year> [entry_type_id ...]');
    process.exit(2);
  }
  if (revalidate) {
    const f = path.join(ROOT, 'data', 'cannes', `${year}-winners.json`);
    const out = revalidateOutput(JSON.parse(fs.readFileSync(f, 'utf8')), loadExpected(year));
    writeJsonAtomic(f, out);
    console.log(`revalidated ${f}: ok=${out.ok} expectedCheck=${out.expectedCheck} missing=${(out.missingCategories ?? []).join(' | ') || '(none)'}`);
    process.exit(out.ok ? 0 : 1);
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
  const { results, scan } = extractJsonBlock(r.stdout);
  const outPath = path.join(ROOT, 'data', 'cannes', `${year}-winners.json`);
  const existing = ids.length && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  const out = buildOutput(year, results, existing, undefined, { expected: loadExpected(year), scan });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeJsonAtomic(outPath, out);
  for (const c of out.categories) {
    const cols = Object.entries(c.counts).map(([k, v]) => `${k} ${v.heading}/${v.scraped ?? '-'}`).join(' ');
    console.log(`${c.complete ? 'OK ' : 'NG '} ${c.category}: ${cols}`);
  }
  console.log(`notFound: ${out.notFound.join(",") || "(none)"}  winners: ${out.winners.length}  -> ${outPath}`);
  console.log(`ok=${out.ok} expectedCheck=${out.expectedCheck} yearVerified=${out.yearVerified} scan=${JSON.stringify(out.scan)}`);
  if (out.missingCategories?.length) console.error(`MISSING categories: ${out.missingCategories.join(" | ")}`);
  for (const e of out.fetchErrors) console.error(`FETCH ERROR id=${e.entryTypeId} status=${e.httpStatus} ${e.error}`);
  console.log(`colab: before=${usageBefore} | after=${usageAfter} | wall=${wall}s`);
  if (!out.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
