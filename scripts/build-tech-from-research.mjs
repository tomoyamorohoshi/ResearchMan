/**
 * Technology タブのデータ組み立てスクリプト。
 *
 * 調査済みJSON（エージェント調査結果 or 手動作成）から:
 *   1. verdict=adopt のみ抽出
 *   2. 主要リンクの死活を機械再検証（一次ソース必達の品質バー）
 *   3. Case Study (cases.json) との重複チェック（正規化タイトル）
 *   4. サムネイルを public/thumbnails/tech/ へ取得・保存
 *   5. data/tech.json へ書き込み（既存エントリとidマージ）
 *
 * 使い方: node scripts/build-tech-from-research.mjs <research1.json> [research2.json ...]
 *         --dry-run で tech.json を更新せず結果のみ表示
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchKeyVisual } from "./tech-thumbs.mjs";
import { isUrlAlive } from "./verify-video.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const VOCAB_PATH = path.join(__dirname, "../data/tech-tag-vocabulary.json");
const THUMB_DIR = path.join(__dirname, "../public/thumbnails/tech");

const DRY_RUN = process.argv.includes("--dry-run");
// --source <label>: 出所（X Bookmarks / Batch Research / Tech Radar）。フラグ・値を除いた残りが入力ファイル
const srcIdx = process.argv.indexOf("--source");
const SOURCE_FLAG = srcIdx >= 0 ? process.argv[srcIdx + 1] : null;
const inputFiles = process.argv
  .slice(2)
  .filter((a, i, arr) => !a.startsWith("--") && arr[i - 1] !== "--source");

// サムネイルの下限バイト数チェックは tech-thumbs.mjs の MIN_THUMB_BYTES / fetchThumbBuf 側で実施

function toId(name) {
  return name
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[:：].*$/, "")
    .replace(/[^a-z0-9぀-ヿ一-龯]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normTitle(t) {
  return (t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function saveThumb(id, sourceUrl, fallbackLinks = []) {
  await fs.mkdir(THUMB_DIR, { recursive: true });
  const localPath = path.join(THUMB_DIR, `${id}.jpg`);
  try {
    await fs.access(localPath);
    return `/thumbnails/tech/${id}.jpg`;
  } catch {}

  // キービジュアル優先（GitHub OGPカードは全候補失敗時の最終手段）。tech-thumbs.mjs参照
  const found = await fetchKeyVisual(fallbackLinks, sourceUrl);
  if (!found) return null;
  if (found.src !== sourceUrl) console.log(`  （サムネ取得元: ${found.src}）`);
  await fs.writeFile(localPath, found.buf);
  return `/thumbnails/tech/${id}.jpg`;
}

async function main() {
  if (!inputFiles.length) {
    console.error("usage: node scripts/build-tech-from-research.mjs <research.json> ...");
    process.exit(1);
  }
  const vocab = JSON.parse(await fs.readFile(VOCAB_PATH, "utf-8"));
  const validDomains = new Set(vocab.Domain);
  const validTypes = new Set(vocab.Type);

  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const caseTitleKeys = new Set(cases.map((c) => normTitle(c.title)));

  const existing = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
  const existingIds = new Set(existing.map((t) => t.id));

  const candidates = [];
  for (const f of inputFiles) {
    const arr = JSON.parse(await fs.readFile(f, "utf-8"));
    for (const r of arr) {
      if (r.verdict === "adopt" || r.verdict === "adopt-adjusted") candidates.push(r);
    }
  }
  console.log(`採用候補: ${candidates.length}件\n`);

  // 出所（sources）の指定を強制する（"X Bookmarks"固定ハードコードで全件同一になる事故を防ぐ）。
  // 各候補が r.sources を持つか、--source フラグのどちらかが必要
  if (!SOURCE_FLAG && candidates.some((r) => !r.sources)) {
    console.error("出所が未指定です。--source <X Bookmarks|Batch Research|Tech Radar> を渡すか、各候補に sources を含めてください");
    process.exit(1);
  }

  const added = [];
  const failed = [];
  for (const r of candidates) {
    const title = r.techName.replace(/[:：].*$/, "").trim() || r.techName;
    const id = toId(r.techName);
    console.log(`── ${title} (${id})`);

    if (existingIds.has(id)) { console.log("  スキップ: 既存"); continue; }
    if (caseTitleKeys.has(normTitle(title))) {
      console.log("  ✗ Case Studyと重複 → 除外");
      failed.push({ id, reason: "Case Study重複" });
      continue;
    }
    if (!validTypes.has(r.type)) { failed.push({ id, reason: `不正type: ${r.type}` }); continue; }

    // 一次ソースの機械再検証（github/project/product の先頭1本は必達）
    const primary = r.links.find((l) => ["github", "project", "product"].includes(l.kind));
    if (!primary) { failed.push({ id, reason: "一次ソースなし" }); console.log("  ✗ 一次ソースなし"); continue; }
    const alive = await isUrlAlive(primary.url);
    if (!alive) {
      console.log(`  ✗ 一次ソース到達不可: ${primary.url}`);
      failed.push({ id, reason: `一次ソース死: ${primary.url}` });
      continue;
    }
    console.log(`  一次ソースOK: ${primary.url}`);

    // サムネイル（必達）
    const thumb = await saveThumb(id, r.thumbnailSource, r.links || []);
    if (!thumb) {
      console.log(`  ✗ サムネイル取得不可: ${r.thumbnailSource}`);
      failed.push({ id, reason: `サムネ取得不可: ${r.thumbnailSource}` });
      continue;
    }
    console.log(`  サムネイルOK: ${thumb}`);

    added.push({
      id,
      title,
      org: r.org,
      type: r.type,
      domains: (r.domains || []).filter((d) => validDomains.has(d)),
      date: r.date,
      year: String(r.date).slice(0, 4),
      summary: r.summaryJa,
      point: r.pointJa,
      ...(r.detailJa ? { detail: r.detailJa } : {}),
      license: {
        spdx: r.license?.spdx ?? null,
        commercial: r.license?.commercial ?? "none",
        ...(r.license?.note ? { note: r.license.note } : {}),
      },
      links: r.links.map(({ kind, url }) => ({ kind, url })),
      thumbnail: thumb,
      relatedWorks: r.relatedWorks || [],
      sources: r.sources || [SOURCE_FLAG],
    });
    existingIds.add(id);
  }

  console.log(`\n追加: ${added.length}件 / 失敗: ${failed.length}件`);
  failed.forEach((f) => console.log(`  ✗ ${f.id}: ${f.reason}`));

  if (DRY_RUN) {
    // dry-runで保存したサムネイルは掃除（登録なしの孤立ファイルを残さない）
    for (const a of added) {
      try { await fs.unlink(path.join(THUMB_DIR, `${a.id}.jpg`)); } catch {}
    }
    console.log("(dry-run: tech.json未更新・サムネイル掃除済み)");
    return;
  }
  const updated = [...added, ...existing];
  await fs.writeFile(TECH_PATH, JSON.stringify(updated, null, 2));
  console.log(`✅ data/tech.json → 合計${updated.length}件`);

  // 日次パイプラインの通知用サマリー。0件でも必ず上書きする（stale再通知防止・Case Studyの教訓）
  try {
    await fs.writeFile(
      "/tmp/researchman-tech-last-add.json",
      JSON.stringify(
        { count: added.length, cases: added.map((a) => ({ id: a.id, title: a.title, year: a.year })) },
        null,
        2
      )
    );
  } catch {}
}

main().then(() => process.exit(0)).catch((e) => { console.error("❌", e); process.exit(1); });
