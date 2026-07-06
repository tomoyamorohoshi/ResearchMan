/**
 * アイデアの種 バックフィル（一回限り実行・2026-07-07）。
 *
 * ~/.researchman-idea-history.json（テキストのみの種履歴。古い順に並んでいる。
 * generate-idea-seeds.mjs が `history = [...history, ...新規seeds]` で末尾に追記するため）から、
 * data/ideas.json の初期データ（archive-1..N。1=最も古い種）を生成する:
 *   - タイトル: Claude CLI(sonnet)にまとめて一括生成させる（1回・欠落があれば1回だけ再試行）。
 *     欠落が残る場合はideas.jsonへの書き込みを中止する（空タイトルを恒久データにしないため。
 *     seed完全一致で既存判定するので、書き込み前に中止すれば単純に再実行できる）
 *   - 参照: seed文中に登場する事例/技術タイトルを正規化タイトル照合で復元する
 *     （generate-idea-seeds.mjsのnormTitleを共有する scripts/lib/match-refs-in-text.mjs 経由。
 *     履歴にはモデルが出した参照idが残っていないため、id直引きではなく文中のタイトル出現を
 *     機械的にスキャンする）。復元できなくても0件で掲載する
 *   - pattern=null, date=null（配信当時のパターン・配信日は履歴に残っていないため不明扱い）
 *
 * 既存エントリとseedが完全一致するものはスキップする（再実行しても重複しない＝冪等）。
 * 出力は data/ideas.json の先頭（既存エントリより前）に挿入する。
 *
 * 使い方: node scripts/backfill-idea-seeds.mjs
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJsonArray } from "./lib/claude-cli.mjs";
import { matchRefsInText } from "./lib/match-refs-in-text.mjs";
import { readIdeasJsonSafe, writeJsonAtomic } from "./lib/ideas-io.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const HISTORY_PATH = process.env.HISTORY_PATH || path.join(os.homedir(), ".researchman-idea-history.json");
const IDEAS_JSON_PATH = process.env.IDEAS_JSON_PATH || path.join(__dirname, "../data/ideas.json");
const MODEL = "sonnet";
const TIMEOUT_MS = 300000;
const BATCH_SIZE = 50; // 現状の履歴件数(40程度)なら1回で収まる。増えた場合のみ複数回に分割

function buildTitlePrompt(items) {
  const lines = items.map((it) => `${it.index}. ${it.seed}`).join("\n");
  return `以下は広告・体験企画の「アイデアの種」一覧。それぞれに短くわかりやすい見出し（タイトル）を付けて。

# ルール
- 10〜18字・体言止め推奨・記号や絵文字なし
- その種の内容が一目でわかる具体的な見出しにする（「アイデアその1」のような抽象的な見出しは不可）
- 件数分すべてに付ける（省略しない）

# 種一覧
${lines}

# 出力
JSON配列のみ（前置き・後書きなし）。indexは入力の番号をそのまま使う:
[{"index": 1, "title": "..."}]`;
}

// タイトルをまとめて生成する。欠落indexがあれば1回だけ再試行する（全体で最大2回のCLI呼び出し）
function generateTitles(claudeBin, seeds) {
  const items = seeds.map((seed, i) => ({ index: i + 1, seed }));
  const titleByIndex = new Map();

  function runBatch(batchItems) {
    const result = runClaudeJsonArray(claudeBin, buildTitlePrompt(batchItems), {
      timeout: TIMEOUT_MS,
      marker: "title",
      model: MODEL,
    });
    for (const r of result) {
      if (r && typeof r.index === "number" && r.title) titleByIndex.set(r.index, String(r.title).trim());
    }
  }

  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));
  batches.forEach((b, i) => {
    console.log(`タイトル生成 バッチ${i + 1}/${batches.length}（${b.length}件）...`);
    runBatch(b);
  });

  const missing = items.filter((it) => !titleByIndex.has(it.index));
  if (missing.length > 0) {
    console.log(`タイトル欠落${missing.length}件 → 再試行...`);
    runBatch(missing);
  }

  return items.map((it) => titleByIndex.get(it.index) || null);
}

async function main() {
  const history = JSON.parse(await fs.readFile(HISTORY_PATH, "utf-8")); // 古い順の種文字列配列
  console.log(`履歴 ${history.length}件を読み込み（${HISTORY_PATH}）`);

  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
  const catalog = [
    ...cases.map((c) => ({ type: "case", id: c.id, title: c.title, summary: c.summary })),
    ...tech.map((t) => ({ type: "tech", id: t.id, title: t.title, summary: t.summary })),
  ];

  // 破損時はthrowで中止（catchで握り潰して[]から書き直すと既存データを全損する。
  // ideas-io.mjs参照。ファイル無し=初回は[]で正常）
  const ideas = await readIdeasJsonSafe(IDEAS_JSON_PATH);
  const existingSeeds = new Set(ideas.map((idea) => idea.seed));

  const toProcess = history.map((seed, i) => ({ seed, n: i + 1 })).filter(({ seed }) => !existingSeeds.has(seed));

  if (toProcess.length === 0) {
    console.log("バックフィル対象なし（全件すでに掲載済み）");
    return;
  }
  console.log(`バックフィル対象: ${toProcess.length}件（既存${history.length - toProcess.length}件はseed一致でスキップ）`);

  const claudeBin = resolveClaudeBin();
  const titles = generateTitles(claudeBin, toProcess.map((x) => x.seed));

  const missingIdx = titles
    .map((t, i) => (t ? null : toProcess[i].n))
    .filter((n) => n !== null);
  if (missingIdx.length > 0) {
    console.error(
      `❌ タイトル生成が${missingIdx.length}件欠落（履歴index: ${missingIdx.join(",")}）。` +
        `ideas.jsonへの書き込みを中止します（空タイトルを残さないため）。再実行してください。`
    );
    process.exit(1);
  }

  let refTotal = 0;
  let withRef = 0;
  const archiveEntries = toProcess.map(({ seed, n }, i) => {
    const matched = matchRefsInText(seed, catalog);
    if (matched.length > 0) withRef++;
    refTotal += matched.length;
    return {
      id: `archive-${n}`,
      date: null,
      title: titles[i],
      pattern: null,
      seed,
      refs: matched.map((m) => ({
        type: m.type,
        id: m.id,
        title: m.title,
        desc: (m.summary || "").slice(0, 70),
      })),
    };
  });

  const merged = [...archiveEntries, ...ideas];
  await writeJsonAtomic(IDEAS_JSON_PATH, merged); // 原子書き込み（ideas-io.mjs参照）

  console.log(
    `✅ バックフィル完了: ${archiveEntries.length}件処理・全件title付き・` +
      `ref復元あり${withRef}件/${archiveEntries.length}件（ref総数${refTotal}件） → ${IDEAS_JSON_PATH}（計${merged.length}件）`
  );
}

main().catch((e) => {
  console.error("❌ エラー:", e.message);
  process.exit(1);
});
