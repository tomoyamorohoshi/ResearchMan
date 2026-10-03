/**
 * Exhibition 日次ジョブの中核ロジック（SPEC §5.1 ステップ1・4）。純関数 + 依存注入（ネットワーク/ファイルは deps 経由）。
 *
 * - applyStatusUpdate: 全件の status を再計算し statusAsOf を更新（削除しない）
 * - findDuplicate / diffDates / applyUpdate: dedupe と会期変更の差分更新
 * - verifyOfficialPage: 公式ページを再取得し、日付・会場が候補 JSON と一致するか機械照合
 *   （Claude の主張だけで追加しない。不一致は unverified）
 * - processCandidates: 候補 → 追加/更新/unverified/reject/skip の振り分け
 *
 * 候補（Claude が返す JSON）の形:
 *   { title, artists[], venue, venueType, prefecture, city, startDate, endDate, admission, tags[], score,
 *     matchReason, officialUrl, sources[{name,url,kind}], excludeCategory, collectAll?, thumbnailSource?,
 *     origin?: "intake", intakeUrl? }
 *   excludeCategory: none | painting_oldmaster_ip | merch_event | showroom | ai_pictures（none 以外は hard 除外）
 */
import fs from "fs";
import { computeStatus, isValidYmd } from "./exhibition-status.mjs";
import { buildExhibitionId } from "./exhibition-slug.mjs";
import { normLink } from "./norm-link.mjs";
import { normTitle } from "./norm-title.mjs";

// audit-exhibition.mjs と同じ47都道府県（監査側はモジュールとして export していないため複製）
export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県",
  "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
export const VENUE_TYPES = ["museum", "alt_space", "corporate", "media_art_center", "gallery", "other"];
export const SOURCE_KINDS = ["official", "listing", "social", "news"];
export const HARD_EXCLUDE_CATEGORIES = ["painting_oldmaster_ip", "merch_event", "showroom", "ai_pictures"];

export const DEFAULTS = { addThreshold: 60, highlightThreshold: 80, maxAdd: 5, intakeBonus: 10 };

let _vocabCache = null;
function loadTagVocab() {
  if (!_vocabCache) {
    _vocabCache = JSON.parse(fs.readFileSync(new URL("../../data/exhibition-tag-vocabulary.json", import.meta.url), "utf-8")).Tag;
  }
  return _vocabCache;
}

const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

// 公式URL・サムネ取得元として拒否するホスト（listing/SNS/動画。公式の個別ページではない）
const OFFICIAL_HOST_DENYLIST = [
  "x.com", "twitter.com", "t.co", "instagram.com", "facebook.com", "tiktok.com",
  "tokyoartbeat.com", "artscape.jp", "bijutsutecho.com",
  "fxtwitter.com", "fixupx.com", "vxtwitter.com", "youtube.com", "youtu.be",
];

/** http(s) かつ localhost/内部ホスト/IP直書きでない URL か（SSRF 対策。new URL の throw は false）。 */
export function isPublicHttpUrl(u) {
  if (!isHttpUrl(u)) return false;
  let host;
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host || host.includes(":") || host.startsWith("[")) return false; // IPv6 直書き
  if (/^\d+(\.\d+){0,3}$/.test(host)) return false; // IPv4 直書き（new URL が 2130706433 等も正規化済み）
  if (!host.includes(".")) return false; // intranet 名
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  return true;
}

/** 公式ページとして使える URL か（公開 http(s) かつ listing/social の denylist ホストでない）。 */
export function isSafeOfficialUrl(u) {
  if (!isPublicHttpUrl(u)) return false;
  const host = new URL(u).hostname.toLowerCase();
  return !OFFICIAL_HOST_DENYLIST.some((d) => host === d || host.endsWith(`.${d}`));
}

/** title/venue 照合用キー（記号・空白・大小・全半角を無視）。 */
function normKey(s) {
  return normTitle(String(s || "").normalize("NFKC")).replace(/[^\p{L}\p{N}]/gu, "");
}

// ── status 更新 ──────────────────────────────────────────────

/**
 * 全件の status を today 基準で再計算し statusAsOf を更新する（入力は変更しない・削除しない）。
 * @returns {{data: object, transitions: {id:string, from:string, to:string}[]}}
 */
export function applyStatusUpdate(data, today) {
  const transitions = [];
  const items = (data.items || []).map((it) => {
    const status = computeStatus(it.startDate, it.endDate, today);
    if (status !== it.status) transitions.push({ id: it.id, from: it.status, to: status });
    return { ...it, status };
  });
  return { data: { ...data, statusAsOf: today, items }, transitions };
}

// ── dedupe / 差分更新 ────────────────────────────────────────

/**
 * 既存 items から候補と同一の展覧会を探す。
 * kind=link: 候補の公式URL/sources のいずれかが既存の link/sources の normLink と一致
 * kind=key : 正規化 (title, venue, startDate) が一致（TAB/美術手帖/artscape 由来の同一展）
 * 同会場・同題でも startDate が違えば別展（再演・巡回）として扱う。
 */
export function findDuplicate(items, cand) {
  const candLinks = [cand.officialUrl, ...(cand.sources || []).map((s) => s?.url)]
    .map((u) => normLink(u))
    .filter(Boolean);
  const candLinkSet = new Set(candLinks);
  const key = `${normKey(cand.title)}|${normKey(cand.venue)}|${cand.startDate}`;
  for (const item of items) {
    const itemLinks = [item.link, ...(item.sources || []).map((s) => s?.url)].map((u) => normLink(u)).filter(Boolean);
    if (itemLinks.some((l) => candLinkSet.has(l))) return { item, kind: "link" };
    if (`${normKey(item.title)}|${normKey(item.venue)}|${item.startDate}` === key) return { item, kind: "key" };
  }
  return null;
}

/** 既存と候補の会期・会場の差分（変更なしは null）。 */
export function diffDates(existing, cand) {
  const patch = {};
  if (cand.startDate && cand.startDate !== existing.startDate) patch.startDate = cand.startDate;
  if (cand.endDate && cand.endDate !== existing.endDate) patch.endDate = cand.endDate;
  if (cand.venue && normKey(cand.venue) !== normKey(existing.venue)) patch.venue = cand.venue;
  return Object.keys(patch).length ? patch : null;
}

/** 差分を適用し status を再計算する（id/addedAt/score/sources 等は不変）。 */
export function applyUpdate(existing, patch, today) {
  const next = { ...existing, ...patch };
  next.status = computeStatus(next.startDate, next.endDate, today);
  return next;
}

// ── 公式ページの機械照合 ─────────────────────────────────────

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** HTML → 検索用プレーンテキスト（script/style/コメント/タグ除去・主要エンティティ解除）。 */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** text に ymd（YYYY-MM-DD）が各種表記（年あり/月日のみ/英語）で現れるか。 */
export function dateAppearsInText(text, ymd) {
  if (!isValidYmd(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const t = String(text || "").normalize("NFKC");
  const md = `0?${m}`;
  const dd = `0?${d}`;
  const patterns = [
    new RegExp(`(?<!\\d)${y}\\s*[-/.年]\\s*${md}\\s*[-/.月]\\s*${dd}(?!\\d)`),
    new RegExp(`(?<!\\d)${md}\\s*月\\s*${dd}\\s*日`),
    new RegExp(`(?<![\\d/.])${md}\\s*[/.]\\s*${dd}(?![\\d])`),
    new RegExp(`${EN_MONTHS[m - 1]}[a-z]*\\.?\\s*${dd}(?!\\d)`, "i"),
    new RegExp(`(?<!\\d)${dd}\\s*(?:st|nd|rd|th)?\\s*${EN_MONTHS[m - 1]}[a-z]*`, "i"),
  ];
  return patterns.some((re) => re.test(t));
}

// 単独では会場/題名の根拠にならない汎用語（これだけの一致は無効）
const GENERIC_WORDS = [
  "gallery", "museum", "art", "arts", "center", "centre", "hall", "space", "studio", "foundation", "institute", "tokyo", "japan",
  "ミュージアム", "ギャラリー", "美術館", "博物館", "アート", "センター", "ホール", "スペース", "スタジオ", "東京", "日本",
];
const stripGeneric = (tk) => GENERIC_WORDS.reduce((acc, g) => acc.split(g).join(""), tk);

/** 会場名が text に現れるか（空白除去の全体一致、または汎用語を除いた最長トークン(3字以上)の一致）。汎用語だけの一致は無効。 */
export function venueAppearsInText(text, venue) {
  const collapse = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const hay = collapse(text);
  const whole = collapse(venue);
  if (!whole) return false;
  if (stripGeneric(whole).replace(/[^\p{L}\p{N}]/gu, "").length < 2) return false; // 汎用語のみの会場名は照合不能
  if (hay.includes(whole)) return true;
  const tokens = String(venue || "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[\s・＠@()（）/\-–—,、]+/)
    .filter((tk) => tk && !/^\d+[f階]$/.test(tk) && tk.length >= 3 && stripGeneric(tk).length >= 3);
  if (!tokens.length) return false;
  const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  return hay.includes(longest);
}

/**
 * 展覧会名の主要トークンが text に現れるか。全体一致、または汎用語・数字のみでない3字以上のトークンの一致。
 * 3字以上のトークンが無い短い題名は全体一致のみ（日付や会場名だけの一致で通さない）。
 */
export function titleAppearsInText(text, title) {
  const collapse = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const hay = collapse(text);
  const whole = collapse(title);
  if (whole.length < 1) return false;
  if (hay.includes(whole) && stripGeneric(whole).length >= 1 && !/^\d+$/.test(whole)) return true;
  const tokens = String(title || "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((tk) => tk.length >= 3 && !/^\d+$/.test(tk) && stripGeneric(tk).length >= 3);
  return tokens.some((tk) => hay.includes(tk));
}

/**
 * 公式ページを再取得し、200・開始日・終了日・会場が候補と一致することを確認する。
 * @param {object} cand
 * @param {{fetchHtml:(url:string)=>Promise<{status:number, body:string}|null>}} deps
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function verifyOfficialPage(cand, { fetchHtml }) {
  if (!isHttpUrl(cand.officialUrl)) return { ok: false, reason: "official-url-invalid" };
  if (!isSafeOfficialUrl(cand.officialUrl)) return { ok: false, reason: "official-url-rejected: listing/social/internal host" };
  let res;
  try {
    res = await fetchHtml(cand.officialUrl);
  } catch (e) {
    return { ok: false, reason: `official-fetch-error: ${e.message}` };
  }
  if (!res) return { ok: false, reason: "official-fetch-failed" };
  if (res.status !== 200) return { ok: false, reason: `official-status-${res.status}` };
  const text = htmlToText(res.body);
  if (!dateAppearsInText(text, cand.startDate)) return { ok: false, reason: `official-date-mismatch: startDate ${cand.startDate} not found` };
  if (!dateAppearsInText(text, cand.endDate)) return { ok: false, reason: `official-date-mismatch: endDate ${cand.endDate} not found` };
  if (!venueAppearsInText(text, cand.venue)) return { ok: false, reason: `official-venue-mismatch: ${cand.venue}` };
  if (!titleAppearsInText(text, cand.title)) return { ok: false, reason: `official-title-mismatch: ${cand.title}` };
  return { ok: true };
}

// ── 候補の振り分け ───────────────────────────────────────────

// 候補（Claude 出力）の型不正を吸収する。非文字列は String 化（オブジェクト/配列/null は空文字）、配列項目は配列化
const STRING_FIELDS = [
  "title", "venue", "venueType", "prefecture", "city", "startDate", "endDate", "admission", "matchReason",
  "officialUrl", "officialName", "slugTitle", "slugVenue", "thumbnailSource", "intakeUrl", "excludeCategory", "origin",
];
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
function sanitizeCandidate(raw) {
  const c = { ...raw };
  for (const k of STRING_FIELDS) {
    const v = c[k];
    if (typeof v === "string") continue;
    if (typeof v === "number" || typeof v === "boolean") c[k] = String(v);
    else if (v === undefined) delete c[k];
    else c[k] = "";
  }
  c.artists = asArray(raw.artists).filter((a) => typeof a === "string" && a.trim());
  c.tags = asArray(raw.tags).filter((t) => typeof t === "string");
  c.sources = asArray(raw.sources).filter((x) => x && typeof x === "object" && !Array.isArray(x) && typeof x.url === "string");
  c.score = Number(raw.score);
  if (c.thumbnailSource !== undefined && !isPublicHttpUrl(c.thumbnailSource)) delete c.thumbnailSource;
  return c;
}

function normalizePrefecture(p) {
  const s = String(p || "").trim();
  if (PREFECTURES.includes(s)) return s;
  return PREFECTURES.find((x) => x.slice(0, -1) === s) || null;
}

function effectiveScore(cand, opts) {
  let s = Math.max(0, Math.min(100, Math.round(Number(cand.score) || 0)));
  if (cand.origin === "intake") s = Math.min(100, s + opts.intakeBonus);
  if (cand.collectAll) s = Math.max(s, opts.addThreshold);
  return s;
}

function buildSources(cand) {
  const out = [{ name: (typeof cand.officialName === "string" && cand.officialName) || "公式", url: cand.officialUrl, kind: "official" }];
  const seen = new Set([normLink(cand.officialUrl)]);
  const extra = [...(cand.sources || [])];
  if (cand.origin === "intake" && cand.intakeUrl) extra.push({ name: "ユーザー投稿", url: cand.intakeUrl, kind: "social" });
  for (const s of extra) {
    if (!s || !isHttpUrl(s.url)) continue;
    const key = normLink(s.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let hostname = "";
    try {
      hostname = new URL(s.url).hostname;
    } catch {
      continue;
    }
    out.push({ name: (typeof s.name === "string" && s.name) || hostname, url: s.url, kind: SOURCE_KINDS.includes(s.kind) && s.kind !== "official" ? s.kind : "listing" });
  }
  return out;
}

/**
 * 候補を検証して data へ反映する。data は変更せず新しい data を返す（書き込みは呼び出し側）。
 * @param {object} p
 * @param {object} p.data           { version, statusAsOf, items }
 * @param {object[]} p.candidates
 * @param {string} p.today          JST YYYY-MM-DD
 * @param {object} p.deps           { fetchHtml, saveThumb(id, cand)->path|null, now()->ISO }
 * @param {object} [p.opts]         { protectIds(同一実行で追加済みid。会期更新しない), addThreshold, highlightThreshold, maxAdd, intakeBonus, dryRun, tagVocab, reservedIds }
 */
export async function processCandidates({ data, candidates, today, deps, opts = {} }) {
  const o = { ...DEFAULTS, ...opts };
  const vocab = new Set(o.tagVocab || loadTagVocab());
  let items = applyStatusUpdate(data, today).data.items;
  const protect = new Set(o.protectIds || []);
  const taken = new Set([...items.map((i) => i.id), ...(o.reservedIds || [])]);

  const added = [];
  const updated = [];
  const unverified = [];
  const rejected = [];
  const skipped = [];

  const reject = (cand, reason, detail = "") => rejected.push({ title: cand.title, reason, detail, link: cand.officialUrl || "", intakeUrl: cand.intakeUrl });
  const unver = (cand, reason) =>
    unverified.push({
      title: cand.title, venue: cand.venue, startDate: cand.startDate || null, endDate: cand.endDate || null,
      link: cand.officialUrl || "", reason, ...(cand.intakeUrl ? { intakeUrl: cand.intakeUrl } : {}), at: deps.now(),
    });

  // null/非オブジェクトを除外し、型不正を吸収してから並べ替える（sort 中の throw で run 全体が落ちない）
  const sane = [];
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      rejected.push({ title: "(invalid)", reason: "invalid-candidate", detail: "not an object", link: "" });
      continue;
    }
    sane.push(sanitizeCandidate(raw));
  }
  // スコア上位を優先（日次上限が効くときに良い候補が残るように）
  const ordered = sane.sort((a, b) => effectiveScore(b, o) - effectiveScore(a, o));
  let capped = 0;

  const handle = async (cand) => {
    if (!cand.title.trim() || !cand.venue.trim()) {
      rejected.push({ title: cand.title || "(no title)", reason: "invalid-candidate", detail: "title/venue required", link: cand.officialUrl || "" });
      return;
    }
    if (!isHttpUrl(cand.officialUrl)) return unver(cand, "official-url-missing");
    if (!isSafeOfficialUrl(cand.officialUrl)) return unver(cand, "official-url-rejected（listing/SNS/内部ホスト/不正URLは公式として不可）");
    if (!isValidYmd(cand.startDate) || !isValidYmd(cand.endDate)) return unver(cand, "会期不明（startDate/endDate が不正または欠落）");
    if (cand.startDate > cand.endDate) return reject(cand, "start-after-end");
    if (cand.endDate < today) return reject(cand, "already-ended");
    if (cand.excludeCategory && cand.excludeCategory !== "none") return reject(cand, "hard-exclusion", cand.excludeCategory);
    const prefecture = normalizePrefecture(cand.prefecture);
    if (!prefecture) return reject(cand, "invalid-prefecture", String(cand.prefecture));

    // dedupe。一致したら追加せず、会期・会場の変更だけ（公式で裏取りできた場合に限り）追従する
    const dup = findDuplicate(items, cand);
    if (dup) {
      const patch = diffDates(dup.item, cand);
      // 同一実行で追加済みの展示は更新しない（ラウンドごとに Claude の返す日付が揺れて上書きされるのを防ぐ）
      if (!patch || protect.has(dup.item.id)) { skipped.push({ title: cand.title, reason: "duplicate", existingId: dup.item.id }); return; }
      const v = await verifyOfficialPage(cand, deps);
      if (!v.ok) return unver(cand, `会期変更の裏取り失敗: ${v.reason}`);
      const next = applyUpdate(dup.item, patch, today);
      items = items.map((i) => (i.id === dup.item.id ? next : i));
      updated.push({ id: dup.item.id, title: dup.item.title, patch });
      return;
    }

    const score = effectiveScore(cand, o);
    if (score < o.addThreshold) return reject(cand, "below-threshold", String(score));
    // 必須 string（監査で FAIL になる空値）が欠ける候補は追加せず unverified（理由つき）
    const missing = ["city", "matchReason"].filter((k) => !String(cand[k] || "").trim());
    if (missing.length) return unver(cand, `required-field-missing: ${missing.join(",")}`);
    const exempt = cand.collectAll || cand.origin === "intake";
    if (!exempt && capped >= o.maxAdd) return reject(cand, "daily-cap");

    const v = await verifyOfficialPage(cand, deps);
    if (!v.ok) return unver(cand, v.reason);

    const id = buildExhibitionId({ startDate: cand.startDate, venue: cand.slugVenue || cand.venue, title: cand.slugTitle || cand.title }, taken);
    let thumbnail = `/thumbnails/exhibition/${id}.jpg`;
    if (!o.dryRun) {
      thumbnail = await deps.saveThumb(id, cand);
      if (typeof thumbnail !== "string" || !thumbnail.trim()) return reject(cand, "thumbnail-unavailable", cand.thumbnailSource || cand.officialUrl);
    }

    const item = {
      id,
      slug: id,
      title: cand.title.trim(),
      artists: cand.artists,
      venue: cand.venue.trim(),
      venueType: VENUE_TYPES.includes(cand.venueType) ? cand.venueType : "other",
      prefecture,
      city: cand.city.trim(),
      startDate: cand.startDate,
      endDate: cand.endDate,
      status: computeStatus(cand.startDate, cand.endDate, today),
      admission: cand.admission.trim() || "UNKNOWN",
      tags: cand.tags.filter((t) => vocab.has(t)),
      score,
      matchReason: cand.matchReason.trim(),
      sources: buildSources(cand),
      link: cand.officialUrl,
      thumbnail,
      addedAt: deps.now(),
      origin: cand.origin === "intake" ? "intake" : "auto",
      ...(cand.origin === "intake" && cand.intakeUrl ? { intakeUrl: cand.intakeUrl } : {}),
      highlight: score >= o.highlightThreshold,
    };
    taken.add(id);
    protect.add(id);
    items = [item, ...items];
    added.push(item);
    if (!exempt) capped++;
  };

  for (const cand of ordered) {
    try {
      await handle(cand);
    } catch (e) {
      rejected.push({ title: cand.title || "(no title)", reason: "candidate-error", detail: String(e?.message || e).slice(0, 200), link: cand.officialUrl || "", intakeUrl: cand.intakeUrl });
    }
  }

  return { data: { ...data, statusAsOf: today, items }, added, updated, unverified, rejected, skipped };
}
