/**
 * CREATIVE EDGE 自動収集スクリプト（Claude Code CLI版）
 *
 * ANTHROPIC_API_KEY 不要。Claude Code のログイン認証を使用。
 * .command ファイルから呼ばれる。
 *
 * 使い方:
 *   node scripts/auto-research-cc.mjs
 *   node scripts/auto-research-cc.mjs --dry-run
 */

import { execSync, spawnSync, execFileSync } from "child_process";
import fs from "fs/promises";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const DRY_RUN = process.argv.includes("--dry-run");
const MAX_ADD = 5;
const LAST_RUN_PATH = path.join(__dirname, "../.last-research-run.txt");

// YouTube ID の有効性確認
function verifyYouTubeId(ytId) {
  return new Promise((resolve) => {
    if (!ytId || ytId.length < 5) return resolve(false);
    const req = https.get(
      `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      (res) => resolve(res.statusCode === 200)
    );
    req.on("error", () => resolve(false));
    req.setTimeout(6000, () => { req.destroy(); resolve(false); });
  });
}

function toId(title, year) {
  return (title + "-" + year)
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// 前回実行日時の読み書き
async function getLastRunDate() {
  try {
    const raw = await fs.readFile(LAST_RUN_PATH, "utf-8");
    return new Date(raw.trim());
  } catch {
    // 初回は3日前をデフォルトに
    return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  }
}

async function saveLastRunDate() {
  if (!DRY_RUN) {
    await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  }
}

// Claude Code CLI で事例リサーチ
async function runClaudeResearch(existingTitles, lastRunDate) {
  const now = new Date();
  const today = now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const lastRun = lastRunDate.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const daysDiff = Math.round((now - lastRunDate) / (1000 * 60 * 60 * 24));

  const prompt = `今日は${today}です。前回の調査日は${lastRun}（約${daysDiff}日前）です。

ResearchManというクリエイティブ事例データベース用に、**${lastRun}以降〜${today}の間に世の中に出た・話題になった**事例を3〜5件探してください。

## 重要：「今」をリサーチする
過去の名作・受賞作ではなく、**この${daysDiff}日間に新たに発生・公開・話題になったもの**を探す。
- 「先週ローンチされた」「今週発表された」「現在バイラル中」「先日受賞が発表された」などが対象
- 数年前の事例を掘り起こすのは目的外

## 検索する情報源（最新記事を確認）
- lbbonline.com / contagious.com / adweek.com / campaignbrief.com の直近記事
- カンヌ・D&AD・Clio等の直近の受賞・ショートリスト発表（開催中または直前の発表）
- X（Twitter）やSNSでクリエイティブ業界がいま話題にしているもの
- 日本: advertimes.com / itmedia.co.jp / campaign-jp.com の最新記事
- 音楽アーティストの新しいプロモーション・アクティベーション
- AI×クリエイティブの最新事例、新サービス・新技術のクリエイティブ応用

## 選定基準（以下のいずれかに該当すれば可）
- 直近に受賞またはショートリスト入り（時期は問わず最新発表のもの）
- 業界メディアが直近に取り上げ話題になっている
- アーティスト・ブランドが直近にローンチしたクリエイティブな施策
- テクノロジー×クリエイティブの新しい事例として業界で共有されている

## 既存事例（重複を避ける）
${existingTitles}

## 出力形式（JSON のみ、説明不要）
{
  "cases": [
    {
      "title": "キャンペーン名",
      "summary": "1文サマリー（日本語）",
      "client": "クライアント名",
      "agency": "エージェンシー名",
      "categories": ["コンテンツ革新"],
      "award": "受賞情報",
      "year": "2025",
      "regions": ["グローバル"],
      "link": "https://...",
      "youtube_id": "YouTubeのvideoID（11文字）",
      "overview": "概要200字（日本語）",
      "background": "背景200字（日本語）",
      "execution": "企画・エグゼキューション200字（日本語）",
      "evaluationImpact": "評価ポイント200字（日本語）",
      "related_works": [{"title": "関連作品名", "description": "説明", "url": "https://..."}]
    }
  ]
}

categories候補: コンテンツ革新 / カルチャーインサイト / テクノロジー×アイデア / 社会包摂 / ブランドエクスペリエンス / メディア発明 / AIクリエイティブ / 空間体験 / OOH革新 / データクリエイティブ
regions候補: 国内 / 北米 / 欧州 / アジア / グローバル

不明な情報は空文字。youtube_idが不明の場合も空文字。`;

  console.log("Claude Code で事例リサーチ中（WebSearch使用）...\n");

  // .command ファイルなど PATH が通っていない環境に対応
  const CLAUDE_PATHS = [
    "/Users/tm/.local/bin/claude",
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  let claudeBin = "claude";
  try {
    claudeBin = execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  } catch {
    for (const p of CLAUDE_PATHS) {
      try { execFileSync(p, ["--version"], { encoding: "utf-8" }); claudeBin = p; break; } catch {}
    }
  }
  console.log(`Claude bin: ${claudeBin}\n`);

  // --allowedTools は <tools...> 可変長のため = で繋いでプロンプトと分離
  // --dangerously-skip-permissions: 非対話実行でパーミッション確認をスキップ
  const result = spawnSync(
    claudeBin,
    ["--print", "--allowedTools=WebSearch", "--dangerously-skip-permissions", prompt],
    {
      encoding: "utf-8",
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 20,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.error) {
    throw new Error(`Claude CLI エラー: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error("Claude stderr:", result.stderr?.slice(0, 400));
    throw new Error(`Claude CLI が終了コード ${result.status} で終了しました`);
  }

  const output = result.stdout || "";

  // JSONを抽出（Claudeが説明文を含む場合も対応）
  const jsonMatch = output.match(/\{[\s\S]*"cases"[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("JSONが見つかりません。Claudeの出力（先頭800字）:");
    console.error(output.slice(0, 800));
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.cases || [];
  } catch (e) {
    console.error("JSON解析エラー:", e.message);
    return [];
  }
}

// メイン処理
async function main() {
  console.log(`\nResearchMan 自動収集`);
  console.log(`   ${new Date().toLocaleString("ja-JP")}`);
  if (DRY_RUN) console.log("   ⚠ DRY RUN（cases.jsonは更新しません）");
  console.log("");

  const existingCases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const existingIds = new Set(existingCases.map((c) => c.id));
  // 直近30件のみ渡す（プロンプト肥大化防止）
  const existingTitles = existingCases.slice(0, 30).map((c) => c.title).join(" / ");

  // 前回実行日時を取得（「この期間に出た事例」の基準に使う）
  const lastRunDate = await getLastRunDate();
  const daysSince = Math.round((Date.now() - lastRunDate) / (1000 * 60 * 60 * 24));
  console.log(`既存: ${existingCases.length}件`);
  console.log(`前回実行: ${lastRunDate.toLocaleDateString("ja-JP")}（${daysSince}日前）`);
  console.log(`検索対象期間: 直近${daysSince}日間の新着事例\n`);

  const candidates = await runClaudeResearch(existingTitles, lastRunDate);
  console.log(`候補: ${candidates.length}件\n`);

  if (!candidates.length) {
    console.log("新規事例が見つかりませんでした");
    return 0;
  }

  const toAdd = [];

  for (const c of candidates) {
    if (toAdd.length >= MAX_ADD) break;

    const id = toId(c.title, c.year);
    if (existingIds.has(id)) {
      console.log(`スキップ（重複）: ${c.title}`);
      continue;
    }

    // YouTube ID 検証（なくても追加可能、og:image/picsumにフォールバック）
    let thumbnail = "";
    let videoId = "";

    if (c.youtube_id) {
      process.stdout.write(`検証中: ${c.title} ... `);
      const valid = await verifyYouTubeId(c.youtube_id);
      if (valid) {
        thumbnail = `https://i.ytimg.com/vi/${c.youtube_id}/hqdefault.jpg`;
        videoId = c.youtube_id;
        console.log("✓ YouTube");
      } else {
        console.log("✗ YouTube ID無効 → picsum使用");
      }
    } else {
      console.log(`サムネイルなし → picsum使用: ${c.title}`);
    }

    // フォールバック: picsumプレースホルダー
    if (!thumbnail) {
      thumbnail = `https://picsum.photos/seed/${id}/1200/630`;
    }

    toAdd.push({
      id,
      title: c.title,
      summary: c.summary || "",
      client: c.client || "",
      agency: c.agency || "",
      categories: c.categories || ["コンテンツ革新"],
      award: c.award || "（受賞情報なし）",
      year: String(c.year),
      regions: c.regions || ["グローバル"],
      link: c.link || "",
      thumbnail,
      videoId,
      overview: c.overview || "",
      background: c.background || "",
      execution: c.execution || "",
      evaluationImpact: c.evaluationImpact || "",
      relatedWorks: (c.related_works || []).map((w) => ({
        title: w.title || "",
        description: w.description || "",
        url: w.url || "",
      })),
    });
  }

  if (!toAdd.length) {
    console.log("\n追加対象がありませんでした（新着事例なし or YouTube ID未確認）");
    await saveLastRunDate(); // 次回の基準日として今日を記録
    return 0;
  }

  console.log(`\n追加予定: ${toAdd.length}件`);
  toAdd.forEach((c) => console.log(`  + ${c.title} (${c.year})`));

  if (DRY_RUN) return 0;

  const updated = [...toAdd, ...existingCases];
  await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
  await saveLastRunDate(); // 実行日時を保存（次回の検索期間の起点）
  console.log(`\n✅ ${toAdd.length}件追加 → 合計${updated.length}件`);

  return toAdd.length;
}

main()
  .then((count) => {
    if (count > 0) process.exit(0);
    else process.exit(0);
  })
  .catch((e) => {
    console.error("\n❌ エラー:", e.message);
    process.exit(1);
  });
