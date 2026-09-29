// 巨大データJSON（cases/ideas/idea-layouts）のBlobアップロード用・署名発行API。
// idea-layoutsは65MBあり、Vercel Functionsのボディ上限(4.5MB)を超えるためサーバ経由では
// 上げられない。ここでは「署名付きURLの発行」だけを行い、PC側ジョブ(scripts/upload-public-data.mjs)
// が @vercel/blob/client の uploadPresigned で直接Blobへアップロードする。
// ストアはOIDC接続（read-writeトークン無し）のため handleUpload ではなく handleUploadPresigned
// + issueSignedToken を使う。認証は /api/favorites のGETと同じ Bearer FAVORITES_SYNC_TOKEN。
import type { NextRequest } from "next/server";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { isBlobConfigured } from "@/lib/favoritesStore";
import { isAllowedBlobPathname, isAuthorizedBearer } from "@/lib/publicDataBlob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;
// クライアント（ブラウザ/CDN）キャッシュ秒数。Blobの最小は60秒。上書き後は最大この秒数で
// 新データが反映される（現状のmax-age=0＋毎回再検証より、ETag/304で転送量は減る）
const CACHE_MAX_AGE_SECONDS = 300;

export async function POST(request: NextRequest) {
  const token = process.env.FAVORITES_SYNC_TOKEN;
  if (!token) return Response.json({ error: "data upload not configured" }, { status: 503 });
  if (!isAuthorizedBearer(request.headers.get("authorization"), token)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isBlobConfigured()) {
    return Response.json({ error: "data upload not configured" }, { status: 503 });
  }

  let body: HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!isAllowedBlobPathname(pathname)) throw new Error("pathname not allowed");
        const signed = await issueSignedToken({
          pathname,
          operations: ["put"],
          maximumSizeInBytes: MAX_BYTES,
        });
        return {
          token: signed,
          urlOptions: {
            allowOverwrite: true,
            addRandomSuffix: false,
            cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
            maximumSizeInBytes: MAX_BYTES,
          },
        };
      },
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.error("[api/data-upload] failed", err);
    const message = err instanceof Error && err.message === "pathname not allowed" ? err.message : "internal error";
    return Response.json({ error: message }, { status: message === "internal error" ? 500 : 400 });
  }
}
