// お気に入り／ごみ箱サーバ同期のBlob I/O層（両者ともに同一形式のFavoritesDataを
// pathnameだけ変えて読み書きする。データモデルの詳細はfavoritesMerge.ts参照）。
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

// 固定pathname。用途ごとに1個のJSONのみを扱う（バッチ1の設計どおり。ごみ箱機能追加に伴い
// pathnameをパラメータ化し、read/write本体は共通のヘルパー関数に集約する）
const FAVORITES_BLOB_PATHNAME = "favorites/favorites.json";
const TRASH_BLOB_PATHNAME = "trash/trash.json";
// /ideas ページの「いいね」「ゴミ箱」機能用（favorites/trashとは別idの集合。
// data/ideas.json本体は変更しない＝ゴミ箱は復元可能なアーカイブとして残る）
const IDEA_LIKES_BLOB_PATHNAME = "idea-likes/idea-likes.json";
const IDEA_TRASH_BLOB_PATHNAME = "idea-trash/idea-trash.json";

// Blob未設定時、呼び出し側はBlobに触れず503を返す
// （ローカル/初回デプロイでenv未設定でもサイトが現状(localStorageのみ)と同一挙動で動く要件）
//
// 認証は2方式のどちらでも可:
//   1. 従来のread-writeトークン（BLOB_READ_WRITE_TOKEN）
//   2. Vercel OIDC（Fluid Compute実行時に VERCEL_OIDC_TOKEN が自動注入され、BLOB_STORE_ID で
//      対象ストアを特定する）。@vercel/blob 2.5.0 は put/get 時にトークン未指定でも
//      「OIDCトークンが利用可能かつ BLOB_STORE_ID がセットされていれば」自動でOIDC経路を使う。
// OIDCでストアを接続した場合 BLOB_READ_WRITE_TOKEN は注入されないため、BLOB_STORE_ID の有無も見る。
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function isValidFavoritesData(value: unknown): value is FavoritesData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Boolean(v.items) && typeof v.items === "object" && !Array.isArray(v.items);
}

async function readBlobData(pathname: string): Promise<FavoritesData> {
  const result = await get(pathname, { access: "private" });
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

async function writeBlobData(pathname: string, data: FavoritesData): Promise<void> {
  await put(pathname, JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export function readFavoritesBlob(): Promise<FavoritesData> {
  return readBlobData(FAVORITES_BLOB_PATHNAME);
}

export function writeFavoritesBlob(data: FavoritesData): Promise<void> {
  return writeBlobData(FAVORITES_BLOB_PATHNAME, data);
}

export function readTrashBlob(): Promise<FavoritesData> {
  return readBlobData(TRASH_BLOB_PATHNAME);
}

export function writeTrashBlob(data: FavoritesData): Promise<void> {
  return writeBlobData(TRASH_BLOB_PATHNAME, data);
}

export function readIdeaLikesBlob(): Promise<FavoritesData> {
  return readBlobData(IDEA_LIKES_BLOB_PATHNAME);
}

export function writeIdeaLikesBlob(data: FavoritesData): Promise<void> {
  return writeBlobData(IDEA_LIKES_BLOB_PATHNAME, data);
}

export function readIdeaTrashBlob(): Promise<FavoritesData> {
  return readBlobData(IDEA_TRASH_BLOB_PATHNAME);
}

export function writeIdeaTrashBlob(data: FavoritesData): Promise<void> {
  return writeBlobData(IDEA_TRASH_BLOB_PATHNAME, data);
}
