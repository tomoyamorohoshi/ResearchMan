/**
 * アイデアの種ジェネレーター（毎朝10時のLINE配信用）。
 *
 * Case Study（企画性）× Technology（技術）を掛け合わせ、10個の「種」を生成する。
 * 種は完成した企画である必要はない:
 *   - 技術×技術: 「AとBを組み合わせたらこんな表現ができるかも」
 *   - 文脈×技術: 「この文脈にこの技術を掛けたらこんな課題を解決できるかも」
 *   - 転用:     「本来の使い方でない使い方をしたらこんなことに役立つかも」
 *
 * 各種には参照した事例・技術の「高校生でもわかる平易な解説」とRMページURLを付記する
 * （種の技術名だけでは中身が伝わらないため。2026-07-03 ユーザー要望）。
 * 参照idは cases.json / tech.json と機械照合し、実在しないidのURLは出さない（誤リンク防止）。
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
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveClaudeBin } from "./lib/claude-cli.mjs";

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
const SITE = "https://research-man.vercel.app";

function sample(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// 参照id復元用のタイトル正規化（日本語も残す。記号・空白のみ除去）
function normTitle(s) {
  return (s || "").toLowerCase().replace(/[\s　（）()【】\[\]、。・,.:：/|]/g, "");
}

function buildPrompt({ caseLines, techLines, recentSeeds }) {
  return `あなたは広告会社のクリエイティブディレクターの壁打ち相手。以下の素材から「アイデアの種」を${SEED_COUNT}個生成して。

# アイデアの種とは
完成した企画でなくてよい。発想のきっかけになる一文。次の3パターンを混ぜる:
- 技術×技術: 「技術Aと技術Bを組み合わせたら、こんな表現ができるかも」
- 文脈×技術: 「（事例が扱った文脈・課題）にこの技術を掛けたら、こんな課題を解決できるかも」
- 転用: 「この技術を本来の使い方ではない使い方をしたら、こんなことに役立つかも」

# 素材A: 過去の事例（企画性・文脈の source）。各行の先頭 [id] は参照用
${caseLines}

# 素材B: 技術（Technology タブより）。各行の先頭 [id] は参照用
${techLines}

# ルール
- 各種は日本語1〜2文・80〜140字。「〜かも」「〜できそう」の仮説トーンでよい
- ${SEED_COUNT}個のうち、文脈×技術（素材A×B）を最低4個、技術×技術を最低2個、転用を最低2個
- 同じ技術は最大2回まで。素材の名前（技術名・事例名）を種の文中に含める
- 意外な掛け合わせ・飛距離を優先。ありきたりな「AIで効率化」的な種は不可
- 最近出した種と似たものは避ける: ${recentSeeds || "（履歴なし）"}
- 各種で参照した事例・技術を refs に列挙する。id は上の素材の [id] を**そのまま正確に**転記する（創作・改変禁止）
- refs の desc は、その事例/技術が「何なのか」を高校生でもわかる平易な言葉で正確かつ端的に説明する1文（40〜70字）。素材に書かれた内容だけを根拠にし、無い情報を足さない

# 出力
JSON配列のみ（前置き・後書きなし）:
[{"pattern": "技術×技術|文脈×技術|転用", "seed": "...", "refs": [{"type": "case", "id": "...", "desc": "..."}, {"type": "tech", "id": "...", "desc": "..."}]}]`;
}

async function main() {
  console.log(`アイデアの種 生成開始 ${new Date().toLocaleString("ja-JP")}`);
  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));

  // 参照解決用のインデックス（id直引き＋正規化タイトルからの復元）
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const techById = new Map(tech.map((t) => [t.id, t]));
  const caseByTitle = new Map(cases.map((c) => [normTitle(c.title), c]));
  const techByTitle = new Map(tech.map((t) => [normTitle(t.title), t]));

  const sampledCases = sample(cases, CASE_SAMPLE);
  const sampledTech = sample(tech, TECH_SAMPLE);
  const caseLines = sampledCases
    .map((c) => `- [${c.id}] ${c.title}（${c.client || "?"}）: ${(c.summary || "").slice(0, 90)}`)
    .join("\n");
  const techLines = sampledTech
    .map((t) => `- [${t.id}] ${t.title}［${t.type}/${(t.domains || []).join(",")}］: ${(t.summary || "").slice(0, 100)}`)
    .join("\n");

  let history = [];
  try {
    history = JSON.parse(await fs.readFile(HISTORY_PATH, "utf-8"));
  } catch {}
  const recentSeeds = history.slice(-HISTORY_IN_PROMPT).map((s) => s.slice(0, 40)).join(" / ");

  // 1回のCLI呼び出し→JSON抽出・解析まで。失敗はthrow（呼び出し側でリトライ）
  function generateOnce(claudeBin, prompt) {
    const result = spawnSync(
      claudeBin,
      ["--print", "--model", MODEL, "--dangerously-skip-permissions", prompt],
      { encoding: "utf-8", timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 10, stdio: ["ignore", "pipe", "pipe"] }
    );
    if (result.error || result.status !== 0) {
      const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join(" | ").slice(0, 300);
      throw new Error(`CLI失敗: ${detail}`);
    }
    const m = (result.stdout || "").match(/\[[\s\S]*"seed"[\s\S]*\]/);
    if (!m) throw new Error(`種のJSONが見つかりません。出力先頭300字: ${(result.stdout || "").slice(0, 300)}`);
    const parsed = JSON.parse(m[0]).filter((s) => s?.seed); // 不正JSONはここでthrow
    if (parsed.length < 5) throw new Error(`種が少なすぎます（${parsed.length}個）`);
    return parsed;
  }

  // モデルが不正なJSON（文字列内の引用符エスケープ漏れ等）を返すことがあり、
  // 1回きりだと配信が丸ごと落ちる（2026-07-04朝に実際に発生）。最大3回まで再生成する。
  // 生成はtech.json全体からのサンプリングであり当日の新規収集件数には依存しない＝
  // 収集0件の日でも必ず配信される設計
  const MAX_ATTEMPTS = 3;
  const claudeBin = resolveClaudeBin();
  let seeds = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      seeds = generateOnce(claudeBin, buildPrompt({ caseLines, techLines, recentSeeds }));
      break;
    } catch (e) {
      console.error(`生成試行 ${attempt}/${MAX_ATTEMPTS} 失敗: ${e.message}`);
      if (attempt === MAX_ATTEMPTS) {
        console.error("全試行失敗 → エラー終了");
        process.exit(1);
      }
    }
  }
  seeds = seeds.slice(0, SEED_COUNT);

  // 参照を実データに解決（id直引き→タイトル復元。解決できなければURLを出さない）
  function resolveRef(ref) {
    const type = ref.type === "tech" ? "tech" : "case";
    const byId = type === "tech" ? techById : caseById;
    const byTitle = type === "tech" ? techByTitle : caseByTitle;
    let entry = byId.get(ref.id);
    if (!entry) entry = byTitle.get(normTitle(ref.id)) || byTitle.get(normTitle(ref.name));
    if (!entry) return null;
    const route = type === "tech" ? "technology" : "cases";
    // desc はモデル生成を優先し、無ければ実データの要約にフォールバック
    const desc = (ref.desc || "").trim() || (entry.summary || "").slice(0, 70);
    return { type, id: entry.id, name: entry.title, desc, url: `${SITE}/${route}/${entry.id}` };
  }

  let refResolved = 0;
  let refDropped = 0;
  const shownRefs = new Set(); // 同一refの解説重複を避ける（2回目以降は名前+URLのみ）
  const d = new Date();
  const lines = [`💡 アイデアの種 ${d.getMonth() + 1}/${d.getDate()}（Case Study × Technology）`, ""];

  seeds.forEach((s, i) => {
    lines.push(`${i + 1}.【${s.pattern}】${s.seed}`);
    lines.push("");
    for (const ref of s.refs || []) {
      const r = resolveRef(ref);
      if (!r) {
        refDropped++;
        continue;
      }
      refResolved++;
      if (shownRefs.has(r.id)) {
        lines.push(`${r.name}：${r.url}`);
      } else {
        shownRefs.add(r.id);
        lines.push(`${r.name}：${r.desc}`);
        lines.push(r.url);
      }
    }
    lines.push("");
  });
  lines.push(`${SITE}/technology`);
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");

  await fs.writeFile(OUT_PATH, text);
  console.log(`✅ ${seeds.length}個生成 → ${OUT_PATH}（${text.length}字 / ref解決${refResolved}・欠落${refDropped}）`);
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
