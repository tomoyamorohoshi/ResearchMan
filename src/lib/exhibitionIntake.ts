// Exhibition intake（X/Instagram の投稿 URL 受付）の純関数。SPEC §6.1。
// サーバ専用（intakeKey が node:crypto を使う）。クライアントからは import しない。
// このモジュールは URL を一切 fetch しない（SSRF 防止。取得はローカルの日次ジョブのみ）。
import { createHash } from "node:crypto";
import { todayJst } from "../../scripts/lib/exhibition-status.mjs";

export const MAX_URL_LENGTH = 300;
export const MAX_PENDING = 50; // 未処理キューの上限
export const MAX_DAILY = 30; // 1日(JST)の受付総数上限
export const TOMBSTONE_DAYS = 30; // 処理済みを保持する日数
const DAY_MS = 86400000;
const MAX_REASON_LENGTH = 300;
const MAX_EXHIBITION_ID_LENGTH = 100;

const X_HOSTS = new Set(["x.com", "twitter.com", "www.x.com", "mobile.twitter.com"]);
const IG_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

const X_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})\/?$/;
const IG_PATH = /^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/;

export type IntakeUrlResult = { ok: true; url: string; kind: "x" | "instagram" } | { ok: false; error: string };

const invalid = (error: string): IntakeUrlResult => ({ ok: false, error });

// URL の検証と正規化。X は https://x.com/{user}/status/{id}、
// IG は https://www.instagram.com/{p|reel}/{id}/ に揃える（query/fragment 除去）。
export function validateIntakeUrl(input: unknown): IntakeUrlResult {
  if (typeof input !== "string" || input.length === 0) return invalid("url must be a non-empty string");
  if (input.length > MAX_URL_LENGTH) return invalid(`url too long (max ${MAX_URL_LENGTH})`);

  // authority は生文字列で検査する（userinfo・ポート・バックスラッシュ等を URL パーサの
  // 正規化に隠させない）。許可ホストと完全一致しなければ拒否。
  const m = /^https:\/\/([^/?#]*)/i.exec(input);
  if (!m) return invalid("only https URLs are accepted");
  const authority = m[1].toLowerCase();
  if (authority.includes("xn--")) return invalid("punycode host is not accepted");
  const isX = X_HOSTS.has(authority);
  const isIg = IG_HOSTS.has(authority);
  if (!isX && !isIg) return invalid("host not allowed");

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return invalid("malformed url");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    return invalid("url must not contain userinfo or port");
  }
  if (isX) {
    const pm = X_PATH.exec(parsed.pathname);
    if (!pm) return invalid("X url must be /{user}/status/{digits}");
    return { ok: true, kind: "x", url: `https://x.com/${pm[1].toLowerCase()}/status/${pm[2]}` };
  }
  const pm = IG_PATH.exec(parsed.pathname);
  if (!pm) return invalid("Instagram url must be /p/{id} or /reel/{id}");
  return { ok: true, kind: "instagram", url: `https://www.instagram.com/${pm[1]}/${pm[2]}/` };
}

// 正規化済み URL → キュー内キー（sha256 hex の先頭16字）。
// X は status id のみ（ユーザー名違い・大小違いの同一ツイートを同一視）、
// IG は {p|reel}/{id}（id は大小区別）から作る。
export function intakeKey(url: string): string {
  const x = /^https:\/\/x\.com\/[^/]+\/status\/(\d+)/.exec(url);
  const ig = /^https:\/\/www\.instagram\.com\/(p|reel)\/([^/]+)/.exec(url);
  const basis = x ? `x:${x[1]}` : ig ? `ig:${ig[1]}/${ig[2]}` : url;
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export type IntakeStatus = "pending" | "added" | "rejected" | "unverified";

export type IntakeItem = {
  url: string;
  ts: number; // 受付時刻(epoch ms)
  status: IntakeStatus;
  attempts: number;
  processedAt?: number;
  exhibitionId?: string;
  reason?: string;
};

export type IntakeData = { version: 1; items: Record<string, IntakeItem> };

export function emptyIntakeData(): IntakeData {
  return { version: 1, items: {} };
}

// 処理済み(pending 以外)で processedAt から30日超のものを削除（tombstone の掃除）
export function sweepTombstones(data: IntakeData, now: number): IntakeData {
  const items: Record<string, IntakeItem> = {};
  for (const [k, v] of Object.entries(data.items)) {
    if (v.status !== "pending" && now - (v.processedAt ?? v.ts) > TOMBSTONE_DAYS * DAY_MS) continue;
    items[k] = v;
  }
  return { version: 1, items };
}

export type AddResult = "accepted" | "duplicate" | "already_processed" | "limit_pending" | "limit_daily";

// 正規化済み url を追加。入力 data は破壊しない。受理以外では data は掃除のみ反映（保存不要）。
export function addToQueue(data: IntakeData, url: string, now: number): { result: AddResult; data: IntakeData } {
  const swept = sweepTombstones(data, now);
  const key = intakeKey(url);
  const existing = swept.items[key];
  if (existing) {
    return { result: existing.status === "pending" ? "duplicate" : "already_processed", data: swept };
  }
  const all = Object.values(swept.items);
  if (all.filter((i) => i.status === "pending").length >= MAX_PENDING) {
    return { result: "limit_pending", data: swept };
  }
  const today = todayJst(new Date(now));
  if (all.filter((i) => todayJst(new Date(i.ts)) === today).length >= MAX_DAILY) {
    return { result: "limit_daily", data: swept };
  }
  return {
    result: "accepted",
    data: { version: 1, items: { ...swept.items, [key]: { url, ts: now, status: "pending", attempts: 0 } } },
  };
}

export function pendingItems(data: IntakeData): { url: string; ts: number; attempts: number }[] {
  return Object.values(data.items)
    .filter((i) => i.status === "pending")
    .sort((a, b) => a.ts - b.ts)
    .map((i) => ({ url: i.url, ts: i.ts, attempts: i.attempts }));
}

export type IntakeResult = {
  url: string;
  status: "added" | "rejected" | "unverified" | "retry";
  exhibitionId?: string;
  reason?: string;
};

const RESULT_STATUSES = new Set(["added", "rejected", "unverified", "retry"]);

// PATCH の適用。未知 URL・不正 status・処理済み項目は無視。retry は pending のまま attempts+1。
export function applyResults(
  data: IntakeData,
  results: IntakeResult[],
  now: number,
): { data: IntakeData; updated: number } {
  const items: Record<string, IntakeItem> = { ...data.items };
  let updated = 0;
  for (const r of results) {
    if (!r || typeof r !== "object" || !RESULT_STATUSES.has(r.status)) continue;
    const v = validateIntakeUrl(r.url);
    if (!v.ok) continue;
    const key = intakeKey(v.url);
    const cur = items[key];
    if (!cur || cur.status !== "pending") continue;
    if (r.status === "retry") {
      items[key] = { ...cur, attempts: cur.attempts + 1 };
    } else {
      const next: IntakeItem = { ...cur, status: r.status, processedAt: now };
      if (typeof r.exhibitionId === "string" && r.exhibitionId.length <= MAX_EXHIBITION_ID_LENGTH) {
        next.exhibitionId = r.exhibitionId;
      }
      if (typeof r.reason === "string") next.reason = r.reason.slice(0, MAX_REASON_LENGTH);
      items[key] = next;
    }
    updated++;
  }
  return { data: { version: 1, items }, updated };
}

const ITEM_STATUSES = new Set(["pending", "added", "rejected", "unverified"]);

function isValidIntakeItem(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const i = value as Record<string, unknown>;
  return (
    typeof i.url === "string" &&
    typeof i.ts === "number" &&
    Number.isFinite(i.ts) &&
    typeof i.status === "string" &&
    ITEM_STATUSES.has(i.status) &&
    typeof i.attempts === "number" &&
    Number.isFinite(i.attempts)
  );
}

export function isValidIntakeData(value: unknown): value is IntakeData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !v.items || typeof v.items !== "object" || Array.isArray(v.items)) return false;
  return Object.values(v.items).every(isValidIntakeItem);
}
