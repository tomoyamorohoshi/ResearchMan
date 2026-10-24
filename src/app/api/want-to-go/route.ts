// Exhibition「行きたい」サーバ同期API。お気に入りAPI(api/favorites/route.ts)と同じ構造で、
// Blob pathnameのみ異なる。検証・認証・マージは syncRouteHandlers.ts / favoritesMerge.ts を共用
// （GET認証も既存の FAVORITES_SYNC_TOKEN を共用）。
import { createSyncRouteHandlers } from "@/lib/syncRouteHandlers";
import { readWantToGoBlob, writeWantToGoBlob } from "@/lib/favoritesStore";

// 常に最新のBlobを読む必要があるため静的キャッシュ対象にしない
export const dynamic = "force-dynamic";

export const { POST, GET } = createSyncRouteHandlers({
  readBlob: readWantToGoBlob,
  writeBlob: writeWantToGoBlob,
  notConfiguredMessage: "want-to-go sync not configured",
  logLabel: "api/want-to-go",
});
