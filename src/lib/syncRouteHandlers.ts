// お気に入り／ごみ箱など、Blobで同期するidセット系APIの共通ハンドラ（実装計画
// researchman-ops-routine.md バッチ1 / soft-bouncing-rocket.md）。
// route.ts側は「どのBlobを読み書きするか」だけを渡し、検証・認証・エラー処理の
// 順序ロジックはここに集約する。
//
// 設計上の順序が重要:
//   POST: 入力検証(400) → Blob設定確認(503) → マージ・書き込み(200/500)
//   GET : トークン設定確認(503) → 認証(401) → Blob設定確認(503) → 読み出し(200/500)
// 「検証・認証をBlob設定確認より先に行う」ことで、BLOB_READ_WRITE_TOKEN未設定の
// ローカル環境でも400/401系の検証ロジックをcurlで確認できる
// （scripts/smoke-favorites-api.mjs / scripts/smoke-trash-api.mjs 参照）。Blob未設定時は
// 常に503を返し、クライアント(createSyncedIdSet.ts)は黙ってlocalStorageのみで動作を継続する。
import type { NextRequest } from "next/server";
import {
  validateIncomingItems,
  mergeFavoritesItems,
  type FavoritesData,
} from "@/lib/favoritesMerge";
import { isBlobConfigured } from "@/lib/favoritesStore";

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, { status });
}

export type SyncRouteConfig = {
  readBlob: () => Promise<FavoritesData>;
  writeBlob: (data: FavoritesData) => Promise<void>;
  // Blob未設定(503)時のエラーメッセージ。favorites routeの既存レスポンス文言
  // ("favorites sync not configured")を変えないため、呼び出し側で指定させる
  notConfiguredMessage: string;
  // console.error のログ接頭辞（例 "api/favorites"）
  logLabel: string;
};

export function createSyncRouteHandlers({
  readBlob,
  writeBlob,
  notConfiguredMessage,
  logLabel,
}: SyncRouteConfig) {
  async function POST(request: NextRequest) {
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
      return jsonResponse({ error: notConfiguredMessage }, 503);
    }

    try {
      const current = await readBlob();
      const mergedItems = mergeFavoritesItems(current.items, validation.items);
      const next: FavoritesData = { version: 1, items: mergedItems };
      await writeBlob(next);
      return jsonResponse(next, 200);
    } catch (err) {
      console.error(`[${logLabel}] POST failed`, err);
      return jsonResponse({ error: "internal error" }, 500);
    }
  }

  async function GET(request: NextRequest) {
    const token = process.env.FAVORITES_SYNC_TOKEN;
    if (!token) {
      return jsonResponse({ error: notConfiguredMessage }, 503);
    }

    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${token}`) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    if (!isBlobConfigured()) {
      return jsonResponse({ error: notConfiguredMessage }, 503);
    }

    try {
      const data = await readBlob();
      return jsonResponse(data, 200);
    } catch (err) {
      console.error(`[${logLabel}] GET failed`, err);
      return jsonResponse({ error: "internal error" }, 500);
    }
  }

  return { POST, GET };
}
