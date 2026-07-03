/**
 * アイデアの種ジェネレーター（毎朝10時のLINE配信用）。
 *
 * Case Study（企画性）× Technology（技術）を掛け合わせ、10個の「種」を生成する。
 * 種は完成した企画である必要はない:
 *   - 技術×技術: 「AとBを組み合わせたらこんな表現ができるかも」
 *   - 文脈×技術: 「この文脈にこの技術を掛けたらこんな課題を解決できるかも」
 *   - 転用:     「本来の使い方でない使い方をしたらこんなことに役立つかも」
 *
 * 毎日ランダムサンプリングした事例・技術を素材にし、直近の種の履歴
 * （~/.researchman-idea-history.json）を渡して重複を避ける。
 * 出力: /tmp/researchman-idea-seeds.txt（notify-line.mjs --text-file が送る本文）
 *
 * 使い方: node scripts/generate-idea-seeds.mjs [--dry-run]
 *   --dry-run … 本文を出力するだけ（状態ファイル・履歴を更新しない）
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const LAST_RUN_PATH = path.join(__dirname, "../.last-idea-seeds-run.txt");
const HISTORY_PATH = path.join(os.homedir(), ".researchman-idea-history.json");
const OUT_PATH = "/tmp/researchman-idea-seeds.txt";
const DRY_RUN = process.argv.includes("--dry-run");

const SEED_COUNT = 10;
const CASE_SAMPLE = 14;
const TECH_SAMPLE = 12;
const HISTORY_KEEP = 60; // 履歴に保持する種の数
const HISTORY_IN_PROMPT = 20; // プロンプトに渡す「最近の種」の数
const MODEL = "sonnet";
const TIMEOUT_MS = 420000;

function resolveClaudeBin() {
  const CLAUDE_PATHS = ["/Users/tm/.local/bin/claude", "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  } catch {
    for (const p of CLAUDE_PATHS) {
      try {
        execFileSync(p, ["--version"], { encoding: "utf-8" });
        return p;
      } catch {}
    }
  }
  return "claude";
}

function sample(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function buildPrompt({ caseLines, techLines, recentSeeds }) {
  return `あなたは広告会社のクリエイティブディレクターの壁打ち相手。以下の素材から「アイデアの種」を${SEED_COUNT}個生成して。

# アイデアの種とは
完成した企画でなくてよい。発想のきっかけになる一文。次の3パターンを混ぜる:
- 技術×技術: 「技術Aと技術Bを組み合わせたら、こんな表現ができるかも」
- 文脈×技術: 「（事例が扱った文脈・課題）にこの技術を掛けたら、こんな課題を解決できるかも」
- 転用: 「この技術を本来の使い方ではない使い方をしたら、こんなことに役立つかも」

# 素材A: 過去の事例（企画性・文脈の source）
${caseLines}

# 素材B: 技術（Technology タブより）
${techLines}

# ルール
- 各種は日本語1〜2文・80〜140字。「〜かも」「〜できそう」の仮説トーンでよい
- ${SEED_COUNT}個のうち、文脈×技術（素材A×B）を最低4個、技術×技術を最低2個、転用を最低2個
- 同じ技術は最大2回まで。素材の名前（技術名・事例名）を種の文中に含める
- 意外な掛け合わせ・飛距離を優先。ありきたりな「AIで効率化」的な種は不可
- 最近出した種と似たものは避ける: ${recentSeeds || "（履歴なし）"}

# 出力
JSON配列のみ（前置き・後書きなし）:
[{"pattern": "技術×技術|文脈×技術|転用", "seed": "..."}]`;
}

async function main() {
  console.log(`アイデアの種 生成開始 ${new Date().toLocaleString("ja-JP")}`);
  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));

  const caseLines = sample(cases, CASE_SAMPLE)
    .map((c) => `- ${c.title}（${c.client || "?"}）: ${(c.summary || "").slice(0, 80)}`)
    .join("\n");
  const techLines = sample(tech, TECH_SAMPLE)
    .map((t) => `- ${t.title}［${t.type}/${(t.domains || []).join(",")}］: ${(t.summary || "").slice(0, 90)}`)
    .join("\n");

  let history = [];
  try {
    history = JSON.parse(await fs.readFile(HISTORY_PATH, "utf-8"));
  } catch {}
  const recentSeeds = history.slice(-HISTORY_IN_PROMPT).map((s) => s.slice(0, 40)).join(" / ");

  const claudeBin = resolveClaudeBin();
  const result = spawnSync(
    claudeBin,
    ["--print", "--model", MODEL, "--dangerously-skip-permissions", buildPrompt({ caseLines, techLines, recentSeeds })],
    { encoding: "utf-8", timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 10, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join(" | ").slice(0, 300);
    console.error(`生成失敗: ${detail}`);
    process.exit(1);
  }
  const m = (result.stdout || "").match(/\[[\s\S]*"seed"[\s\S]*\]/);
  if (!m) {
    console.error(`種のJSONが見つかりません。出力先頭300字:\n${(result.stdout || "").slice(0, 300)}`);
    process.exit(1);
  }
  let seeds;
  try {
    seeds = JSON.parse(m[0]).filter((s) => s?.seed);
  } catch (e) {
    console.error(`JSON解析エラー: ${e.message}`);
    process.exit(1);
  }
  if (seeds.length < 5) {
    console.error(`種が少なすぎます（${seeds.length}個）→ エラー扱い`);
    process.exit(1);
  }
  seeds = seeds.slice(0, SEED_COUNT);

  const d = new Date();
  const lines = [`💡 アイデアの種 ${d.getMonth() + 1}/${d.getDate()}（Case Study × Technology）`, ""];
  seeds.forEach((s, i) => {
    lines.push(`${i + 1}.【${s.pattern}】${s.seed}`);
    lines.push("");
  });
  lines.push("https://research-man.vercel.app/technology");
  const text = lines.join("\n");

  await fs.writeFile(OUT_PATH, text);
  console.log(`✅ ${seeds.length}個生成 → ${OUT_PATH}（${text.length}字）`);
  console.log(text);

  if (!DRY_RUN) {
    history = [...history, ...seeds.map((s) => s.seed)].slice(-HISTORY_KEEP);
    await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
    await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("❌ エラー:", e.message);
    process.exit(1);
  });
