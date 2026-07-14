// カードの「ごみ箱」サーバ同期API（実装計画 soft-bouncing-rocket.md）。
// お気に入りAPI(api/favorites/route.ts)と全く同じ構造で、Blob pathnameのみ異なる。
// 検証・認証・エラー処理の共通ロジックは syncRouteHandlers.ts に集約済み。
// GET認証は新しいenvを増やさず、既存のFAVORITES_SYNC_TOKENを共用する。
import { createSyncRouteHandlers } from "@/lib/syncRouteHandlers";
import { readTrashBlob, writeTrashBlob } from "@/lib/favoritesStore";

// 常に最新のBlobを読む必要があるため静的キャッシュ対象にしない
export const dynamic = "force-dynamic";

export const { POST, GET } = createSyncRouteHandlers({
  readBlob: readTrashBlob,
  writeBlob: writeTrashBlob,
  notConfiguredMessage: "trash sync not configured",
  logLabel: "api/trash",
});
