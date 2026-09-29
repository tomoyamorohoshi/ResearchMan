// 巨大データJSON（cases/ideas/idea-layouts）の配信プロキシ。実体はVercel Blob（privateストア）に
// brotli事前圧縮bytesとして固定パスで置かれ（scripts/upload-public-data.mjs）、ブラウザから直接は
// 読めないためここで中継する。デプロイ同梱(public/data)をやめる目的はDeployment Storageの肥大防止。
// キャッシュ: ブラウザ60秒 / CDN(s-maxage)5分 + stale-while-revalidate 1日。ETagで304対応。
// brotli+gzip併記でないクライアント（ボット等）には406（46MBの展開応答・CDN MISSを避ける。理由は acceptsBrotliAndGzip）。
import type { NextRequest } from "next/server";
import { get } from "@vercel/blob";
import { isBlobConfigured } from "@/lib/favoritesStore";
import { acceptsBrotliAndGzip, blobPathnameFor, isAllowedBlobPathname } from "@/lib/publicDataBlob";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const pathname = blobPathnameFor(name);
  if (!isAllowedBlobPathname(pathname)) return Response.json({ error: "not found" }, { status: 404 });
  if (!isBlobConfigured()) return Response.json({ error: "not configured" }, { status: 503 });

  if (!acceptsBrotliAndGzip(request.headers.get("accept-encoding"))) {
    return Response.json(
      { error: "Accept-Encoding must include br and gzip" },
      { status: 406, headers: { Vary: "Accept-Encoding" } },
    );
  }
  try {
    const result = await get(pathname, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    });
    if (!result) return Response.json({ error: "not found" }, { status: 404 });
    const headers: Record<string, string> = {
      "Cache-Control": CACHE_CONTROL,
      ETag: result.blob.etag,
      Vary: "Accept-Encoding",
    };
    if (result.statusCode === 304) return new Response(null, { status: 304, headers });
    headers["Content-Type"] = "application/json; charset=utf-8";
    return new Response(result.stream, { status: 200, headers: { ...headers, "Content-Encoding": "br" } });
  } catch (err) {
    console.error("[api/public-data] failed", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
