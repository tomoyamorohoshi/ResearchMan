#!/usr/bin/env node
// ローカル事例ナレッジ検索。data/cases.json（検証済み455件+）をキーワード/タグで検索する。
// ネットワークアクセスなし・読み取り専用。企画の下ごしらえ・リサーチの一次ソースとして使う。
//
// 使い方:
//   node scripts/search-cases.mjs AR 位置情報                  # キーワードOR検索（スコア順）
//   node scripts/search-cases.mjs 音楽 --all                   # --all で全キーワードAND
//   node scripts/search-cases.mjs --tag Tech/AI --year 2024-2026
//   node scripts/search-cases.mjs GPS --format md              # Markdown出力（レポート貼り付け用）
//   node scripts/search-cases.mjs --tag Form/Website --format json --limit 30
//
// オプション:
//   --tag <Tech/AI>      tags/categories に部分一致（複数指定可）
//   --year <2024-2026>   年range or 単年
//   --region <北米>      regions に部分一致
//   --source <cannes>    sources に部分一致（実値は "Cannes 2026" / "Radar" など。--source cannes 等で絞る）
//   --limit <n>          件数上限（デフォルト 12）
//   --format <list|md|json>  デフォルト list
//   --all                キーワードをANDで評価

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const keywords = [];
const tags = [];
let yearRange = null, region = null, source = null, limit = 12, format = 'list', requireAll = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--tag') tags.push(args[++i]);
  else if (a === '--year') yearRange = args[++i];
  else if (a === '--region') region = args[++i];
  else if (a === '--source') source = args[++i];
  else if (a === '--limit') limit = parseInt(args[++i], 10) || 12;
  else if (a === '--format') format = args[++i];
  else if (a === '--all') requireAll = true;
  else if (a.startsWith('--')) { console.error(`不明なオプション: ${a}`); process.exit(2); }
  else keywords.push(a);
}

const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'cases.json'), 'utf8'));
const cases = Array.isArray(raw) ? raw : raw.cases;

// フィールド重み: タイトル・タグの一致を本文一致より優先する
const WEIGHTS = [
  ['title', 5],
  ['tags', 4], ['categories', 4],
  ['summary', 3],
  ['client', 2], ['agency', 2], ['award', 2],
  ['overview', 1], ['background', 1], ['execution', 1], ['evaluationImpact', 1],
];

const norm = (v) => (Array.isArray(v) ? v.join(' ') : String(v ?? '')).toLowerCase();

function scoreCase(c, kws) {
  let total = 0;
  const hits = new Set();
  for (const kw of kws) {
    let kwScore = 0;
    for (const [field, w] of WEIGHTS) {
      if (norm(c[field]).includes(kw)) kwScore += w;
    }
    if (kwScore > 0) hits.add(kw);
    total += kwScore;
  }
  if (requireAll && hits.size < kws.length) return 0;
  return hits.size > 0 ? total : 0;
}

function inYearRange(c) {
  if (!yearRange) return true;
  const y = parseInt(c.year, 10);
  if (Number.isNaN(y)) return false;
  const m = yearRange.match(/^(\d{4})(?:-(\d{4}))?$/);
  if (!m) return true;
  const from = parseInt(m[1], 10), to = m[2] ? parseInt(m[2], 10) : from;
  return y >= from && y <= to;
}

const kws = keywords.map((k) => k.toLowerCase());

let results = cases
  .filter((c) => tags.every((t) => norm(c.tags).includes(t.toLowerCase()) || norm(c.categories).includes(t.toLowerCase())))
  .filter(inYearRange)
  .filter((c) => !region || norm(c.regions).includes(region.toLowerCase()))
  .filter((c) => !source || norm(c.sources).includes(source.toLowerCase()))
  .map((c) => ({ c, score: kws.length ? scoreCase(c, kws) : 1 }))
  .filter((r) => r.score > 0)
  .sort((a, b) => b.score - a.score || (parseInt(b.c.year, 10) || 0) - (parseInt(a.c.year, 10) || 0));

const total = results.length;
results = results.slice(0, limit);

if (format === 'json') {
  console.log(JSON.stringify(results.map(({ c, score }) => ({ score, id: c.id, title: c.title, year: c.year, client: c.client, award: c.award, summary: c.summary, link: c.link, tags: c.tags, categories: c.categories })), null, 2));
} else if (format === 'md') {
  console.log(`<!-- search-cases: ${keywords.join(' ')} ${tags.map((t) => `--tag ${t}`).join(' ')} → ${total}件中${results.length}件 -->`);
  for (const { c } of results) {
    console.log(`### ${c.title}（${c.year} / ${c.client || '—'}）`);
    if (c.award) console.log(`**受賞**: ${c.award}  `);
    console.log(`${c.summary || ''}  `);
    if (c.overview) console.log(`${c.overview}  `);
    console.log(`**リンク**: ${c.link}  `);
    const tg = [...(c.tags || []), ...(c.categories || [])].join(', ');
    if (tg) console.log(`**タグ**: ${tg}`);
    console.log('');
  }
} else {
  console.log(`${total}件ヒット（上位${results.length}件表示）\n`);
  for (const { c, score } of results) {
    console.log(`[${String(score).padStart(3)}] ${c.title} (${c.year}, ${c.client || '—'})`);
    if (c.award) console.log(`      🏆 ${c.award}`);
    console.log(`      ${(c.summary || '').slice(0, 80)}`);
    console.log(`      ${c.link}`);
    console.log('');
  }
}
