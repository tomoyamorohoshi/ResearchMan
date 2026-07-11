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
 * 出力: os.tmpdir()/researchman-idea-seeds.txt（notify-line.mjs --text-file が送る本文）
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
import { normTitle } from "./lib/norm-title.mjs";
import { jstDateString } from "./lib/jst-date.mjs";
import { readIdeasJsonSafe, writeJsonAtomic } from "./lib/ideas-io.mjs";
import { computeItemWeight, weightedSample } from "./lib/weighted-sample.mjs";
import { runIdeaLayoutsPrecompute } from "./lib/run-idea-layouts-precompute.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const TUNING_PATH = path.join(__dirname, "../data/idea-tuning.json");
// 3つとも環境変数で差し替え可能（generate→ideas.json追記の単体検証用。本番では未設定＝既定値のまま）
const LAST_RUN_PATH = process.env.LAST_RUN_PATH || path.join(__dirname, "../.last-idea-seeds-run.txt");
const HISTORY_PATH = process.env.HISTORY_PATH || path.join(os.homedir(), ".researchman-idea-history.json");
const IDEAS_JSON_PATH = process.env.IDEAS_JSON_PATH || path.join(__dirname, "../data/ideas.json");
const OUT_PATH = path.join(os.tmpdir(), "researchman-idea-seeds.txt");
const DRY_RUN = process.argv.includes("--dry-run");
// テスト専用: 指定するとClaude CLIを呼ばずこのJSONファイル（[{pattern,seed,title,refs}]）をseedsとして使う。
// 本物のLINE配信・Claude CLI呼び出しを発生させずに「追記・重複スキップ・id採番」を検証するためのフック
const FIXTURE_SEEDS_PATH = (() => {
  const i = process.argv.indexOf("--fixture-seeds");
  return i >= 0 ? process.argv[i + 1] : null;
})();
// fixtureモードのサンドボックス強制: 書き込み先4種すべてを環境変数で隔離していない限り
// 起動を拒否する（誤って本番の data/ideas.json・履歴・last-run を汚染する事故の防止。
// adversarialレビュー指摘。実際に一度、引数の書式ミスで本番経路に入りかけた実績がある）。
// IDEA_LAYOUTS_JSON_PATH: 2026-07-08改訂・事前計算方式でrunIdeaLayoutsPrecompute()が追加された。
// これを隔離しないと、fixtureのideas.jsonから計算したレイアウトが本番のdata/idea-layouts.json
// を上書きしてしまう（IDEAS_JSON_PATHは隔離されていてもprecomputeの出力先は既定で本番パスのため）
if (
  FIXTURE_SEEDS_PATH &&
  !(process.env.IDEAS_JSON_PATH && process.env.HISTORY_PATH && process.env.LAST_RUN_PATH && process.env.IDEA_LAYOUTS_JSON_PATH)
) {
  console.error(
    "--fixture-seeds はテスト専用です。IDEAS_JSON_PATH / HISTORY_PATH / LAST_RUN_PATH / IDEA_LAYOUTS_JSON_PATH の" +
      "4環境変数で書き込み先を必ず隔離してください",
  );
  process.exit(1);
}

// SEED_COUNT/CASE_SAMPLE/TECH_SAMPLE/パターン混合比/サンプリング重み/プロンプト可変文節は
// data/idea-tuning.json から読み込む（2026-07-08 バッチ2aでハードコードから外部化。既定値は完全一致）。
// 隔週チューンアップ（scripts/biweekly-tuneup.mjs）がideas.jsonの機械指標とお気に入り分布に
// 基づき更新する。
const HISTORY_KEEP = 60; // 履歴に保持する種の数
const HISTORY_IN_PROMPT = 20; // プロンプトに渡す「最近の種」の数
const MODEL = "sonnet";
const TIMEOUT_MS = 420000;
const SITE = "https://research-man.vercel.app";

// 重み配列がすべて1.0のときは weightedSample() 内部で従来のFisher-Yatesシャッフルと
// 完全に同一のコード経路を通る（scripts/lib/weighted-sample.mjs 参照）。
function sample(arr, n, weights = null) {
  return weightedSample(arr, n, weights);
}

function buildPrompt({ caseLines, techLines, recentSeeds, tuning }) {
  const { seedCount, patternMix, promptText } = tuning;
  const minContextXTech = Math.round(patternMix.contextXTech * seedCount);
  const minTechXTech = Math.round(patternMix.techXTech * seedCount);
  const minRepurpose = Math.round(patternMix.repurpose * seedCount);
  const roleIntro = promptText.roleIntro.replace("{seedCount}", String(seedCount));
  const { techXTech, contextXTech, repurpose } = promptText.patternDefinitions;

  return `${roleIntro}

# アイデアの種とは
完成した企画でなくてよい。発想のきっかけになる一文。次の3パターンを混ぜる:
- 技術×技術: 「${techXTech}」
- 文脈×技術: 「${contextXTech}」
- 転用: 「${repurpose}」

# 素材A: 過去の事例（企画性・文脈の source）。各行の先頭 [id] は参照用
${caseLines}

# 素材B: 技術（Technology タブより）。各行の先頭 [id] は参照用
${techLines}

# ルール
- 各種は日本語1〜2文・80〜140字。「〜かも」「〜できそう」の仮説トーンでよい
- ${seedCount}個のうち、文脈×技術（素材A×B）を最低${minContextXTech}個、技術×技術を最低${minTechXTech}個、転用を最低${minRepurpose}個
- 同じ技術は最大2回まで。素材の名前（技術名・事例名）を種の文中に含める
- ${promptText.styleNotes}
- 最近出した種と似たものは避ける: ${recentSeeds || "（履歴なし）"}
- 各種で参照した事例・技術を refs に列挙する。id は上の素材の [id] を**そのまま正確に**転記する（創作・改変禁止）
- refs の desc は、その事例/技術が「何なのか」を高校生でもわかる平易な言葉で正確かつ端的に説明する1文（40〜70字）。素材に書かれた内容だけを根拠にし、無い情報を足さない
- title は、その種（seed）の内容から付ける短くわかりやすい見出し。10〜18字・体言止め推奨・記号や絵文字なし（サイトのアーカイブ表示用。配信文面には出ない）

# 出力
JSON配列のみ（前置き・後書きなし）:
[{"title": "...", "pattern": "技術×技術|文脈×技術|転用", "seed": "...", "refs": [{"type": "case", "id": "...", "desc": "..."}, {"type": "tech", "id": "...", "desc": "..."}]}]`;
}

async function main() {
  console.log(`アイデアの種 生成開始 ${new Date().toLocaleString("ja-JP")}`);
  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
  const tuning = JSON.parse(await fs.readFile(TUNING_PATH, "utf-8"));
  const { seedCount: SEED_COUNT, caseSample: CASE_SAMPLE, techSample: TECH_SAMPLE } = tuning;

  // 参照解決用のインデックス（id直引き＋正規化タイトルからの復元）
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const techById = new Map(tech.map((t) => [t.id, t]));
  const caseByTitle = new Map(cases.map((c) => [normTitle(c.title), c]));
  const techByTitle = new Map(tech.map((t) => [normTitle(t.title), t]));

  // サンプリング重み（既定は空マップ=全キー1.0。この場合 sample() は従来のFisher-Yates
  // シャッフルと完全同一のコード経路を通る＝挙動不変。お気に入り分析で隔週チューンアップが
  // data/idea-tuning.json の samplingWeights を更新すると選択確率に反映される）
  const caseWeights = cases.map((c) => computeItemWeight(c.tags, tuning.samplingWeights.caseTags));
  const techWeights = tech.map((t) => computeItemWeight(t.domains, tuning.samplingWeights.techDomains));
  const sampledCases = sample(cases, CASE_SAMPLE, caseWeights);
  const sampledTech = sample(tech, TECH_SAMPLE, techWeights);
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

  let seeds = null;
  if (FIXTURE_SEEDS_PATH) {
    // テスト専用経路: Claude CLIを呼ばずfixtureをそのままseedsとして使う
    seeds = JSON.parse(await fs.readFile(FIXTURE_SEEDS_PATH, "utf-8"));
    console.log(`🧪 フィクスチャモード: ${FIXTURE_SEEDS_PATH} から${seeds.length}件読込（Claude CLI呼び出しなし）`);
  } else {
    // モデルが不正なJSON（文字列内の引用符エスケープ漏れ等）を返すことがあり、
    // 1回きりだと配信が丸ごと落ちる（2026-07-04朝に実際に発生）。最大3回まで再生成する。
    // 生成はtech.json全体からのサンプリングであり当日の新規収集件数には依存しない＝
    // 収集0件の日でも必ず配信される設計
    const MAX_ATTEMPTS = 3;
    const claudeBin = resolveClaudeBin();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        seeds = generateOnce(claudeBin, buildPrompt({ caseLines, techLines, recentSeeds, tuning }));
        break;
      } catch (e) {
        console.error(`生成試行 ${attempt}/${MAX_ATTEMPTS} 失敗: ${e.message}`);
        if (attempt === MAX_ATTEMPTS) {
          console.error("全試行失敗 → エラー終了");
          process.exit(1);
        }
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
    // data/ideas.json へ追記（サイトの Ideas タブ用。既存エントリとseedが完全一致するものはスキップ＝再実行安全）。
    // 破損時は追記だけをスキップして続行する: LINE配信（本務）を巻き込まない。
    // サイト更新はその日止まるが、翌日以降の実行や手修復で自然回復する
    let ideas = null;
    try {
      ideas = await readIdeasJsonSafe(IDEAS_JSON_PATH);
    } catch (e) {
      console.error(
        `⚠ ideas.json が読めません（破損の疑い）。全損を避けるため本日のサイト掲載追記をスキップします: ${e.message}`,
      );
    }
    if (ideas) {
      const existingSeeds = new Set(ideas.map((idea) => idea.seed));
      const ideaDate = jstDateString();
      // 採番は「当日件数」でなく「当日の最大連番+1」: 手動削除や部分復旧で欠番があると
      // 件数基準は既存idと衝突する（adversarialレビューで実証）
      let seq = ideas.reduce((mx, idea) => {
        if (idea.date !== ideaDate) return mx;
        const m = /-(\d+)$/.exec(idea.id ?? "");
        return m ? Math.max(mx, Number(m[1])) : mx;
      }, 0);
      let ideasAdded = 0;
      let ideasSkipped = 0;
      let ideasNoTitle = 0;
      for (const s of seeds) {
        if (existingSeeds.has(s.seed)) {
          ideasSkipped++;
          continue;
        }
        const title = (s.title || "").trim();
        if (!title) {
          // タイトル無しの種はサイトに載せない（LINE配信には含まれる）。
          // 品質ゲートを通過したものだけ掲載する既存パイプラインの思想に合わせる
          ideasNoTitle++;
          console.warn(`⚠ title欠落のためサイト掲載をスキップ: ${s.seed.slice(0, 40)}…`);
          continue;
        }
        seq++;
        const refs = (s.refs || [])
          .map(resolveRef)
          .filter(Boolean)
          .map((r) => ({ type: r.type, id: r.id, title: r.name, desc: r.desc }));
        ideas.push({
          id: `${ideaDate}-${seq}`,
          date: ideaDate,
          title,
          pattern: s.pattern || null,
          seed: s.seed,
          refs,
        });
        existingSeeds.add(s.seed);
        ideasAdded++;
      }
      await writeJsonAtomic(IDEAS_JSON_PATH, ideas);
      console.log(
        `📝 ideas.json: +${ideasAdded}件追記・${ideasSkipped}件重複スキップ・${ideasNoTitle}件title欠落スキップ（計${ideas.length}件）`,
      );
      // 2026-07-08改訂・事前計算方式: ideas.json書込直後は必ずidea-layouts.jsonを再計算する
      // （pre-pushフックの鮮度検査が古いレイアウトでのpushを拒否するため）
      runIdeaLayoutsPrecompute();
    }

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
