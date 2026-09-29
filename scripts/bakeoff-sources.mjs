/**
 * 情報源ベイクオフ（Radar v2 Phase 1。docs/RADAR_V2_DESIGN.md §4-8）。
 *
 * data/sources.json の kind=web 候補（enabled問わず）ごとに、一覧ページの直近N件を
 * Claude CLI（サブスク内・1候補1呼び出し）で取得＋関門A/B/C基準で採点し、
 * docs/SOURCE_BAKEOFF_<date>.md に accept率・件数・代表例を表で出力する。
 *
 * - read-only: cases.json / sources.json には一切書き込まない（何度でも再実行可）
 * - 1回の実行は最大30候補。超過分は再実行で続きを採点（採点済みは $TEMP に候補単位でキャッシュ）
 * - 並列実行したい場合は --skip で分割（例: 1本目は既定、2本目は --skip 30）
 *
 * 使い方:
 *   node scripts/bakeoff-sources.mjs [--limit 30] [--skip 0] [--n 10] [--timeout 240] [--date YYYY-MM-DD] [--only id1,id2] [--refresh] [--report-only]
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJson } from "./lib/claude-cli.mjs";
import { jstDateString } from "./lib/jst-date.mjs";
import { buildBakeoffPrompt, parseBakeoffOutput, summarizeBakeoff } from "./lib/case-gate-criteria.mjs";
import { selectCandidates, renderReport, BAKEOFF_MAX_PER_RUN } from "./lib/bakeoff-report.mjs";
import { validateSourcesRegistry } from "./lib/sources-registry.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const flag = (name) => process.argv.includes(`--${name}`);

const DATE = arg("date", jstDateString());
const N = parseInt(arg("n", "10"), 10);
const LIMIT = parseInt(arg("limit", String(BAKEOFF_MAX_PER_RUN)), 10);
const SKIP = parseInt(arg("skip", "0"), 10);
const TIMEOUT_MS = parseInt(arg("timeout", "240"), 10) * 1000;
const ONLY = arg("only", "") ? new Set(arg("only", "").split(",")) : null;
const CACHE_DIR = path.join(os.tmpdir(), `researchman-bakeoff-${DATE}`);
const REPORT_PATH = path.join(ROOT, "docs", `SOURCE_BAKEOFF_${DATE}.md`);

async function readCache(id) {
  try {
    return JSON.parse(await fs.readFile(path.join(CACHE_DIR, `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  const sources = JSON.parse(await fs.readFile(path.join(ROOT, "data", "sources.json"), "utf-8"));
  const v = validateSourcesRegistry(sources);
  if (!v.ok) {
    console.error("data/sources.json のスキーマ不正:\n" + v.errors.join("\n"));
    process.exit(1);
  }
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const webs = sources.filter((s) => s.kind === "web");

  const scoredIds = new Set();
  if (!flag("refresh")) for (const s of webs) if (await readCache(s.id)) scoredIds.add(s.id);

  if (!flag("report-only")) {
    const pool = ONLY ? sources.filter((s) => ONLY.has(s.id)) : sources;
    const { picked, remaining } = selectCandidates(pool, { scoredIds, limit: LIMIT, skip: SKIP });
    console.log(`ベイクオフ ${DATE}: 対象 ${picked.length} 候補（未採点の残り ${remaining}）/ 1候補timeout ${TIMEOUT_MS / 1000}s / 直近${N}件`);
    const claudeBin = resolveClaudeBin();
    let i = 0;
    for (const s of picked) {
      i++;
      const t0 = Date.now();
      try {
        const raw = runClaudeJson(claudeBin, buildBakeoffPrompt(s, N), {
          timeout: TIMEOUT_MS,
          marker: "bakeoffItems",
          model: "sonnet",
          allowedTools: "WebFetch,WebSearch",
        });
        const parsed = parseBakeoffOutput(raw);
        // 0件かつ理由なし＝JSON解釈不能・usage limit・CLI謝罪文などの一過性失敗。キャッシュせず未採点のまま残す
        if (parsed.items.length === 0 && !parsed.fetchNote) {
          console.error(`[${i}/${picked.length}] ${s.id}: 一過性失敗の疑い（0件・理由なし）→未採点のまま残す`);
          continue;
        }
        const summary = summarizeBakeoff(parsed.items);
        await fs.writeFile(
          path.join(CACHE_DIR, `${s.id}.json`),
          JSON.stringify({ id: s.id, scoredAt: new Date().toISOString(), items: parsed.items, summary, duplicatesRemoved: parsed.duplicatesRemoved, fetchNote: parsed.fetchNote }, null, 2)
        );
        console.log(`[${i}/${picked.length}] ${s.id}: ${summary.count}件 accept ${summary.accepted} (${Math.round((Date.now() - t0) / 1000)}s)`);
      } catch (e) {
        // タイムアウト等は未採点のまま残す（キャッシュしない＝再実行で再挑戦）
        console.error(`[${i}/${picked.length}] ${s.id}: 失敗 ${e.message.slice(0, 200)}`);
      }
    }
  }

  const results = [];
  for (const s of webs) {
    const c = await readCache(s.id);
    if (c) results.push({ id: s.id, locator: s.locator, tier: s.tier, summary: c.summary, fetchNote: c.fetchNote, duplicatesRemoved: c.duplicatesRemoved || 0 });
  }
  const unscored = webs.filter((s) => !results.some((r) => r.id === s.id)).map((s) => s.id);
  await fs.writeFile(REPORT_PATH, renderReport({ date: DATE, results, unscored, n: N }), "utf-8");
  console.log(`レポート: ${REPORT_PATH}（採点済み ${results.length} / 未採点 ${unscored.length}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
