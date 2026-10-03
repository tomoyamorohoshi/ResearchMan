/**
 * Exhibition ジョブの I/O 部品（ファイル・HTTP）。ロジックは exhibition-build.mjs / exhibition-intake-job.mjs 側。
 * 認証トークンはログに出さない。
 */
import fs from "fs/promises";
import os from "os";
import path from "path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_HTML_BYTES = 1_500_000;
const MIN_BYTES_OG = 5000; // thumbnail-constraints.mjs の MIN_THUMB_BYTES と同値
const MIN_BYTES_IMG = 10 * 1024;

export async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

/** tmp → rename の原子的書き込み（途中終了で JSON が壊れない）。 */
export async function writeJsonAtomic(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n");
  await fs.rename(tmp, p);
}

/** 未検証キュー data/inbox/exhibition-unverified.json へ追記（title+link+intakeUrl で重複排除）。 */
export async function appendUnverified(root, entries) {
  if (!entries.length) return;
  const p = path.join(root, "data/inbox/exhibition-unverified.json");
  let cur = { version: 1, items: [] };
  try {
    cur = await readJson(p);
  } catch {}
  const key = (e) => `${e.title}|${e.link || ""}|${e.intakeUrl || ""}`;
  const seen = new Map((cur.items || []).map((e) => [key(e), e]));
  for (const e of entries) seen.set(key(e), { ...seen.get(key(e)), ...e });
  await writeJsonAtomic(p, { version: 1, items: [...seen.values()] });
}

/**
 * 通知サマリー（notify-line.mjs --route exhibition が読む）。0件でも必ず上書きする（stale 再通知防止）。
 * notify-line は {count, cases:[{id,title,year}]} だけで動く（tech と同形式）。score/highlight/unverified は exhibition 用の追加。
 * 通知 priority（>=70 は routine、highlight を含む回のみ critical）は run-job 側が cases[].score/highlight から決める。
 */
export async function writeSummary(tmpDir, { added = [], unverified = [] }) {
  const summary = {
    count: added.length,
    cases: added.map((a) => ({ id: a.id, title: a.title, year: a.startDate, score: a.score, highlight: a.highlight })),
    // 裏取り待ちがある回のみ付与（0件・unverified なしの回は tech と完全に同形式 {count:0, cases:[]}）
    ...(unverified.length ? { unverified: unverified.slice(0, 5).map((u) => ({ title: u.title, reason: u.reason })) } : {}),
  };
  await fs.writeFile(path.join(tmpDir, "researchman-exhibition-last-add.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function detectCharset(contentType, headBytes) {
  const m1 = /charset=([\w-]+)/i.exec(contentType || "");
  if (m1) return m1[1];
  const head = Buffer.from(headBytes).toString("latin1");
  const m2 = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m2 ? m2[1] : "utf-8";
}

/** HTML 取得（リダイレクト追従・charset 判定・最大1.5MB）。失敗は null。 */
export async function defaultFetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "ja,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_HTML_BYTES);
    let charset = detectCharset(res.headers.get("content-type"), buf.slice(0, 2048));
    let body;
    try {
      body = new TextDecoder(charset).decode(buf);
    } catch {
      body = new TextDecoder("utf-8").decode(buf);
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

export async function defaultFetchJson(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** ~/.researchman-favsync.json（{endpoint, token}）から intake API の設定を作る。未設定・導出不可は null。 */
export async function loadIntakeConfig(configPath = path.join(os.homedir(), ".researchman-favsync.json")) {
  let cfg;
  try {
    cfg = await readJson(configPath);
  } catch {
    return null;
  }
  if (!cfg?.token) return null;
  let endpoint = cfg.exhibitionIntakeEndpoint;
  if (!endpoint && cfg.endpoint) {
    const derived = cfg.endpoint.replace(/\/api\/favorites(\/)?$/, "/api/exhibition-intake$1");
    endpoint = derived === cfg.endpoint ? null : derived;
  }
  return endpoint ? { endpoint, token: cfg.token } : null;
}

/**
 * GET pending。404（未デプロイ）・503・401・ネットワーク失敗は {ok:false, reason}（呼び出し側はスキップして続行）。
 * @returns {Promise<{ok:true, items:object[]}|{ok:false, reason:string}>}
 */
export async function fetchPendingIntake(cfg, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(cfg.endpoint, {
      headers: { Authorization: `Bearer ${cfg.token}`, "User-Agent": "researchman-exhibition" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, items: Array.isArray(body?.items) ? body.items : [] };
  } catch (e) {
    return { ok: false, reason: `network: ${e.message}` };
  }
}

/** PATCH 結果送信。失敗は例外（呼び出し側 runIntake が握って data 更新は継続する）。 */
export async function patchIntakeResults(cfg, results, fetchImpl = fetch) {
  const res = await fetchImpl(cfg.endpoint, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", "User-Agent": "researchman-exhibition" },
    body: JSON.stringify({ results }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status !== 200) throw new Error(`PATCH HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

/**
 * サムネ保存関数を作る。og:image（なければページ内 img）→ 正規化 → thumbDir/{id}.jpg。
 * 取得不能・MIN_THUMB_BYTES 未満は null。sharp 等は遅延 import（テストで不要な重い依存を読まない）。
 */
export function makeSaveThumb(thumbDir) {
  return async function saveThumb(id, cand) {
    const { fetchOgImage, fetchImage } = await import("../save-thumbnail.mjs");
    const { normalizeAndEnforceMinBytes } = await import("./thumbnail-constraints.mjs");
    const sources = [];
    const src = cand.thumbnailSource || cand.officialUrl;
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(src || "")) sources.push(src);
    else {
      const og = await fetchOgImage(src).catch(() => null);
      if (og) sources.push(og);
    }
    if (src !== cand.officialUrl && cand.officialUrl) {
      const og2 = await fetchOgImage(cand.officialUrl).catch(() => null);
      if (og2) sources.push(og2);
    }
    // og:image が無い/使えないページは本文の <img> 候補にフォールバック（10KB 未満は装飾画像とみなして不採用）
    const imgFallback = async () => {
      const { extractImgFallbackCandidates } = await import("../save-thumbnail.mjs");
      const page = await defaultFetchHtml(cand.officialUrl);
      return page?.status === 200 ? extractImgFallbackCandidates(page.body, cand.officialUrl) : [];
    };
    const tried = new Set();
    const tryUrls = async (urls, minBytes) => {
      for (const u of urls) {
        if (tried.has(u)) continue;
        tried.add(u);
        const buf = await fetchImage(u).catch(() => null);
        const norm = buf ? await normalizeAndEnforceMinBytes(buf, minBytes).catch(() => null) : null;
        if (norm) {
          await fs.mkdir(thumbDir, { recursive: true });
          await fs.writeFile(path.join(thumbDir, `${id}.jpg`), norm);
          return `/thumbnails/exhibition/${id}.jpg`;
        }
      }
      return null;
    };
    const viaOg = await tryUrls(sources, MIN_BYTES_OG);
    if (viaOg) return viaOg;
    return tryUrls(await imgFallback(), MIN_BYTES_IMG);
  };
}
