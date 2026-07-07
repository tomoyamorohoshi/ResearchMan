// お気に入りサーバ同期API（バッチ1・実装計画 researchman-ops-routine.md）。
// 認証なし・破壊不能なマージのみを許すPOSTと、分析ジョブ用の認証付きGETの2本。
//
// 設計上の順序が重要:
//   POST: 入力検証(400) → Blob設定確認(503) → マージ・書き込み(200/500)
//   GET : トークン設定確認(503) → 認証(401) → Blob設定確認(503) → 読み出し(200/500)
// 「検証・認証をBlob設定確認より先に行う」ことで、BLOB_READ_WRITE_TOKEN未設定の
// ローカル環境でも400/401系の検証ロジックをcurlで確認できる
// （scripts/smoke-favorites-api.mjs 参照）。Blob未設定時は常に503を返し、
// クライアント(useFavorites.ts)は黙ってlocalStorageのみで動作を継続する。
import type { NextRequest } from "next/server";
import {
  validateIncomingItems,
  mergeFavoritesItems,
  type FavoritesData,
} from "@/lib/favoritesMerge";
import { isBlobConfigured, readFavoritesBlob, writeFavoritesBlob } from "@/lib/favoritesStore";

// 常に最新のBlobを読む必要があるため静的キャッシュ対象にしない
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, { status });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const validation = validateIncomingItems(body);
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 400);
  }

  if (!isBlobConfigured()) {
    // Blob未設定＝サーバ同期未セットアップ。クライアント側はこれをlocalStorageのみ
    // 動作継続のシグナルとして扱う（現状と同一挙動）
    return jsonResponse({ error: "favorites sync not configured" }, 503);
  }

  try {
    const current = await readFavoritesBlob();
    const mergedItems = mergeFavoritesItems(current.items, validation.items);
    const next: FavoritesData = { version: 1, items: mergedItems };
    await writeFavoritesBlob(next);
    return jsonResponse(next, 200);
  } catch (err) {
    console.error("[api/favorites] POST failed", err);
    return jsonResponse({ error: "internal error" }, 500);
  }
}

export async function GET(request: NextRequest) {
  const token = process.env.FAVORITES_SYNC_TOKEN;
  if (!token) {
    return jsonResponse({ error: "favorites sync not configured" }, 503);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${token}`) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  if (!isBlobConfigured()) {
    return jsonResponse({ error: "favorites sync not configured" }, 503);
  }

  try {
    const data = await readFavoritesBlob();
    return jsonResponse(data, 200);
  } catch (err) {
    console.error("[api/favorites] GET failed", err);
    return jsonResponse({ error: "internal error" }, 500);
  }
}
