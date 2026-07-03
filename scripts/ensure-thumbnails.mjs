/**
 * サムネイル確実取得スクリプト（完走保証版）
 *
 * 全ケースについて public/thumbnails/{id}.jpg を確実に用意する。
 * 取得経路を多段フォールバックし、失敗が残る限りリトライする。
 *   1. videoId → YouTube公式サムネ (maxres → sd → hq)
 *   2. link → og:image / twitter:image
 *   3. Claude CLI (WebSearch) で公式動画のYouTube IDを再検索 → DL
 *   4. Claude CLI で公式画像URLを検索 → DL
 *
 * 新たに判明した videoId は cases.json に書き戻す。
 * 取得不能なものは最後にレポートする（404は出さない＝既存のまま）。
 *
 * 使い方:
 *   node scripts/ensure-thumbnails.mjs            # 全ケース
 *   node scripts/ensure-thumbnails.mjs --2026     # 2026 Cannesのみ
 */

import https from "https";
import http from "http";
import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import { spawnSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");
const THUMBS_DIR = path.join(__dirname, "../public/thumbnails");
const ONLY_2026 = process.argv.includes("--2026");
const MIN_BYTES = 8000;       // これ未満はYouTubeの「動画なし」グレー画像とみなす
const MAX_ROUNDS = 6;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── claude バイナリ解決 ──────────────────────────────
let CLAUDE_BIN = null;
try {
  CLAUDE_BIN = execFileSync("which", ["claude"]).toString().trim();
} catch {
  try {
    CLAUDE_BIN = execFileSync("bash", ["-lc", "which claude"]).toString().trim();
  } catch {
    CLAUDE_BIN = null;
  }
}

// ── 画像DLユーティリティ ──────────────────────────────
function fetchBuffer(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    let req;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { req?.destroy(); } catch {}
      resolve(v);
    };
    if (!url || !url.startsWith("http")) return finish(null);
    const mod = url.startsWith("https") ? https : http;
    // 接続段階のハングも確実に断ち切る外部タイマー
    timer = setTimeout(() => finish(null), 12000);
    req = mod.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        const next = res.headers.location.startsWith("http")
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return finish(fetchBuffer(next, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return finish(null);
      }
      const ct = res.headers["content-type"] || "";
      if (!ct.startsWith("image/")) {
        res.resume();
        return finish(null);
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => finish(Buffer.concat(chunks)));
    });
    req.on("error", () => finish(null));
  });
}

function fetchHtml(url, redirectsLeft = 3) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    let req;
    let html = "";
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { req?.destroy(); } catch {}
      resolve(v);
    };
    if (!url || !url.startsWith("http")) return finish(null);
    const mod = url.startsWith("https") ? https : http;
    timer = setTimeout(() => finish(html || null), 12000);
    req = mod.get(
      url,
      { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          res.resume();
          return finish(fetchHtml(next, redirectsLeft - 1));
        }
        res.on("data", (d) => {
          html += d;
          if (html.length > 60000) finish(html);
        });
        res.on("end", () => finish(html));
      }
    );
    req.on("error", () => finish(html || null));
  });
}

function extractOgImage(html) {
  if (!html) return null;
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.startsWith("http")) return m[1];
  }
  return null;
}

// ── 取得経路 ──────────────────────────────
async function fromYouTube(videoId) {
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  for (const variant of ["maxresdefault", "sddefault", "hqdefault"]) {
    const buf = await fetchBuffer(`https://i.ytimg.com/vi/${videoId}/${variant}.jpg`);
    if (buf && buf.length >= MIN_BYTES) return buf;
  }
  return null;
}

async function fromPage(url) {
  const html = await fetchHtml(url);
  const og = extractOgImage(html);
  if (!og) return null;
  const buf = await fetchBuffer(og);
  if (buf && buf.length >= MIN_BYTES) return buf;
  return null;
}

// Claude CLIで公式動画のYouTube IDを検索
function claudeFindVideoId(c) {
  if (!CLAUDE_BIN) return null;
  const prompt = `Search YouTube and the web for the OFFICIAL case film or campaign video for this Cannes Lions 2026 winning advertising campaign:
Title: ${c.title}
Brand: ${c.client}
Agency: ${c.agency}
Return ONLY the 11-character YouTube video ID (e.g. dQw4w9WgXcQ). If no official video exists, return exactly: NONE`;
  const r = spawnSync(
    CLAUDE_BIN,
    ["--print", "--allowedTools=WebSearch", "--dangerously-skip-permissions", prompt],
    { encoding: "utf8", timeout: 90000, maxBuffer: 10 * 1024 * 1024 }
  );
  if (r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.match(/\b([A-Za-z0-9_-]{11})\b/);
  return m ? m[1] : null;
}

// Claude CLIで公式画像の直URLを検索
function claudeFindImageUrl(c) {
  if (!CLAUDE_BIN) return null;
  const prompt = `Find a direct, publicly accessible IMAGE URL (ending in .jpg, .jpeg, .png, or .webp) showing the key visual / case image for this Cannes Lions 2026 winning campaign:
Title: ${c.title}
Brand: ${c.client}
Agency: ${c.agency}
Reference: ${c.link || "(none)"}
Return ONLY the image URL on a single line. If none found, return exactly: NONE`;
  const r = spawnSync(
    CLAUDE_BIN,
    ["--print", "--allowedTools=WebSearch,WebFetch", "--dangerously-skip-permissions", prompt],
    { encoding: "utf8", timeout: 90000, maxBuffer: 10 * 1024 * 1024 }
  );
  if (r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)(?:\?\S*)?/i);
  return m ? m[0] : null;
}

// ── メイン ──────────────────────────────
async function save(id, buf) {
  await fs.mkdir(THUMBS_DIR, { recursive: true });
  await fs.writeFile(path.join(THUMBS_DIR, `${id}.jpg`), buf);
}

function hasGoodThumb(id) {
  const p = path.join(THUMBS_DIR, `${id}.jpg`);
  try {
    return fssync.statSync(p).size >= MIN_BYTES;
  } catch {
    return false;
  }
}

async function main() {
  const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf8"));
  const targets = ONLY_2026
    ? cases.filter((c) => (c.award || "").includes("Cannes Lions 2026"))
    : cases;

  console.log(`対象 ${targets.length}件 (claude=${CLAUDE_BIN ? "有" : "無"})`);

  let dirty = false; // cases.json更新フラグ

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const todo = targets.filter((c) => !hasGoodThumb(c.id));
    if (todo.length === 0) {
      console.log(`\n=== 全件取得完了（ラウンド${round - 1}終了時点） ===`);
      break;
    }
    console.log(`\n──── ラウンド ${round} : 残り ${todo.length}件 ────`);

    for (const c of todo) {
      try {
        let buf = null;
        let foundVid = null;

        process.stderr.write(`>> ${c.id} vid=${c.videoId || "-"} link=${(c.link || "-").slice(0, 40)}\n`);

        // 経路1: 既存videoId → YouTube
        if (c.videoId) {
          buf = await fromYouTube(c.videoId);
          if (buf) console.log(`  [yt] ${c.id}`);
        }

        // 経路2: link → og:image
        if (!buf && c.link) {
          buf = await fromPage(c.link);
          if (buf) console.log(`  [og] ${c.id}`);
        }

        // 経路3: Claude CLIでvideoId再検索（ラウンド2以降、videoIdが無い/失敗したもの）
        if (!buf && round >= 2 && CLAUDE_BIN) {
          const vid = claudeFindVideoId(c);
          if (vid && vid !== c.videoId) {
            buf = await fromYouTube(vid);
            if (buf) {
              foundVid = vid;
              console.log(`  [cc-yt] ${c.id} → ${vid}`);
            }
          }
        }

        // 経路4: Claude CLIで画像URL検索（ラウンド3以降）
        if (!buf && round >= 3 && CLAUDE_BIN) {
          const imgUrl = claudeFindImageUrl(c);
          if (imgUrl) {
            const b = await fetchBuffer(imgUrl);
            if (b && b.length >= MIN_BYTES) {
              buf = b;
              console.log(`  [cc-img] ${c.id}`);
            }
          }
        }

        if (buf) {
          await save(c.id, buf);
          if (foundVid) {
            c.videoId = foundVid;
            c.thumbnail = `/thumbnails/${c.id}.jpg`;
            dirty = true;
          }
        }
      } catch (err) {
        console.log(`  [err] ${c.id}: ${err.message}`);
      }
    }

    // ラウンド毎にcases.json保存（中断耐性）
    if (dirty) {
      await fs.writeFile(CASES_PATH, JSON.stringify(cases, null, 2));
      dirty = false;
      console.log("  (cases.json更新)");
    }
  }

  // 最終レポート
  const stillMissing = targets.filter((c) => !hasGoodThumb(c.id));
  console.log(`\n========== 最終結果 ==========`);
  console.log(`取得済: ${targets.length - stillMissing.length} / ${targets.length}`);
  if (stillMissing.length) {
    console.log(`取得不能 ${stillMissing.length}件:`);
    stillMissing.forEach((c) => console.log(`  - ${c.id} | ${c.title} | ${c.link || "(linkなし)"}`));
  }
  console.log(`==============================`);
}

// 未捕捉例外でプロセスを落とさない（完走保証）
process.on("uncaughtException", (e) => {
  console.log(`  [uncaught] ${e.message}`);
});
process.on("unhandledRejection", (e) => {
  console.log(`  [unhandled] ${e?.message || e}`);
});

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
