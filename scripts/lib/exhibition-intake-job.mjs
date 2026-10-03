/**
 * Exhibition intake（ユーザー投稿URL）の日次ジョブ側処理（SPEC §6.3）。ネットワーク/Claude/PATCH は deps 経由。
 *
 *   1. X: api.fxtwitter.com / IG: /embed/captioned/ を取得（失敗: attempts==0 → retry、>=1 → unverified）
 *   2. 本文を引用データとして Claude に渡し展覧会を抽出
 *   3. 抽出結果を公式ページ再取得で機械照合（build 側 processCandidates と同じ）。不一致は unverified
 *   4. 結果を PATCH。PATCH が失敗しても data 更新は継続（次回 GET で同じ URL が来ても dedupe で追加されない＝冪等）
 */
import { processCandidates, htmlToText } from "./exhibition-build.mjs";
import { buildIntakePrompt } from "./exhibition-prompts.mjs";
import { normLink } from "./norm-link.mjs";

export { buildIntakePrompt };

/**
 * 正規化済みの投稿URLから取得先を決める。許可外は null。
 * @returns {{kind:"x",user:string,id:string,fetchUrl:string}|{kind:"ig",id:string,fetchUrl:string}|null}
 */
export function parseIntakeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  let m;
  if (["x.com", "www.x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
    m = /^\/([A-Za-z0-9_]{1,30})\/status\/(\d+)\/?$/.exec(u.pathname);
    if (!m) return null;
    return { kind: "x", user: m[1], id: m[2], fetchUrl: `https://api.fxtwitter.com/${m[1]}/status/${m[2]}` };
  }
  if (["instagram.com", "www.instagram.com"].includes(host)) {
    m = /^\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    if (!m) return null;
    return { kind: "ig", id: m[2], fetchUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed/captioned/` };
  }
  return null;
}

/**
 * 投稿本文を取得する。
 * @returns {Promise<{ok:true,text:string,author:string}|{ok:false,reason:string}>}
 */
export async function fetchPostText(url, deps) {
  const p = parseIntakeUrl(url);
  if (!p) return { ok: false, reason: "invalid-url" };
  try {
    if (p.kind === "x") {
      const body = await deps.fetchJson(p.fetchUrl);
      const tw = body?.tweet;
      if (!tw?.text) return { ok: false, reason: "fxtwitter-no-tweet" };
      const name = tw.author?.name || p.user;
      return { ok: true, text: String(tw.text), author: `${name} (@${tw.author?.screen_name || p.user})` };
    }
    const res = await deps.fetchHtml(p.fetchUrl);
    if (!res || res.status !== 200) return { ok: false, reason: `instagram-embed-${res ? res.status : "unreachable"}` };
    const text = htmlToText(res.body);
    if (text.length < 5) return { ok: false, reason: "instagram-embed-empty" };
    return { ok: true, text, author: "(instagram)" };
  } catch (e) {
    return { ok: false, reason: `fetch-error: ${e.message}` };
  }
}

const failStatus = (attempts) => (attempts >= 1 ? "unverified" : "retry");

/** 1回の Claude CLI 呼び出しで処理する投稿の最大数（出力長・タイムアウト対策） */
export const MAX_POSTS_PER_EXTRACT = 8;

/**
 * @param {object} p
 * @param {{url:string, ts?:number, attempts?:number}[]} p.items  GET /api/exhibition-intake の pending
 * @param {object} p.data     exhibition.json の中身
 * @param {string} p.today
 * @param {object} p.deps     { fetchJson, fetchHtml, extract(posts)->candidates[], patch(results), saveThumb, now, persist?(data)（PATCH 送信前に data を保存） }
 * @param {object} [p.opts]   processCandidates の opts
 * @returns {Promise<{data:object, results:object[], unverified:object[], rejected:object[], added:object[], patched:boolean, patchError?:string}>}
 */
export async function runIntake({ items, data, today, deps, opts = {} }) {
  const results = [];
  const unverified = [];
  const rejected = [];
  const added = [];
  let current = data;

  const fetched = [];
  for (const it of items) {
    const r = await fetchPostText(it.url, deps);
    if (r.ok) {
      fetched.push({ item: it, url: it.url, text: r.text, author: r.author });
    } else {
      const status = failStatus(it.attempts || 0);
      results.push({ url: it.url, status, reason: r.reason });
      if (status === "unverified") unverified.push({ title: "(投稿の取得失敗)", venue: "", link: "", reason: r.reason, intakeUrl: it.url, at: deps.now() });
    }
  }

  const markUnverified = (f, reason, title) => {
    const status = failStatus(f.item.attempts || 0);
    results.push({ url: f.url, status, reason });
    if (status === "unverified") unverified.push({ title, venue: "", link: "", reason, intakeUrl: f.url, at: deps.now() });
  };

  for (let i = 0; i < fetched.length; i += MAX_POSTS_PER_EXTRACT) {
    const chunk = fetched.slice(i, i + MAX_POSTS_PER_EXTRACT);
    let candidates = null;
    try {
      candidates = await deps.extract(chunk.map(({ url, text, author }) => ({ url, text, author })));
    } catch (e) {
      for (const f of chunk) markUnverified(f, `extract-failed: ${e.message}`, "(抽出失敗)");
      continue;
    }
    // 完全に空/非配列は「候補なし」と「Claude 失敗・パース失敗」を区別できない → 恒久 rejected にせず retry/unverified
    if (!Array.isArray(candidates) || !candidates.length) {
      for (const f of chunk) markUnverified(f, "extract-empty（Claude 出力が空またはパース失敗）", "(抽出結果なし)");
      continue;
    }
    for (const f of chunk) {
      const fKey = normLink(f.url);
      const group = candidates
        .filter((c) => c && typeof c === "object" && typeof c.intakeUrl === "string" && normLink(c.intakeUrl) === fKey)
        .map((c) => ({ ...c, origin: "intake", intakeUrl: f.url }));
      if (!group.length) {
        results.push({ url: f.url, status: "rejected", reason: "no-exhibition-found" });
        continue;
      }
      const out = await processCandidates({ data: current, candidates: group, today, deps, opts });
      current = out.data;
      added.push(...out.added);
      unverified.push(...out.unverified);
      rejected.push(...out.rejected);
      if (out.added.length) results.push({ url: f.url, status: "added", exhibitionId: out.added[0].id });
      else if (out.skipped.length) results.push({ url: f.url, status: "added", exhibitionId: out.skipped[0].existingId, reason: "already-registered" });
      else if (out.updated.length) results.push({ url: f.url, status: "added", exhibitionId: out.updated[0].id, reason: "dates-updated" });
      else if (out.unverified.length) results.push({ url: f.url, status: "unverified", reason: out.unverified[0].reason });
      else if (out.rejected[0]?.reason === "thumbnail-unavailable") {
        // サムネ取得失敗は一時的な可能性がある → 恒久 rejected にせず retry、2回目以降は unverified
        const status = failStatus(f.item.attempts || 0);
        results.push({ url: f.url, status, reason: "thumbnail-unavailable" });
        if (status === "unverified") unverified.push({ title: out.rejected[0].title, venue: "", link: out.rejected[0].link || "", reason: "thumbnail-unavailable", intakeUrl: f.url, at: deps.now() });
      } else results.push({ url: f.url, status: "rejected", reason: out.rejected[0]?.reason || "rejected" });
    }
  }

  // PATCH より前に data を保存する（PATCH 失敗・後続の想定外エラーで追加分を失わない）
  if (current !== data && deps.persist) await deps.persist(current);

  let patched = false;
  let patchError;
  if (results.length) {
    try {
      await deps.patch(results);
      patched = true;
    } catch (e) {
      patchError = e.message;
    }
  }
  return { data: current, results, unverified, rejected, added, patched, ...(patchError ? { patchError } : {}) };
}
