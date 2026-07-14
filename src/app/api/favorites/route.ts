// お気に入りサーバ同期API（バッチ1・実装計画 researchman-ops-routine.md）。
// 検証・認証・エラー処理の共通ロジックは syncRouteHandlers.ts に集約済み（ごみ箱API
// (api/trash/route.ts) と共用）。このファイルは「favoritesのBlobを読み書きする」設定のみ持つ。
import { createSyncRouteHandlers } from "@/lib/syncRouteHandlers";
import { readFavoritesBlob, writeFavoritesBlob } from "@/lib/favoritesStore";

// 常に最新のBlobを読む必要があるため静的キャッシュ対象にしない
export const dynamic = "force-dynamic";

export const { POST, GET } = createSyncRouteHandlers({
  readBlob: readFavoritesBlob,
  writeBlob: writeFavoritesBlob,
  // 既存レスポンス仕様を変えないため、従来どおりの文言を維持する
  notConfiguredMessage: "favorites sync not configured",
  logLabel: "api/favorites",
});
