// お気に入りサーバ同期（バッチ1）のBlob I/O層。
// サーバ専用（@vercel/blobはNode.js向けSDKのため、このモジュールはroute.tsからのみ import する）。
//
// Vercel Blob側のAPI詳細（2026-07時点 @vercel/blob 2.5.0）:
// - put()/get() ともに access: 'private' | 'public' が必須（get()はaccessが必須プロパティ）
// - put() は既定で pathname にランダムsuffixを付与する(addRandomSuffix既定true)ため、
//   固定pathnameで毎回上書きしたい本用途では addRandomSuffix:false + allowOverwrite:true が必須
//   （これらを付けないと書き込みのたびに新しいURLのblobが増え続け、次回読み出しで見つからなくなる）
// - get() は blob が存在しない場合 null を返す（初回書き込み前は必ずこのケース）
import { get, put } from "@vercel/blob";
import { emptyFavoritesData, type FavoritesData } from "@/lib/favoritesMerge";

// 固定pathname。favorites.json 1個のみを扱う（バッチ1の設計どおり）
const FAVORITES_BLOB_PATHNAME = "favorites/favorites.json";

// BLOB_READ_WRITE_TOKEN 欠落時、呼び出し側はBlobに触れず503を返す
// （ローカル/初回デプロイでenv未設定でもサイトが現状(localStorageのみ)と同一挙動で動く要件）
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function isValidFavoritesData(value: unknown): value is FavoritesData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Boolean(v.items) && typeof v.items === "object" && !Array.isArray(v.items);
}

export async function readFavoritesBlob(): Promise<FavoritesData> {
  const result = await get(FAVORITES_BLOB_PATHNAME, { access: "private" });
  if (!result) return emptyFavoritesData();
  const text = await new Response(result.stream).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 壊れたJSONは空として扱う（読み取り側の防御。書き込みは常にJSON.stringifyしたものだけ）
    return emptyFavoritesData();
  }
  if (!isValidFavoritesData(parsed)) return emptyFavoritesData();
  return { version: 1, items: parsed.items };
}

export async function writeFavoritesBlob(data: FavoritesData): Promise<void> {
  await put(FAVORITES_BLOB_PATHNAME, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
