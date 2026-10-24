// 会場名 → 座標（OpenStreetMap Nominatim）。仕様: docs/EXHIBITION_VISIT_SPEC.md §3
// データ生成側でだけ呼ぶ。1秒1件・User-Agent に連絡先・結果は data/venue-geo.json にキャッシュ。
import fs from "fs";

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const MIN_INTERVAL_MS = 1000;
export const RESULT_LIMIT = 5;

/** @param {{venue:string, city?:string, prefecture?:string}} v */
export function buildQuery(v) {
  return [v.venue, v.city, v.prefecture].filter(Boolean).join(" ");
}

/** 住所に prefecture を含む最初の候補を返す。無ければ null（同名施設の誤一致防止）。 */
export function pickCandidate(results, prefecture) {
  if (!Array.isArray(results) || !prefecture) return null;
  for (const r of results) {
    if (!r) continue;
    const texts = [r.display_name, ...Object.values(r.address && typeof r.address === "object" ? r.address : {})];
    if (texts.some((t) => typeof t === "string" && t.includes(prefecture))) return r;
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

/** 1会場を問い合わせる。失敗（HTTP エラー・空・不採用・例外）は throw せず null。 */
export async function geocodeVenue(v, { fetchImpl = fetch, wait, userAgent }) {
  const query = buildQuery(v);
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "jp");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  try {
    await wait();
    const res = await fetchImpl(url.toString(), { headers: { "User-Agent": userAgent } });
    if (!res.ok) return null;
    const hit = pickCandidate(await res.json(), v.prefecture);
    if (!hit) return null;
    const lat = Number.parseFloat(hit.lat);
    const lng = Number.parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, displayName: hit.display_name || "", query };
  } catch {
    return null;
  }
}

/** 未登録会場を全て問い合わせ、{geo(新), added, failed} を返す。入力 geo は変更しない。 */
export async function geocodeAll(items, geo, { fetchImpl, wait, userAgent, today, onResult } = {}) {
  const base = geo && geo.venues ? geo : { version: 1, venues: {} };
  const venues = { ...base.venues };
  const added = [];
  const failed = [];
  for (const v of pendingVenues(items, base)) {
    const r = await geocodeVenue(v, { fetchImpl, wait, userAgent });
    if (onResult) onResult(v, r);
    if (!r) {
      failed.push(v);
      continue;
    }
    venues[v.venue] = { lat: r.lat, lng: r.lng, source: "nominatim", query: r.query, checkedAt: today };
    added.push({ ...v, ...r });
  }
  return { geo: { ...base, version: base.version ?? 1, venues }, added, failed };
}

/** 差分を安定させるため会場名でキーソート・2スペース・末尾改行。 */
export function serializeGeo(geo) {
  const venues = {};
  for (const k of Object.keys(geo.venues || {}).sort()) venues[k] = geo.venues[k];
  return `${JSON.stringify({ ...geo, venues }, null, 2)}\n`;
}

export function loadGeo(file) {
  try {
    const g = JSON.parse(fs.readFileSync(file, "utf8"));
    if (g && typeof g === "object" && g.venues && typeof g.venues === "object") return g;
  } catch {}
  return { version: 1, venues: {} };
}
