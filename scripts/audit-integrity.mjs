/**
 * 全事例の機械検証（正確性総点検）。
 *
 * チェック項目:
 *   1. thumbnail   … picsum/外部URL依存、ローカルファイル欠損、5KB未満の疑似画像
 *   2. thumbnail重複 … 同一内容の画像を複数事例が使い回している（誤割当のシグナル）
 *   3. videoId     … YouTube oEmbed で実在確認＋タイトル照合（無関係動画の検出）
 *   4. link        … 404/410/5xx/到達不能の検出
 *   5. テキスト     … summary/overview の欠落
 *
 * 使い方: node scripts/audit-integrity.mjs [--out /path/to/report.json]
 * 出力: コンソールにサマリー、--out指定時はJSONレポート
 */
import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { httpGet, videoMatchScore, isHumanVerifiedVideo } from "./verify-video.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const outIdx = process.argv.indexOf("--out");
const OUT_PATH = outIdx >= 0 ? process.argv[outIdx + 1] : null;

// audit専用: oEmbed照合＋理由を返す薄いラッパー（httpGetは verify-video.mjs と共有。
// verify-video.mjs の fetchYouTubeInfo は null/{title,author} のみを返す簡潔版のため、
// レポートに理由（ID形式不正/到達不能/status等）を出したいここだけ独自に持つ）
async function fetchYouTubeInfoWithReason(ytId) {
  if (!ytId || !/^[A-Za-z0-9_-]{11}$/.test(ytId)) return { ok: false, reason: "ID形式不正" };
  const res = await httpGet(
    `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${ytId}&format=json`,
    { maxBytes: 10000 }
  );
  if (!res) return { ok: false, reason: "oEmbed到達不能" };
  if (res.status !== 200) return { ok: false, reason: `oEmbed ${res.status}（削除/非公開の可能性）` };
  try {
    const j = JSON.parse(res.body);
    return { ok: true, title: j.title || "", author: j.author_name || "" };
  } catch {
    return { ok: false, reason: "oEmbed解析失敗" };
  }
}

async function pooled(items, worker, size = 8) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx], idx);
      }
    })
  );
  return results;
}

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
console.log(`監査対象: ${cases.length}件\n`);

const issues = [];

// ── 1. サムネイル ──────────────────────────────────────────
const hashToIds = new Map();
for (const c of cases) {
  const t = c.thumbnail || "";
  if (!t) {
    issues.push({ id: c.id, kind: "thumbnail", detail: "サムネイル未設定" });
    continue;
  }
  if (t.includes("picsum")) {
    issues.push({ id: c.id, kind: "thumbnail", detail: "picsumダミー画像" });
    continue;
  }
  if (t.startsWith("http")) {
    issues.push({ id: c.id, kind: "thumbnail-external", detail: `外部URL依存: ${t.slice(0, 80)}` });
    continue;
  }
  const file = path.join(__dirname, "../public", t);
  try {
    const buf = await fs.readFile(file);
    if (buf.length < 5000) {
      issues.push({ id: c.id, kind: "thumbnail", detail: `ファイルが小さすぎる(${buf.length}B)` });
    } else {
      const h = crypto.createHash("md5").update(buf).digest("hex");
      if (!hashToIds.has(h)) hashToIds.set(h, []);
      hashToIds.get(h).push(c.id);
    }
  } catch {
    issues.push({ id: c.id, kind: "thumbnail", detail: `ローカルファイル欠損: ${t}` });
  }
}
for (const [, ids] of hashToIds) {
  if (ids.length > 1) {
    issues.push({ id: ids.join(","), kind: "thumbnail-dup", detail: `同一画像を${ids.length}事例で使用` });
  }
}
console.log(`[1-2] サムネイル検査 完了`);

// ── 3. videoId（oEmbed照合） ─────────────────────────────────
const withVideo = cases.filter((c) => c.videoId);
const videoResults = await pooled(withVideo, async (c) => {
  const info = await fetchYouTubeInfoWithReason(c.videoId);
  if (!info.ok) return { id: c.id, kind: "videoId", detail: `${c.videoId}: ${info.reason}` };
  // 実在確認（oEmbed 200）は常に行う。人が確認済みのペアはタイトル照合のmismatch判定のみスキップ
  if (await isHumanVerifiedVideo(c.id, c.videoId)) return null;
  const score = videoMatchScore(info, c.title, c.client);
  if (!score.match)
    return {
      id: c.id,
      kind: "videoId-mismatch",
      detail: `${c.videoId}: 動画タイトル「${info.title.slice(0, 60)}」が事例「${c.title.slice(0, 40)}」と不一致の疑い（判定: ${score.reason}）`,
    };
  return null;
});
issues.push(...videoResults.filter(Boolean));
console.log(`[3] videoId検査 完了（${withVideo.length}件）`);

// ── 4. link死活 ──────────────────────────────────────────────
const linkResults = await pooled(cases, async (c) => {
  if (!c.link) return { id: c.id, kind: "link", detail: "link未設定" };
  const res = await httpGet(c.link, { maxBytes: 2000 });
  if (!res) return { id: c.id, kind: "link-dead", detail: `到達不能: ${c.link.slice(0, 80)}` };
  if (res.status === 404 || res.status === 410)
    return { id: c.id, kind: "link-dead", detail: `${res.status}: ${c.link.slice(0, 80)}` };
  if (res.status >= 500)
    return { id: c.id, kind: "link-5xx", detail: `${res.status}: ${c.link.slice(0, 80)}` };
  return null;
});
issues.push(...linkResults.filter(Boolean));
console.log(`[4] link死活検査 完了`);

// ── 5. テキスト欠落 ──────────────────────────────────────────
for (const c of cases) {
  if (!(c.summary || "").trim()) issues.push({ id: c.id, kind: "text", detail: "summary欠落" });
  if (!(c.overview || "").trim()) issues.push({ id: c.id, kind: "text", detail: "overview欠落" });
}
console.log(`[5] テキスト検査 完了\n`);

// ── レポート ────────────────────────────────────────────────
const byKind = {};
for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
console.log("=== 監査結果 ===");
console.log(`問題: ${issues.length}件`);
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${n}`);
}
console.log("");
for (const i of issues.slice(0, 60)) console.log(`- [${i.kind}] ${i.id}: ${i.detail}`);
if (issues.length > 60) console.log(`  ...他${issues.length - 60}件（--out でJSON出力）`);

if (OUT_PATH) {
  await fs.writeFile(OUT_PATH, JSON.stringify({ total: cases.length, issues }, null, 2));
  console.log(`\nレポート: ${OUT_PATH}`);
}
process.exit(0);
