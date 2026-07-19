/**
 * scripts/backfill-rejections.mjs
 *
 * 誤って却下された事例のバックフィル専用ワンショットスクリプト。
 *
 * 背景: lbbonline.com / adweek.com 等がCloudflareのTLSフィンガープリント判定で
 * Node の http/https クライアントにだけ403チャレンジページ（"Just a moment..."）を
 * 返し、scripts/save-thumbnail.mjs の fetchOgImage がステータスを見ずチャレンジHTMLを
 * 解析→og:image無し→null と誤判定、auto-research-cc.mjs が reason="thumbnail-unverified"
 * で却下していた（2026-07-19 curlフォールバック修正で解消）。
 * logs/rejections-2026-07.jsonl の thumbnail-unverified 却下のうち、この不具合が原因と
 * 確認できた4件を対象に、discovery（WebSearch巡回）を経由せず、auto-research-cc.mjsと
 * 同一の検証・記事化パス（リンク実在検証→検証済みサムネイル取得→Claude CLI記事化→
 * タグ語彙フィルタ）で data/cases.json に追加する。
 *
 * 使い方:
 *   node scripts/backfill-rejections.mjs --dry-run   # サムネイル取得のみ確認。cases.jsonは更新しない
 *   node scripts/backfill-rejections.mjs             # 本実行（記事生成→cases.json追記）
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { isUrlAlive } from "./verify-video.mjs";
import { resolveClaudeBin, runClaudeJson } from "./lib/claude-cli.mjs";
import { normLink } from "./lib/norm-link.mjs";
import { logRejection } from "./lib/rejection-log.mjs";
import { toId, normTitle, buildArticlePrompt, acquireVerifiedThumbnail } from "./auto-research-cc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const VOCAB_PATH = path.join(__dirname, "../data/tag-vocabulary.json");
const DRY_RUN = process.argv.includes("--dry-run");
const MODEL = "sonnet";
const ARTICLE_TIMEOUT_MS = 300000;

// logs/rejections-2026-07.jsonl で thumbnail-unverified 却下と確認済みの4件（2026-07-17〜19）。
// 実データ（title/link）はrejectionsログの記録をそのまま使用。client/agency/noteは
// バックフィル担当者が補足した見立てで、記事生成プロンプトの手がかりに使うのみ
// （最終的な事実確認はbuildArticlePrompt経由のClaude CLI WebSearchが行う）。
const CANDIDATES = [
  {
    title: "Gap × Hailey Bieber '90sデニムカプセルコレクション",
    client: "Gap",
    agency: "",
    year: "2026",
    link: "https://www.adweek.com/creativity/gap-turns-to-hailey-bieber-to-relive-its-90s-denim-heyday/",
    note: "GapがHailey Bieberを起用し90年代デニムを再訪するカプセルコレクション",
  },
  {
    title: "Jacob Batalon Joins Team Galaxy as Samsung Expands Its Spider-Man Universe",
    client: "Samsung",
    agency: "",
    year: "2026",
    link: "https://lbbonline.com/news/Jacob-Batalon-Galaxy-Samsung-Spider-Man-Universe",
    note: "SamsungのSpider-Man UniverseキャンペーンにJacob Batalonが参加",
  },
  {
    title: "A Question Sparks Big Dreams (Powerball: What Would You Do?)",
    client: "Powerball",
    agency: "VCCP / Studio 59",
    year: "2026",
    link: "https://lbbonline.com/news/Allwyn-Powerball-VCCP-Studio-59",
    note: "Powerball（Allwyn）の宝くじキャンペーン。VCCP/Studio 59制作",
  },
  {
    title: "Justworks: Small Business Quality Meats",
    client: "Justworks",
    agency: "",
    year: "2026",
    link: "https://lbbonline.com/news/Justworks-Small-Business-Quality-Meats",
    note: "Justworksの中小企業向けキャンペーン",
  },
];

async function main() {
  console.log(`\nResearchMan 誤却下バックフィル${DRY_RUN ? "（DRY RUN）" : ""}`);
  console.log(`対象: ${CANDIDATES.length}件\n`);

  const vocab = JSON.parse(await fs.readFile(VOCAB_PATH, "utf-8"));
  const validTags = new Set([...vocab.Tech, ...vocab.Form, ...vocab.Theme]);
  const existingCases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const existingIds = new Set(existingCases.map((c) => c.id));
  const existingTitleKeys = new Set(existingCases.map((c) => normTitle(c.title)));
  const existingLinkKeys = new Set(existingCases.map((c) => normLink(c.link)).filter(Boolean));

  const claudeBin = resolveClaudeBin();
  console.log(`Claude bin: ${claudeBin}\n`);

  const toAdd = [];
  const results = [];

  for (const cand of CANDIDATES) {
    const id = toId(cand.title, cand.year, cand.client);
    console.log(`── ${cand.title} ──`);

    // ── 重複チェック（既にcases.jsonにある場合はスキップ）──
    if (existingIds.has(id) || existingTitleKeys.has(normTitle(cand.title))) {
      console.log("スキップ（既にcases.jsonに存在）\n");
      results.push({ title: cand.title, status: "skip-duplicate" });
      continue;
    }
    const lk = normLink(cand.link);
    if (lk && existingLinkKeys.has(lk)) {
      console.log("スキップ（同一記事リンクが既に存在）\n");
      results.push({ title: cand.title, status: "skip-link-duplicate" });
      continue;
    }

    // ── link 実在検証（auto-research-cc.mjsと同一パス）──
    if (!cand.link || !(await isUrlAlive(cand.link))) {
      console.log(`✗ リンク到達不可: ${cand.link || "(なし)"}\n`);
      results.push({ title: cand.title, status: "link-dead" });
      continue;
    }

    // ── 検証済みサムネイル取得（auto-research-cc.mjsと同一関数を再利用）──
    console.log("[thumb] 検証済みサムネイル取得中...");
    const thumb = await acquireVerifiedThumbnail(id, cand, claudeBin);
    if (!thumb || thumb.error) {
      const detail = thumb?.error || "unknown";
      console.log(`✗ サムネイル取得不可: ${detail}\n`);
      results.push({ title: cand.title, status: "thumbnail-unverified", detail });
      if (!DRY_RUN) {
        await logRejection({
          pipeline: "backfill",
          title: cand.title,
          reason: "thumbnail-unverified",
          detail,
          link: cand.link || "",
        });
      }
      const orphan = path.join(__dirname, `../public/thumbnails/${id}.jpg`);
      try {
        await fs.unlink(orphan);
      } catch {}
      continue;
    }
    console.log(`✓ サムネイル取得成功（videoId=${thumb.videoId || "(なし)"}）`);

    if (DRY_RUN) {
      console.log("DRY RUN: 記事生成はスキップ（サムネイル取得の確認のみ）\n");
      results.push({ title: cand.title, status: "dry-run-thumbnail-ok" });
      // dry-runで保存したサムネイルは掃除（登録なしの孤立ファイルを残さない）
      const f = path.join(__dirname, `../public/thumbnails/${id}.jpg`);
      try {
        await fs.unlink(f);
      } catch {}
      continue;
    }

    // ── 記事化（auto-research-cc.mjsと同一プロンプト・同一Claude CLI経路）──
    console.log("[article] 記事生成中...");
    const art = runClaudeJson(claudeBin, buildArticlePrompt(cand, vocab), {
      timeout: ARTICLE_TIMEOUT_MS,
      marker: '"overview"',
      model: MODEL,
      allowedTools: "WebSearch",
    });
    if (!art || !(art.summary || "").trim() || (art.overview || "").length < 50) {
      console.log("✗ 記事生成失敗/説明不足\n");
      results.push({ title: cand.title, status: "article-generation-failed" });
      await logRejection({
        pipeline: "backfill",
        title: cand.title,
        reason: "article-generation-failed",
        link: cand.link || "",
      });
      const orphan = path.join(__dirname, `../public/thumbnails/${id}.jpg`);
      try {
        await fs.unlink(orphan);
      } catch {}
      continue;
    }
    console.log("✓ 記事生成成功");

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
      sources: ["Radar"],
      tags: (art.tags || []).filter((t) => validTags.has(t)).slice(0, 5),
    });
    existingIds.add(id);
    existingTitleKeys.add(normTitle(cand.title));
    if (lk) existingLinkKeys.add(lk);
    results.push({ title: cand.title, status: "added" });
    console.log(`✅ 採用: ${cand.title}\n`);
  }

  console.log("── 結果サマリー ──");
  for (const r of results) {
    console.log(`  ${r.status}: ${r.title}${r.detail ? ` [${r.detail}]` : ""}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN終了（cases.jsonは更新していません）");
    return;
  }
  if (!toAdd.length) {
    console.log("\n追加対象なし（全候補が却下）");
    return;
  }
  const updated = [...toAdd, ...existingCases];
  await fs.writeFile(CASES_PATH, JSON.stringify(updated, null, 2));
  console.log(`\n✅ ${toAdd.length}件追加 → 合計${updated.length}件`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ エラー:", e.stack || e.message);
    process.exit(1);
  });
