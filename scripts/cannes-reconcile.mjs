/**
 * Cannes 年別の「受賞リスト（web JSON）→ cases.json」突き合わせ（docs/CANNES_10Y_DESIGN.md §5-2・§5-3・§5-5）。
 *
 * 使い方: node scripts/cannes-reconcile.mjs <year> [--dry-run]
 *   入力: data/cannes/web/<year>-web.json の winners[]、任意の data/cannes/aliases.json
 *   出力: data/cannes/work/<year>-plan.json（--dry-run でも書く）
 *   --dry-run なしのときだけ data/cases.json に適用（matched の事例へ awardEntries 追記、
 *   award 文字列に当該年の Cannes 記載が無ければ正規形を " / " 区切りで末尾追記）。既存記載は書き換えない。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { makeTextUtils } from "./audit-award.mjs";
import { normalizeCannesCategory, formatCannesAward } from "./lib/cannes-categories.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const STOP = ["the", "a", "an", "of", "and", "for", "to", "in", "on", "is", "campaign", "lions", "x", "by", "ft", "feat"];

// 当該年の Cannes 記載か（audit-cannes / awards.ts の判定: "cannes" を含む。日本語表記 "カンヌ" も拾う）
export function segmentHasCannesYear(seg, year) {
  const s = String(seg || "");
  return /cannes|カンヌ/i.test(s) && new RegExp(`(^|[^0-9])${year}([^0-9]|$)`).test(s);
}
const awardSegments = (award) => String(award || "").split("/").map((s) => s.trim()).filter(Boolean);
export const awardHasCannesYear = (award, year) => awardSegments(award).some((s) => segmentHasCannesYear(s, year));

export function makeMatcher(year) {
  const stopwords = new Set([...STOP, String(year)]);
  const { toks, jac, flat } = makeTextUtils(stopwords);
  // flat が空（日本語のみ等）になる名前は小文字化した原文で代用して、別作品が1つに畳まれないようにする
  const keyPart = (s) => flat(s) || String(s || "").trim().toLowerCase();
  return { toks, jac, flat, workKey: (w) => `${keyPart(w.title)}|${keyPart(w.brand)}` };
}

// winners 行 → 作品（title+brand の正規化キー）へ畳む。同部門（正規化一致）・同レベルは1エントリ
export function collapseWinners(winners, year) {
  const { workKey } = makeMatcher(year);
  const works = new Map();
  for (const w of winners) {
    const key = workKey(w);
    if (!works.has(key)) {
      works.set(key, { key, title: w.title, brand: w.brand, agency: w.agency, country: w.country, sources: [], entries: [], _seen: new Set() });
    }
    const wk = works.get(key);
    for (const s of w.sources || []) if (!wk.sources.includes(s)) wk.sources.push(s);
    const ek = `${normalizeCannesCategory(w.category)}::${w.level}`;
    if (wk._seen.has(ek)) continue;
    wk._seen.add(ek);
    wk.entries.push({ org: "cannes", year: Number(year), category: w.category, level: w.level });
  }
  return [...works.values()].map(({ _seen, ...rest }) => rest);
}

export function checkCounts(counts, workCount) {
  const sum = counts.matched + counts.ambiguous + counts.new;
  if (sum !== workCount || counts.works !== workCount) {
    throw new Error(`件数不一致: matched(${counts.matched})+ambiguous(${counts.ambiguous})+new(${counts.new})=${sum} / 作品数=${workCount}`);
  }
}

/** winners と cases を直接渡して計画を作る（ファイル入出力なし） */
export function buildPlan({ year, winners, cases, aliases = {}, generatedAt = new Date().toISOString() }) {
  const { toks, jac, flat } = makeMatcher(year);
  const works = collapseWinners(winners, year);
  const yearAlias = aliases[String(year)] || {};
  const byId = new Map(cases.map((c) => [c.id, c]));
  const idx = cases.map((c) => ({ c, f: flat(c.title), t: toks(c.title), cl: flat(c.client) }));

  const matched = [], ambiguous = [], fresh = [];
  const matchedCaseIds = new Set();
  for (const wk of works) {
    const f = flat(wk.title);
    const aliasId = f && yearAlias[f];
    let hits;
    if (aliasId && byId.has(aliasId)) hits = [byId.get(aliasId)];
    else {
      const rt = toks(wk.title), rb = flat(wk.brand);
      hits = [];
      for (const x of idx) {
        if (f && x.f === f) hits.push(x.c);
        else if (rb && x.cl && (x.cl.includes(rb) || rb.includes(x.cl)) && jac(rt, x.t) >= 0.3) hits.push(x.c);
      }
    }
    const work = { key: wk.key, title: wk.title, brand: wk.brand, agency: wk.agency, country: wk.country, sources: wk.sources };
    if (hits.length === 1) {
      matchedCaseIds.add(hits[0].id);
      matched.push({ caseId: hits[0].id, work, entries: wk.entries });
    } else if (hits.length > 1) {
      hits.forEach((h) => matchedCaseIds.add(h.id));
      ambiguous.push({ work, entries: wk.entries, candidateCaseIds: hits.map((h) => h.id) });
    } else {
      fresh.push({ ...work, entries: wk.entries, award: wk.entries.map((e) => formatCannesAward(e)).join(" / ") });
    }
  }
  const unmatchedExisting = cases
    .filter((c) => awardHasCannesYear(c.award, year) && !matchedCaseIds.has(c.id))
    .map((c) => ({ caseId: c.id, title: c.title, award: c.award }));
  const counts = {
    winnerRows: winners.length, works: works.length,
    matched: matched.length, ambiguous: ambiguous.length, new: fresh.length,
    unmatchedExisting: unmatchedExisting.length,
  };
  checkCounts(counts, works.length);
  return { year: Number(year), generatedAt, counts, matched, ambiguous, new: fresh, unmatchedExisting };
}

/** matched を cases に適用（破壊的変更。変更した事例数を返す）。ambiguous / new は触らない */
export function applyPlan(cases, plan) {
  const year = plan.year;
  const byId = new Map(cases.map((c) => [c.id, c]));
  let changed = 0;
  for (const m of plan.matched) {
    const c = byId.get(m.caseId);
    if (!c) continue;
    let touched = false;
    const entries = Array.isArray(c.awardEntries) ? c.awardEntries : [];
    for (const e of m.entries) {
      const dup = entries.some((x) => x.org === "cannes" && Number(x.year) === Number(e.year) && x.level === e.level
        && normalizeCannesCategory(x.category) === normalizeCannesCategory(e.category));
      if (!dup) { entries.push({ org: "cannes", year: e.year, category: e.category, level: e.level }); touched = true; }
    }
    if (entries.length) c.awardEntries = entries;
    if (!awardHasCannesYear(c.award, year)) {
      const add = m.entries.map((e) => formatCannesAward(e)).join(" / ");
      c.award = c.award ? `${c.award} / ${add}` : add;
      touched = true;
    }
    if (touched) changed++;
  }
  return changed;
}

function main() {
  const year = process.argv[2];
  const dry = process.argv.includes("--dry-run");
  if (!/^\d{4}$/.test(year || "")) { console.error("usage: node scripts/cannes-reconcile.mjs <year> [--dry-run]"); process.exit(2); }
  const web = JSON.parse(fs.readFileSync(path.join(ROOT, `data/cannes/web/${year}-web.json`), "utf8"));
  const casesPath = path.join(ROOT, "data/cases.json");
  const casesText = fs.readFileSync(casesPath, "utf8");
  const cases = JSON.parse(casesText);
  const aliasPath = path.join(ROOT, "data/cannes/aliases.json");
  const aliases = fs.existsSync(aliasPath) ? JSON.parse(fs.readFileSync(aliasPath, "utf8")) : {};

  let plan;
  try { plan = buildPlan({ year, winners: web.winners, cases, aliases }); }
  catch (e) { console.error(String(e.message || e)); process.exit(1); }

  const outDir = path.join(ROOT, "data/cannes/work");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${year}-plan.json`), JSON.stringify(plan, null, 2) + "\n");
  console.log(`[cannes-reconcile ${year}] counts: ${JSON.stringify(plan.counts)}`);

  if (!dry) {
    const changed = applyPlan(cases, plan);
    const eol = casesText.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2) + eol);
    console.log(`[cannes-reconcile ${year}] applied: ${changed} cases updated`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
