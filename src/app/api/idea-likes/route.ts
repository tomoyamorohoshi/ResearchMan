// アイデアの「いいね」サーバ同期API（/ideas ページ機能追加）。
// お気に入りAPI(api/favorites/route.ts)・ごみ箱API(api/trash/route.ts)と全く同じ構造で、
// Blob pathnameのみ異なる。検証・認証・エラー処理の共通ロジックは syncRouteHandlers.ts に
// 集約済み。GET認証は新しいenvを増やさず、既存のFAVORITES_SYNC_TOKENを共用する。
import { createSyncRouteHandlers } from "@/lib/syncRouteHandlers";
import { readIdeaLikesBlob, writeIdeaLikesBlob } from "@/lib/favoritesStore";

// 常に最新のBlobを読む必要があるため静的キャッシュ対象にしない
export const dynamic = "force-dynamic";

export const { POST, GET } = createSyncRouteHandlers({
  readBlob: readIdeaLikesBlob,
  writeBlob: writeIdeaLikesBlob,
  notConfiguredMessage: "idea likes sync not configured",
  logLabel: "api/idea-likes",
});
