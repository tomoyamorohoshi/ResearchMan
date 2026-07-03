/**
 * ResearchMan 自動収集スクリプト（Claude Code CLI版）
 *
 * ANTHROPIC_API_KEY 不要。Claude Code のログイン認証を使用。
 * launchd（毎時起動→run-if-due.mjs が72時間ゲート）から呼ばれる。
 *
 * キュレーション方針（デジクリラジオの興味プロファイル準拠）:
 *   広告賞に限らず「デジタル×クリエイティブ」全域を広く収集する。
 *   厳選しない。新規5件たまるまで最大3ラウンド検索を繰り返す。
 *
 * アーキテクチャ（2段階。1プロンプト過積載によるタイムアウトを防ぐ）:
 *   Phase A 発見    … 軽量リスト（title/client/link等）を10〜14件返させる
 *   Phase B 記事化  … 重複除外・link実在・サムネ検証を通過した候補だけ個別に本文生成
 *   → 重複候補に長文生成の時間を浪費しない・1回のCLI呼び出しが短く確実に完了する
 *
 * 正確性の担保（絶対ルール）:
 *   - link は実際に到達確認できたものだけ登録（404/死は候補ごと却下）
 *   - videoId は YouTube oEmbed で実在＋タイトル一致を確認できたものだけ登録
 *   - サムネイルは 検証済みYouTube → og:image の実画像のみ。picsum等のダミー禁止
 *   - 検証を通らない候補は登録しない（間違った情報を載せるより載せない）
 *
 * 使い方:
 *   node scripts/auto-research-cc.mjs
 *   node scripts/auto-research-cc.mjs --dry-run
 */

import { spawnSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { saveThumbnail, saveThumbnailFromPage } from "./save-thumbnail.mjs";
import { isUrlAlive, fetchYouTubeInfo, videoMatchesCase } from "./verify-video.mjs";
import { resolveClaudeBin, runClaudeJson } from "./lib/claude-cli.mjs";
import { localDayIndex } from "./lib/day-index.mjs";
import { logRejection } from "./lib/rejection-log.mjs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const VOCAB_PATH = path.join(__dirname, "../data/tag-vocabulary.json");
const DRY_RUN = process.argv.includes("--dry-run");
const LAST_RUN_PATH = path.join(__dirname, "../.last-research-run.txt");
const LAST_ADD_PATH = "/tmp/researchman-last-add.json"; // 反映後の通知メール用サマリー

const TARGET_NEW = 5; // 新規がこれだけたまったらラウンド終了
const MAX_ADD = 10; // 1回の実行で追加する上限（厳選しない方針なので多め）
const MAX_ROUNDS = 3; // 発見リトライ上限（重複ばかりでも粘る）
// リサーチ・記事化はSonnetで十分（既定の上位モデルだと遅くタイムアウトしやすい）
const MODEL = "sonnet";
const DISCOVER_TIMEOUT_MS = 600000;
const ARTICLE_TIMEOUT_MS = 300000;

// ── ID・タイトル正規化 ────────────────────────────────────────

function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function toId(title, year, client = "") {
  const slugOf = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "");
  let base = slugOf(title);
  // 日本語のみのタイトルはスラッグが空になる → クライアント名 or ハッシュで一意化
  if (base.replace(/[\d-]/g, "").length < 3) {
    const clientSlug = slugOf(client);
    base = clientSlug.replace(/[\d-]/g, "").length >= 3 ? clientSlug : `case-${shortHash(title)}`;
  }
  return `${base}-${year}`.replace(/-+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
}

// タイトル正規化（id違いの重複を検出するため）。記号・空白・年を除去して比較する。
function normTitle(t) {
  return (t || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, "");
}

// ── 前回実行日時 ─────────────────────────────────────────────

async function getLastRunDate() {
  try {
    const raw = await fs.readFile(LAST_RUN_PATH, "utf-8");
    return new Date(raw.trim());
  } catch {
    return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  }
}

async function saveLastRunDate() {
  if (!DRY_RUN) {
    await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  }
}

// ── Claude CLI ───────────────────────────────────────────────

// Claude CLI 呼び出しは scripts/lib/claude-cli.mjs に共通化（resolveClaudeBin/runClaudeJson）

// ── Phase A: 発見（軽量リスト） ──────────────────────────────

// ラウンドごとに探索テーマを絞る（1回の呼び出しを軽くしてETIMEDOUTを防ぐ）。
// 実行日でローテーションし、目標到達で後半ラウンドが走らなくても長期的に全テーマを巡回する。
const ROUND_FOCI = [
  {
    label: "海外の広告・クリエイティブキャンペーン + AI×クリエイティブ（最重要）",
    sources:
      "lbbonline.com / contagious.com / adweek.com / campaignbrief.com / musebycl.io / adsoftheworld.com / itsnicethat.com / creativereview.co.uk / 広告賞(Cannes/D&AD/One Show/Clio)の直近発表",
    diversity: "広告賞ネタは全体の半分以下。生成AI活用事例を最低1件含める。",
  },
  {
    label: "テック・プロダクト・XR・ゲーム・音楽×テクノロジー（広告キャンペーン以外を中心に）",
    sources:
      "theverge.com / techcrunch.com / wired.com / creativeapplications.net / moguravr.com / roadtovr.com / uploadvr.com / automaton-media.com / cdm.link / pitchfork.com / dezeen.com / designboom.com / SXSW・Ars Electronica・CES等の発表",
    diversity: "広告キャンペーンは最大2件。新ツール/プロダクト/ライブ演出/映像手法/インスタレーションを優先。",
  },
  {
    label: "日本国内の事例 + 展示・アート・Webインタラクティブ",
    sources:
      "gigazine.net / itmedia.co.jp / advertimes.com / campaign-jp.com / prtimes.jp / markezine.jp / 音楽ナタリー(natalie.mu) / 美術手帖(bijutsutecho.com) / X(Twitter)でバイラル中の国内クリエイティブ",
    diversity: "最低4件は日本国内の事例。展示・Webサイト・SNS発カルチャーも対象。",
  },
];

function buildDiscoveryPrompt({ lastRunDate, existingTitles, seenThisRun, round }) {
  const now = new Date();
  const today = now.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const lastRun = lastRunDate.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const daysDiff = Math.max(1, Math.round((now - lastRunDate) / (1000 * 60 * 60 * 24)));

  // 日単位でスタート位置を回すことで、目標に早く達した日でもテーマの偏りが蓄積しない（JST暦日基準）
  const focus = ROUND_FOCI[(localDayIndex(now) + round - 1) % ROUND_FOCI.length];

  const retryNote =
    round > 1
      ? `\n## リトライ指示（${round}ラウンド目）\n前ラウンドの候補は既存と重複が多かった。**よりロングテール（有名すぎない）な事例**を探すこと。今回すでに見た候補: ${seenThisRun.slice(-30).join(" / ") || "なし"}\n`
      : "";

  return `今日は${today}。前回調査日は${lastRun}（約${daysDiff}日前）。
ResearchManというデジタルクリエイティブ事例データベースのために、**${lastRun}〜${today}に公開・発表・話題化した事例を5〜7件**リストアップしてください。この段階では詳細記事は不要（後工程で書く）。発見とURL確認に集中し、**WebSearchは合計10回以内**に収めること。

## 今回の探索テーマ
${focus.label}

## 情報源（このテーマを中心に。1つのメディアに偏らない）
${focus.sources}

## 利用者の関心（テーマ内での優先順位付けに使う）
AI×クリエイティブ / 音楽×テック / 展示・インスタレーション / XR / ゲーム / ロボット・デバイス / すぐれたWeb・アプリ / 映像表現 / OOH・ブランド体験 / ファッション・スポーツ・食×テック / VTuber・SNS発カルチャー

## 厳守事項
1. **鮮度**: この${daysDiff}日間に「公開/発表/受賞/バイラル化」したものだけ。過去の名作の掘り起こしは禁止。
2. **多様性**: ${focus.diversity} 有名ブランドの大型事例だけでなく、小規模でも面白いものを混ぜる。
3. **linkの正確性（最重要）**: linkには**あなたがWebSearchの結果で実際に確認した実在のURL**のみを書く。記憶からURLを組み立てることを禁止。確認できたURLがない事例は含めない。
4. **既存事例との重複禁止**: 下記の既存リストにあるものは出さない。
${retryNote}
## 既存事例（これらは出さない）
${existingTitles}

## 出力形式（JSON のみ、説明文なし）
{
  "found": [
    {
      "title": "事例名（正式名称）",
      "client": "クライアント/ブランド/アーティスト名",
      "agency": "エージェンシー/制作会社（不明なら空文字）",
      "year": "2026",
      "link": "https://（WebSearch結果で確認済みの記事/公式URL）",
      "youtube_id": "公式動画のYouTube ID 11文字（検索結果で確認できた場合のみ。不明なら空文字）",
      "note": "どんな事例か1行（日本語）"
    }
  ]
}`;
}

// ── Phase B: 記事化（検証済み候補のみ・1件ずつ） ──────────────

function buildArticlePrompt(cand, vocab) {
  const allTags = [...vocab.Tech, ...vocab.Form, ...vocab.Theme].join(" / ");
  return `以下のデジタルクリエイティブ事例について、WebSearchで事実確認しながら日本語のデータベース記事を書いてください。

事例: ${cand.title}
クライアント: ${cand.client || "不明"}
制作: ${cand.agency || "不明"}
年: ${cand.year}
参考URL: ${cand.link}
メモ: ${cand.note || ""}

## 厳守事項
- WebSearchで確認できた事実のみ書く。憶測・捏造禁止。確認できない項目は空文字。
- summary は「何が新しいか」まで言い切る具体的な1文（60字前後）。

## 出力形式（JSON のみ、説明文なし）
{
  "summary": "1文サマリー（日本語60字前後）",
  "categories": ["コンテンツ革新"],
  "award": "受賞情報（なければ空文字）",
  "regions": ["国内"],
  "tags": ["Tech/AI", "Form/Event"],
  "overview": "概要200字（日本語）",
  "background": "背景200字（日本語）",
  "execution": "企画・エグゼキューション200字（日本語）",
  "evaluationImpact": "評価ポイント・世の中的インパクト200字（日本語）",
  "related_works": [{"title": "関連作品名", "description": "説明", "url": "https://..."}]
}

categories候補: コンテンツ革新 / カルチャーインサイト / テクノロジー×アイデア / 社会包摂 / ブランドエクスペリエンス / メディア発明 / AIクリエイティブ / 空間体験 / OOH革新 / データクリエイティブ
regions候補: 国内 / 北米 / 中南米 / 欧州 / アジア / 中東・アフリカ / オセアニア / グローバル
tags候補（この中からのみ2〜5個。Form軸を必ず1つ以上）: ${allTags}`;
}

// Claude CLI で YouTube ID を検索（最後の手段。結果は必ず oEmbed 照合にかける）
function findYouTubeId(title, client, claudeBin) {
  const query = `"${title}"${client ? " " + client : ""}`;
  const result = spawnSync(
    claudeBin,
    [
      "--print",
      "--model",
      MODEL,
      "--allowedTools=WebSearch",
      "--dangerously-skip-permissions",
      `Search YouTube for the official campaign video or case film for: ${query}
Return ONLY the 11-character YouTube video ID (e.g. dQw4w9WgXcQ).
If you find multiple, choose the most official one (brand channel or award case study).
If nothing found, return: NOT_FOUND`,
    ],
    { encoding: "utf-8", timeout: 120000, maxBuffer: 1024 * 1024 * 5, stdio: ["ignore", "pipe", "pipe"] }
  );
  const out = (result.stdout || "").trim();
  const match = out.match(/\b([A-Za-z0-9_-]{11})\b/);
  if (!match || out.includes("NOT_FOUND")) return null;
  return match[1];
}

// 検証を通った場合のみ {thumbnail, videoId} を返す。ダミー画像は絶対に使わない。
async function acquireVerifiedThumbnail(id, cand, claudeBin) {
  // Step 1: 発見時の YouTube ID → oEmbed 実在＋タイトル照合
  if (cand.youtube_id) {
    process.stdout.write(`  [1] YouTube ID検証: ${cand.youtube_id} ... `);
    const info = await fetchYouTubeInfo(cand.youtube_id);
    if (info && videoMatchesCase(info, cand.title, cand.client)) {
      const local =
        (await saveThumbnail(id, `https://i.ytimg.com/vi/${cand.youtube_id}/maxresdefault.jpg`)) ||
        (await saveThumbnail(id, `https://i.ytimg.com/vi/${cand.youtube_id}/hqdefault.jpg`));
      if (local) {
        console.log(`✓ 一致（${info.title.slice(0, 40)}）`);
        return { thumbnail: local, videoId: cand.youtube_id };
      }
      console.log("✗ 画像保存失敗");
    } else {
      console.log(info ? `✗ タイトル不一致（${info.title.slice(0, 40)}）` : "✗ 動画が存在しない");
    }
  }

  // Step 2: 記事URLの og:image（saveThumbnail 側で 5KB 未満の疑似画像は却下される）
  if (cand.link) {
    process.stdout.write(`  [2] 記事og:image: ${cand.link.slice(0, 50)}... `);
    const local = await saveThumbnailFromPage(id, cand.link);
    if (local) {
      console.log("✓");
      return { thumbnail: local, videoId: "" };
    }
    console.log("✗");
  }

  // Step 3: Claude CLI で YouTube 検索 → 必ず oEmbed 照合
  process.stdout.write(`  [3] YouTube検索: "${cand.title.slice(0, 40)}" ... `);
  const foundId = findYouTubeId(cand.title, cand.client, claudeBin);
  if (foundId) {
    const info = await fetchYouTubeInfo(foundId);
    if (info && videoMatchesCase(info, cand.title, cand.client)) {
      const local =
        (await saveThumbnail(id, `https://i.ytimg.com/vi/${foundId}/maxresdefault.jpg`)) ||
        (await saveThumbnail(id, `https://i.ytimg.com/vi/${foundId}/hqdefault.jpg`));
      if (local) {
        console.log(`✓ (${foundId})`);
        return { thumbnail: local, videoId: foundId };
      }
    }
    console.log("✗ 照合不一致");
  } else {
    console.log("✗ 見つからず");
  }

  // ダミー画像へのフォールバックはしない（誤サムネ・無関係画像の根絶）
  return null;
}

async function main() {
  console.log(`\nResearchMan 自動収集`);
  console.log(`   ${new Date().toLocaleString("ja-JP")}`);
  if (DRY_RUN) console.log("   ⚠ DRY RUN（cases.jsonは更新しません）");
  console.log("");

  const vocab = JSON.parse(await fs.readFile(VOCAB_PATH, "utf-8"));
  const validTags = new Set([...vocab.Tech, ...vocab.Form, ...vocab.Theme]);

  const existingCases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const existingIds = new Set(existingCases.map((c) => c.id));
  const existingTitleKeys = new Set(existingCases.map((c) => normTitle(c.title)));
  // 全既存タイトルを渡す（以前は直近30件のみ→モデルが既出の有名事例を再提案し全滅していた）
  const existingTitles = existingCases.map((c) => c.title).join(" / ");

  const lastRunDate = await getLastRunDate();
  const daysSince = Math.round((Date.now() - lastRunDate) / (1000 * 60 * 60 * 24));
  console.log(`既存: ${existingCases.length}件`);
  console.log(`前回実行: ${lastRunDate.toLocaleDateString("ja-JP")}（${daysSince}日前）`);
  console.log(`検索対象期間: 直近${daysSince}日間 / 目標新規${TARGET_NEW}件以上（最大${MAX_ROUNDS}ラウンド）\n`);

  const claudeBin = resolveClaudeBin();
  console.log(`Claude bin: ${claudeBin}\n`);

  const toAdd = [];
  const seenThisRun = [];
  const stats = { candidates: 0, dup: 0, rejected: 0 };
  let discoveryErrors = 0;
  let roundsAttempted = 0;

  for (let round = 1; round <= MAX_ROUNDS && toAdd.length < TARGET_NEW; round++) {
    console.log(`── ラウンド ${round}/${MAX_ROUNDS}: 発見フェーズ ──`);
    roundsAttempted++;
    let found = [];
    try {
      const parsed = runClaudeJson(
        claudeBin,
        buildDiscoveryPrompt({ lastRunDate, existingTitles, seenThisRun, round }),
        { timeout: DISCOVER_TIMEOUT_MS, marker: '"found"', model: MODEL, allowedTools: "WebSearch" }
      );
      found = parsed?.found || [];
    } catch (e) {
      console.error(`発見フェーズ失敗: ${e.message}`);
      discoveryErrors++;
      continue;
    }
    console.log(`候補: ${found.length}件`);
    stats.candidates += found.length;

    for (const cand of found) {
      if (toAdd.length >= MAX_ADD) break;
      if (!cand?.title || !cand?.year) continue;
      seenThisRun.push(cand.title);

      const id = toId(cand.title, cand.year, cand.client);
      if (existingIds.has(id) || existingTitleKeys.has(normTitle(cand.title))) {
        console.log(`スキップ（重複）: ${cand.title}`);
        stats.dup++;
        continue;
      }

      try {
        // ── link 実在検証（誤リンクの根絶）──
        if (!cand.link || !(await isUrlAlive(cand.link))) {
          console.log(`却下（リンク到達不可）: ${cand.title} → ${cand.link || "(なし)"}`);
          stats.rejected++;
          if (!DRY_RUN) {
            await logRejection({ pipeline: "cc", title: cand.title, reason: "link-dead", link: cand.link || "" });
          }
          continue;
        }

        // ── 検証済みサムネイル取得（取れなければ記事化前に却下）──
        console.log(`検証中: ${cand.title}`);
        const thumb = await acquireVerifiedThumbnail(id, cand, claudeBin);
        if (!thumb) {
          console.log(`却下（検証済みサムネイル取得不可）: ${cand.title}`);
          stats.rejected++;
          if (!DRY_RUN) {
            await logRejection({ pipeline: "cc", title: cand.title, reason: "thumbnail-unverified", link: cand.link || "" });
          }
          const orphan = path.join(__dirname, `../public/thumbnails/${id}.jpg`);
          try {
            await fs.unlink(orphan);
          } catch {}
          continue;
        }

        // ── 記事化（検証通過後のみ長文生成コストを払う）──
        process.stdout.write(`  [4] 記事生成中... `);
        const art = runClaudeJson(claudeBin, buildArticlePrompt(cand, vocab), {
          timeout: ARTICLE_TIMEOUT_MS,
          marker: '"overview"',
          model: MODEL,
          allowedTools: "WebSearch",
        });
        if (!art || !(art.summary || "").trim() || (art.overview || "").length < 50) {
          console.log("✗ 生成失敗/説明不足 → 却下");
          stats.rejected++;
          if (!DRY_RUN) {
            await logRejection({ pipeline: "cc", title: cand.title, reason: "article-generation-failed", link: cand.link || "" });
          }
          const orphan = path.join(__dirname, `../public/thumbnails/${id}.jpg`);
          try {
            await fs.unlink(orphan);
          } catch {}
          continue;
        }
        console.log("✓");

        // ── related_works の死リンクは除外（事例自体は残す）──
        const relatedWorks = [];
        for (const w of art.related_works || []) {
          if (!w?.url) continue;
          if (await isUrlAlive(w.url)) {
            relatedWorks.push({ title: w.title || "", description: w.description || "", url: w.url });
          }
        }

        toAdd.push({
          id,
          title: cand.title,
          summary: art.summary,
          client: cand.client || "",
          agency: cand.agency || "",
          categories: art.categories?.length ? art.categories : ["コンテンツ革新"],
          award: art.award || "",
          year: String(cand.year),
          regions: art.regions?.length ? art.regions : ["グローバル"],
          link: cand.link,
          thumbnail: thumb.thumbnail,
          videoId: thumb.videoId,
          overview: art.overview || "",
          background: art.background || "",
          execution: art.execution || "",
          evaluationImpact: art.evaluationImpact || "",
          relatedWorks,
          sources: ["Radar"], // TOPカードの専用色・Radarタブの対象
          tags: (art.tags || []).filter((t) => validTags.has(t)).slice(0, 5),
        });
        existingIds.add(id);
        existingTitleKeys.add(normTitle(cand.title));
        console.log(`✅ 採用: ${cand.title}`);
      } catch (err) {
        console.log(`  ⚠ スキップ（処理失敗: ${err.message}）: ${cand.title}`);
        stats.rejected++;
        if (!DRY_RUN) {
          await logRejection({ pipeline: "cc", title: cand.title, reason: "exception", detail: err.message, link: cand.link || "" });
        }
        const orphan = path.join(__dirname, `../public/thumbnails/${id}.jpg`);
        try {
          await fs.unlink(orphan);
        } catch {}
      }
    }
    console.log(
      `ラウンド${round}終了: 累計採用${toAdd.length} / 候補${stats.candidates} / 重複${stats.dup} / 検証却下${stats.rejected}\n`
    );
  }

  // 全ラウンドがエラーで候補ゼロ＝「0件」ではなく「収集失敗」。
  // exit 1 で呼び出し元(plist)のエラー通知経路に乗せる（セッション制限等で
  // 「本日の新規追加なし（収集は正常実行）」と誤報告した2026-07-03の実障害の再発防止）
  if (!toAdd.length && stats.candidates === 0 && discoveryErrors >= roundsAttempted && discoveryErrors > 0) {
    console.error("発見フェーズが全ラウンド失敗 → 収集エラーとして終了");
    process.exit(1);
  }

  if (!toAdd.length) {
    console.log("追加対象がありませんでした（全候補が重複または検証却下）");
    // dry-runで本番の72h周期を消費しない（手動テストが次回自動実行を遅らせる事故防止）
    if (!DRY_RUN) {
      await saveLastRunDate();
      // 前回実行のサマリーが残ると、self-heal起因のコミットで通知が走った際に
      // 旧事例を再通知してしまう（stale通知）。0件でも必ず上書きする
      try {
        await fs.writeFile(LAST_ADD_PATH, JSON.stringify({ count: 0, cases: [] }, null, 2));
      } catch {}
    }
    return 0;
  }

  console.log(`追加: ${toAdd.length}件`);
  toAdd.forEach((c) => console.log(`  + ${c.title} (${c.year}) [${(c.tags || []).join(", ")}]`));

  if (DRY_RUN) {
    // dry-run で保存したサムネイルは掃除（登録なしの孤立ファイルを残さない）
    for (const c of toAdd) {
      const f = path.join(__dirname, `../public/thumbnails/${c.id}.jpg`);
      try {
        await fs.unlink(f);
      } catch {}
    }
    return 0;
  }

  const updated = [...toAdd, ...existingCases];
  await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
  await saveLastRunDate();
  console.log(`\n✅ ${toAdd.length}件追加 → 合計${updated.length}件`);

  // 反映後の通知メール/LINE用サマリー（send-mail.mjs / notify-line.mjs が読む）
  try {
    await fs.writeFile(
      LAST_ADD_PATH,
      JSON.stringify(
        { count: toAdd.length, cases: toAdd.map((c) => ({ id: c.id, title: c.title, year: c.year })) },
        null,
        2
      )
    );
  } catch {}

  return toAdd.length;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ エラー:", e.message);
    process.exit(1);
  });
