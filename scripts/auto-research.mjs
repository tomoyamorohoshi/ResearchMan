/**
 * CREATIVE EDGE 自動事例収集スクリプト
 *
 * 3日ごとに実行され、クライテリアに合致する新規事例を国内外から収集して
 * cases.json に追加する。GitHub Actions から呼ばれる。
 *
 * 使い方:
 *   ANTHROPIC_API_KEY=... node scripts/auto-research.mjs
 *   ANTHROPIC_API_KEY=... node scripts/auto-research.mjs --dry-run  # 追加せず確認のみ
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const DRY_RUN = process.argv.includes("--dry-run");
const MAX_ADD_PER_RUN = 6; // 1回あたりの最大追加件数

// ──────────────────────────────────────────────
// YouTube ID の有効性確認
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// タイトルからIDを生成
// ──────────────────────────────────────────────
function toId(title, year) {
  return (title + "-" + year)
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ──────────────────────────────────────────────
// 既存IDと重複チェック
// ──────────────────────────────────────────────
function isDuplicate(candidate, existingCases) {
  const existingIds = new Set(existingCases.map((c) => c.id));
  const candId = toId(candidate.title, candidate.year);

  if (existingIds.has(candId)) return true;

  // タイトル類似チェック（先頭15文字）
  const candKey = candidate.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
  return existingCases.some((c) => {
    const key = c.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
    return key === candKey;
  });
}

// ──────────────────────────────────────────────
// Claude API でリサーチ実行（Web Search 使用）
// ──────────────────────────────────────────────
async function researchWithClaude(existingCases, client) {
  const existingTitles = existingCases
    .slice(0, 80)
    .map((c) => c.title)
    .join(", ");

  const today = new Date().toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric",
  });

  const systemPrompt = `あなたはCREATIVE EDGEというクリエイティブ事例データベースのキュレーターです。

## キュレーション・クライテリア

「新しいメディアから新しい表現が生まれる」事例を集める。

**選定の3軸**（いずれか1軸に突出すれば選定対象）:
1. 技術・メディアの革新性：従来不可能だったことを可能にした、または既存プラットフォームの「別の使い方」を発明した
2. 文化・社会へのインパクト：消費された後も語り継がれる。社会的議論や行動変容を生んだ
3. クラフトの完成度：アイデアの純度・実行精度・表現としての美しさ

**選定基準**（以下のいずれかに該当）:
- 国際広告賞（Cannes Lions・D&AD・One Show・Clio等）のGrand Prix、Gold、Silver、**ショートリスト**
- 国内賞（ACC・Spikes Asia等）のGrand Prix〜Gold
- 文化的事件として広く記録・引用される事例
- 特定技術・表現フォーマットの最初期の代表例
- デジタル×クリエイティブの接点として業界で話題の事例

**対象ジャンル**:
- 広告・PR・マーケティングキャンペーン
- 音楽アーティストのプロモーション（MV・アクティベーション・メディア戦略）
- メディアアート・インスタレーション
- テクノロジーのクリエイティブ応用
- 社会課題への創造的介入

**除外**:
- 技術だけで表現の完成度が低いもの
- 単なる製品機能説明
- 事実確認できない情報

## 出力形式

JSONで回答（マークダウン不要、JSONのみ）:
{
  "cases": [
    {
      "title": "キャンペーン名（英語または日本語）",
      "summary": "1〜2文のサマリー（日本語）",
      "client": "クライアント名",
      "agency": "制作会社・エージェンシー",
      "categories": ["メディア発明"],
      "award": "受賞情報（例: Cannes Lions 2025 PR Grand Prix）",
      "year": "2025",
      "regions": ["グローバル"],
      "link": "https://一次ソースURL",
      "youtube_id": "YouTubeのvideoID（11文字）",
      "overview": "概要200字（日本語）",
      "background": "背景200字（日本語）",
      "execution": "企画・エグゼキューション200字（日本語）",
      "evaluationImpact": "評価ポイントと世の中的インパクト200字（日本語）",
      "related_works": [
        {"title": "関連作品名", "description": "説明1〜2文（日本語）", "url": "https://..."}
      ]
    }
  ]
}

categoriesは以下から選択（複数可）:
コンテンツ革新 / カルチャーインサイト / テクノロジー×アイデア / 社会包摂 / ブランドエクスペリエンス / メディア発明 / AIクリエイティブ / 空間体験 / OOH革新 / データクリエイティブ

regionsは以下から選択（複数可）:
国内 / 北米 / 欧州 / アジア / グローバル

不明な情報は「詳細不明」と記載。youtube_idが不明の場合は空文字。`;

  const userPrompt = `今日は${today}です。

以下の検索を実行して、CREATIVE EDGEのクライテリアに合致する**新しい**事例を3〜5件見つけてください。

## 検索対象

**国際賞・業界ニュース:**
- 直近のCannes Lions / D&AD / One Show / Clio / Spikes Asiaの受賞・ショートリスト発表
- LBBOnline / Contagious / Adweek / Campaign Brief の最新記事
- 話題になっているクリエイティブキャンペーン

**テクノロジー・メディアアート:**
- AI×クリエイティブの最新応用事例
- XR・メタバース・インスタレーション
- 革新的なOOH・メディア活用

**音楽・エンターテインメント:**
- アーティストの革新的なアルバムプロモーション・アクティベーション
- ライブ・コンサートの新しい体験設計
- ファン参加型キャンペーン

**国内（日本）:**
- ACC受賞作・話題のキャンペーン
- 日本発のテクノロジー×クリエイティブ

## 既に収録済みのため除外（重複しないように）:
${existingTitles}

## 注意
- YouTubeの公式CM・MV・ケースフィルムのvideoIDを必ず調べること
- 事実を確認できない情報は含めない
- 広告賞のショートリストも積極的に含める
- 受賞なしでも文化的・技術的に重要な事例は含める`;

  console.log("Claude APIにリサーチを依頼中...");

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  // レスポンスからJSONを抽出
  let jsonText = "";
  for (const block of response.content) {
    if (block.type === "text") {
      jsonText += block.text;
    }
  }

  // JSONのみを抽出
  const jsonMatch = jsonText.match(/\{[\s\S]*"cases"[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("JSONが見つかりません。レスポンス:", jsonText.slice(0, 500));
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.cases || [];
  } catch (e) {
    console.error("JSON解析エラー:", e.message);
    console.error("JSON:", jsonMatch[0].slice(0, 500));
    return [];
  }
}

// ──────────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY が設定されていません");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log(`\n=== CREATIVE EDGE 自動収集 ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log("⚠ DRY RUN モード（cases.jsonは更新しない）");

  // 既存データ読み込み
  const existingCases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  console.log(`既存: ${existingCases.length}件`);

  // Claudeでリサーチ
  const candidates = await researchWithClaude(existingCases, client);
  console.log(`\n候補: ${candidates.length}件`);

  if (candidates.length === 0) {
    console.log("新規事例が見つかりませんでした");
    return;
  }

  // 各候補を検証・追加
  const toAdd = [];

  for (const c of candidates) {
    if (toAdd.length >= MAX_ADD_PER_RUN) break;

    const id = toId(c.title, c.year);
    console.log(`\n[${id}] 検証中...`);

    // 重複チェック
    if (isDuplicate(c, existingCases)) {
      console.log("  → スキップ（重複）");
      continue;
    }

    // YouTube ID 検証
    let thumbnail = "";
    let videoId = c.youtube_id || "";

    if (videoId) {
      const valid = await verifyYouTubeId(videoId);
      if (valid) {
        thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        console.log(`  → YouTube ID OK: ${videoId}`);
      } else {
        console.log(`  → YouTube ID 無効: ${videoId}、スキップ`);
        videoId = "";
        // YouTube IDなしでは追加しない
        continue;
      }
    } else {
      console.log("  → YouTube IDなし、スキップ");
      continue;
    }

    // cases.json スキーマに整形
    const newCase = {
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
    };

    toAdd.push(newCase);
    console.log(`  → 追加予定: "${c.title}" (${c.year})`);
  }

  console.log(`\n追加予定: ${toAdd.length}件`);

  if (toAdd.length === 0) {
    console.log("追加対象がありませんでした");
    return;
  }

  if (DRY_RUN) {
    console.log("\n[DRY RUN] 追加予定の事例:");
    toAdd.forEach((c) => console.log(`  - ${c.id} (${c.year})`));
    return;
  }

  // cases.json の先頭に挿入
  const updated = [...toAdd, ...existingCases];
  await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));

  console.log(`\n✓ ${toAdd.length}件追加 → 合計${updated.length}件`);
  toAdd.forEach((c) => console.log(`  + ${c.id} (${c.year})`));

  // 実行ログを出力（GitHub Actionsのサマリーに使用）
  const summary = toAdd.map((c) => `- ${c.title} (${c.year})`).join("\n");
  process.stdout.write(`\nSUMMARY:\n${summary}\n`);
}

main().catch((e) => {
  console.error("エラー:", e);
  process.exit(1);
});
