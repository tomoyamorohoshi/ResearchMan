// 会場名 → 座標（OpenStreetMap Nominatim）。仕様: docs/EXHIBITION_VISIT_SPEC.md §3
// データ生成側でだけ呼ぶ。1秒1件・User-Agent に連絡先・結果は data/venue-geo.json にキャッシュ。
import fs from "fs";

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const MIN_INTERVAL_MS = 1000;
export const RESULT_LIMIT = 5;
export const REQUEST_TIMEOUT_MS = 15000;
export const MAX_VENUES_PER_RUN = 30;
export const RUN_BUDGET_MS = 8 * 60 * 1000;
const BLOCK_STATUSES = [429, 403];

/** @param {{venue:string, city?:string, prefecture?:string}} v */
export function buildQuery(v) {
  return [v.venue, v.city, v.prefecture].filter(Boolean).join(" ");
}

/**
 * prefecture 判定（完全一致）。施設名に県名を含む別県の施設（「東京都庁舎分室, 甲府市, 山梨県」等）を通さないため、
 * address の都道府県フィールド（province / state）があればそれと完全一致で判定する。
 * フィールドが無い結果（Nominatim は東京都で province を返さない＝実測）だけ、display_name の
 * 先頭成分（施設名）を除いた後ろの成分に完全一致があるかで判定する。
 * ※リクエストに Accept-Language を付けると display_name が「東京」になり判定が壊れるため付けない。
 */
export function pickCandidate(results, prefecture) {
  if (!Array.isArray(results) || !prefecture) return null;
  for (const r of results) {
    if (!r) continue;
    const addr = r.address && typeof r.address === "object" ? r.address : {};
    const field = addr.province || addr.state;
    if (field) {
      if (field === prefecture) return r;
      continue;
    }
    const parts = String(r.display_name || "").split(",").map((t) => t.trim());
    if ((parts.length === 1 ? parts : parts.slice(1)).includes(prefecture)) return r; // 1成分だけなら地域名そのもの
  }
  return null;
}

/** 座標未登録の会場（manual・登録済み・quarantined 除外、trim 一意化、会場名順）。 */
export function pendingVenues(items, geo) {
  const known = (geo && geo.venues) || {};
  const seen = new Map();
  for (const it of items || []) {
    if (!it || it.quarantined) continue;
    const venue = typeof it.venue === "string" ? it.venue.trim() : "";
    if (!venue || venue in known || seen.has(venue)) continue;
    seen.set(venue, { venue, city: it.city || "", prefecture: it.prefecture || "" });
  }
  return [...seen.values()].sort((a, b) => (a.venue < b.venue ? -1 : a.venue > b.venue ? 1 : 0));
}

/** 直前の呼び出しから intervalMs 以上あけるための待ち関数を作る（時計と sleep は注入可）。 */
export function createThrottle({
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  intervalMs = MIN_INTERVAL_MS,
} = {}) {
  let last = null;
  return async function wait() {
    if (last !== null) {
      const remain = intervalMs - (now() - last);
      if (remain > 0) await sleep(remain);
    }
    last = now();
  };
}

/** 1つの問い合わせ文で検索し、prefecture 判定を通った候補を返す。失敗は null。 */
async function searchOnce(query, prefecture, { fetchImpl = fetch, wait, userAgent, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "jp");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  try {
    await wait();
    const res = await fetchImpl(url.toString(), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    if (BLOCK_STATUSES.includes(res.status)) return { blocked: res.status };
    if (!res.ok) return null;
    const hit = pickCandidate(await res.json(), prefecture);
    if (!hit) return null;
    const lat = Number.parseFloat(hit.lat);
    const lng = Number.parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, displayName: hit.display_name || "", query };
  } catch {
    return null;
  }
}

/**
 * 1会場を問い合わせる。1回目「会場名 区 都道府県」、不採用なら「会場名」だけで再検索（同じ間隔・同じ prefecture 判定）。
 * 失敗（HTTP エラー・空・不採用・例外）は throw せず null。
 */
export async function geocodeVenue(v, opts) {
  const first = buildQuery(v);
  const r = await searchOnce(first, v.prefecture, opts);
  if (r || first === v.venue) return r;
  return searchOnce(v.venue, v.prefecture, opts);
}

/**
 * 未登録会場を問い合わせ、{geo(新), added, failed, skipped, blocked} を返す。入力 geo は変更しない。
 * 1回の実行は maxVenues 会場まで・全体で budgetMs まで（超えた分は skipped＝次回へ繰り越し）。採用1件ごとに onAdded(geo) を呼ぶ。429/403 を受けたら残りを打ち切る（blocked に status、残りは skipped）。
 */
export async function geocodeAll(items, geo, { fetchImpl, wait, userAgent, today, onResult, onAdded, timeoutMs, maxVenues = MAX_VENUES_PER_RUN, budgetMs = RUN_BUDGET_MS, now = () => Date.now() } = {}) {
  const base = geo && geo.venues ? geo : { version: 1, venues: {} };
  const venues = { ...base.venues };
  const added = [];
  const failed = [];
  const skipped = [];
  let blocked = null;
  const startedAt = now();
  const pending = pendingVenues(items, base);
  for (const [i, v] of pending.entries()) {
    if (blocked || i >= maxVenues || now() - startedAt >= budgetMs) {
      skipped.push(v);
      continue;
    }
    const r = await geocodeVenue(v, { fetchImpl, wait, userAgent, timeoutMs });
    if (r && r.blocked) {
      blocked = r.blocked;
      failed.push(v);
      if (onResult) onResult(v, null);
      continue;
    }
    if (onResult) onResult(v, r);
    if (!r) {
      failed.push(v);
      continue;
    }
    venues[v.venue] = { lat: r.lat, lng: r.lng, source: "nominatim", query: r.query, checkedAt: today };
    added.push({ ...v, ...r });
    if (onAdded) onAdded({ ...base, version: base.version ?? 1, venues: { ...venues } });
  }
  return { geo: { ...base, version: base.version ?? 1, venues }, added, failed, skipped, blocked };
}

/** 差分を安定させるため会場名でキーソート・2スペース・末尾改行。 */
export function serializeGeo(geo) {
  const venues = {};
  for (const k of Object.keys(geo.venues || {}).sort()) venues[k] = geo.venues[k];
  return `${JSON.stringify({ ...geo, venues }, null, 2)}\n`;
}

/** 一時ファイルに書いてから rename（途中で kill されても壊れた JSON を残さない）。 */
export function writeGeoAtomic(file, geo) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeGeo(geo));
  fs.renameSync(tmp, file);
}

export function loadGeo(file) {
  try {
    const g = JSON.parse(fs.readFileSync(file, "utf8"));
    if (g && typeof g === "object" && g.venues && typeof g.venues === "object") return g;
  } catch {}
  return { version: 1, venues: {} };
}
