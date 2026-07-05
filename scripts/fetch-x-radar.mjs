/**
 * X（Twitter）検索を発見ソースに加えるためのフェッチスクリプト。
 * data/x-radar-queries.json のクエリ群を twscrape（捨て垢Cookie認証・ローカルSQLite）
 * で検索し、直近48hのツイートから外部リンクを持つもの上位20件を
 * /tmp/researchman-x-radar-YYYY-MM-DD.json（JST日付）へ保存する。
 *
 * auto-research-tech.mjs から非致命的に呼ばれる。twscrape未設定・失敗・
 * レート制限等、**あらゆる異常でexit 0**（収集パイプライン全体を絶対に止めない）。
 * 出力ファイルは0件・エラー時も必ず書く（呼び出し側が「今日は素材Cなし」と判断できるように）。
 *
 * 使い方: node scripts/fetch-x-radar.mjs [--dry-run]
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { jstDateString } from "./lib/jst-date.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = path.join(__dirname, "../data/x-radar-queries.json");
const DB_PATH = path.join(os.homedir(), ".researchman-twscrape.db");
const TMP_DIR = "/tmp";
const DRY_RUN = process.argv.includes("--dry-run");

const PER_QUERY_TIMEOUT_MS = 60000;
const TOTAL_BUDGET_MS = 300000;
const SEARCH_LIMIT = 20;
const MAX_ITEMS = 20;
const TEXT_MAX_CHARS = 200;
const LOOKBACK_HOURS = 48;
const FILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function resolveTwscrapeBin() {
  try {
    return execFileSync("which", ["twscrape"], { encoding: "utf-8" }).trim();
  } catch {
    const p = path.join(os.homedir(), ".local/bin/twscrape");
    try {
      execFileSync(p, ["version"], { encoding: "utf-8" });
      return p;
    } catch {
      return null;
    }
  }
}

function stripControlChars(s) {
  return (s || "").replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, " ").trim();
}

async function cleanupOldFiles() {
  if (DRY_RUN) return;
  try {
    const now = Date.now();
    for (const f of await fs.readdir(TMP_DIR)) {
      if (!f.startsWith("researchman-x-radar-")) continue;
      const fp = path.join(TMP_DIR, f);
      const st = await fs.stat(fp);
      if (now - st.mtimeMs > FILE_MAX_AGE_MS) await fs.unlink(fp);
    }
  } catch {
    // 掃除の失敗は無視（本体処理を止めない）
  }
}

function runSearch(bin, query, sinceDate) {
  const result = spawnSync(
    bin,
    ["--db", DB_PATH, "search", `${query} since:${sinceDate}`, "--limit", String(SEARCH_LIMIT)],
    { encoding: "utf-8", timeout: PER_QUERY_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 20 }
  );
  if (result.error || result.status !== 0) {
    return { ok: false, error: `${query}: ${result.error?.message || result.stderr?.slice(0, 200) || "unknown"}` };
  }
  const items = [];
  for (const line of (result.stdout || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line);
      items.push(t);
    } catch {
      // 1行のparse失敗はスキップ（全体は失敗にしない）
    }
  }
  return { ok: true, items };
}

async function main() {
  const dateStr = jstDateString();
  const outPath = path.join(TMP_DIR, `researchman-x-radar-${dateStr}.json`);

  // 冪等: 当日分が既にあればスキップ（キャッチアップ連打・手動dry-run連打でのクォータ浪費防止）
  try {
    await fs.access(outPath);
    console.log(`X radar: 本日分は既に取得済み（${outPath}）、スキップ`);
    return;
  } catch {
    // ファイルなし＝続行
  }

  await cleanupOldFiles();

  const bin = resolveTwscrapeBin();
  if (!bin) {
    console.log("X radar: twscrape未設定、スキップ");
    await fs.writeFile(outPath, JSON.stringify({ date: dateStr, fetchedAt: new Date().toISOString(), queries: [], items: [], errors: ["twscrape not found"] }, null, 2));
    return;
  }

  let queries;
  try {
    queries = JSON.parse(await fs.readFile(QUERIES_PATH, "utf-8"));
  } catch (e) {
    console.log(`X radar: クエリファイル読み込み失敗（${e.message}）、スキップ`);
    await fs.writeFile(outPath, JSON.stringify({ date: dateStr, fetchedAt: new Date().toISOString(), queries: [], items: [], errors: [`queries file: ${e.message}`] }, null, 2));
    return;
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10);
  const errors = [];
  const rawItems = [];
  const startedAt = Date.now();

  for (const q of queries) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      errors.push(`残り時間予算切れ、クエリ中断: ${q}`);
      break;
    }
    console.log(`X radar 検索中: ${q}`);
    const r = runSearch(bin, q, since);
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    rawItems.push(...r.items);
  }

  // 重複除去（tweet id基準）→ 非x.comの外部リンクを持つもののみ → likeCount降順 → 上位N件
  const seen = new Set();
  const filtered = [];
  for (const t of rawItems) {
    const id = t.id_str || t.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const links = (t.links || [])
      .filter((l) => l?.url && !/(^|\.)x\.com|(^|\.)twitter\.com/.test(new URL(l.url).hostname || ""))
      .map((l) => l.url);
    if (!links.length) continue;
    filtered.push({
      text: stripControlChars(t.rawContent).slice(0, TEXT_MAX_CHARS),
      url: t.url,
      author: t.user?.username || "",
      date: t.date,
      likeCount: t.likeCount || 0,
      links: [...new Set(links)],
    });
  }
  filtered.sort((a, b) => b.likeCount - a.likeCount);
  const items = filtered.slice(0, MAX_ITEMS).map((it) => ({ text: it.text, url: it.url, author: it.author, date: it.date, links: it.links }));

  console.log(`X radar: ${queries.length}クエリ実行 / 生ツイート${rawItems.length}件 / 外部リンク保有${filtered.length}件 → 採用${items.length}件${errors.length ? ` / エラー${errors.length}件` : ""}`);

  await fs.writeFile(
    outPath,
    JSON.stringify({ date: dateStr, fetchedAt: new Date().toISOString(), queries, items, errors }, null, 2)
  );
}

main().catch((e) => {
  // このスクリプトはあらゆる異常でexit 0（呼び出し元の収集パイプラインを止めない）
  console.log(`X radar: 予期しないエラー（${e.message}）、スキップ`);
});
