// Exhibition intake API（SPEC §6.1）。X/Instagram の投稿 URL をキューに積むだけで、
// サーバはその URL を一切 fetch しない（取得・裏取りはローカルの日次ジョブ）。
//
// 順序（Blob 設定確認より検証・認証を先にし、Blob 未設定のローカルでも 401/400 を確認できる）:
//   POST : トークン(401) → JSON/URL検証(400) → honeypot(200・非保存) → Blob設定(503)
//          → 重複/処理済み(200) → 上限(429) → 保存(200)
//   GET  : FAVORITES_SYNC_TOKEN 未設定(503) → 認証(401) → Blob設定(503) → pending 一覧(200)
//   PATCH: GET と同認証 → body 検証(400) → Blob設定(503) → 適用(200 {updated})
// 項目は1件1 Blob（共有ファイルの read-modify-write なし）。詳細は exhibitionIntakeStore.ts。
import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { isBlobConfigured } from "@/lib/favoritesStore";
import { enqueueUrl, listPendingItems, applyIntakeResults } from "@/lib/exhibitionIntakeStore";
import { validateIntakeUrl, type IntakeResult } from "@/lib/exhibitionIntake";

// 常に最新のキューを読む必要があるため静的キャッシュ対象にしない
export const dynamic = "force-dynamic";
// list/get を複数回行うため関数のデフォルト上限に当たらないようにする
export const maxDuration = 30;

const MAX_RESULTS = 100;

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

// 長さの違いで timingSafeEqual が例外/情報漏れしないよう、sha256 同士を比較する
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// GET/PATCH 共通の Bearer 認証（favorites route と同順序: 未設定503 → 不一致401）
function checkBearer(request: NextRequest): Response | null {
  const token = process.env.FAVORITES_SYNC_TOKEN;
  if (!token) return json({ error: "exhibition intake not configured" }, 503);
  const authHeader = request.headers.get("authorization") ?? "";
  if (!safeEqual(authHeader, `Bearer ${token}`)) return json({ error: "unauthorized" }, 401);
  return null;
}

export async function POST(request: NextRequest) {
  const intakeToken = process.env.EXHIBITION_INTAKE_TOKEN;
  const provided = request.headers.get("x-intake-token") ?? "";
  if (!intakeToken || !safeEqual(provided, intakeToken)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_body" }, 400);
  }
  const b = body as Record<string, unknown>;
  const v = validateIntakeUrl(b.url);
  if (!v.ok) return json({ error: "invalid_url" }, 400);

  // honeypot: 人間には見えない欄に値があれば bot。成功を装って保存しない
  if (typeof b.website === "string" && b.website.length > 0) {
    return json({ status: "accepted" }, 200);
  }

  if (!isBlobConfigured()) return json({ error: "intake not configured" }, 503);

  try {
    const result = await enqueueUrl(v.url, Date.now());
    if (result === "duplicate") return json({ status: "duplicate" }, 200);
    if (result === "already_processed") return json({ status: "already_processed" }, 200);
    if (result === "limit_pending" || result === "limit_daily") {
      return json({ error: "rate_limited" }, 429);
    }
    return json({ status: "accepted" }, 200);
  } catch (err) {
    console.error("[api/exhibition-intake] POST failed", err);
    return json({ error: "internal error" }, 500);
  }
}

export async function GET(request: NextRequest) {
  const denied = checkBearer(request);
  if (denied) return denied;
  if (!isBlobConfigured()) return json({ error: "intake not configured" }, 503);
  try {
    return json({ items: await listPendingItems() }, 200);
  } catch (err) {
    console.error("[api/exhibition-intake] GET failed", err);
    return json({ error: "internal error" }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = checkBearer(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const results = body && typeof body === "object" ? (body as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results) || results.length > MAX_RESULTS) {
    return json({ error: "invalid_results" }, 400);
  }

  if (!isBlobConfigured()) return json({ error: "intake not configured" }, 503);
  try {
    const updated = await applyIntakeResults(results as IntakeResult[], Date.now());
    return json({ updated }, 200);
  } catch (err) {
    console.error("[api/exhibition-intake] PATCH failed", err);
    return json({ error: "internal error" }, 500);
  }
}
