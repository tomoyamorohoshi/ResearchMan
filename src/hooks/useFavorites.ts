"use client";

// お気に入り機能（バッチ1・researchman-ops-routine.md）。
// 同期ロジック本体は createSyncedIdSet.ts（お気に入り/ごみ箱で共通化）に抽出済み。
// このファイルは外部契約（返り値 {favorites, toggle, mounted}・localStorageキー・
// 保存形式・同期挙動）を現状のまま維持する薄いラッパー。
import { createSyncedIdSet } from "./createSyncedIdSet";

// 旧プロジェクト名由来のキー。改名する場合は localStorage の移行処理が必須（P5-6参照）
const STORAGE_KEY = "creative-edge-favorites";
// お気に入りサーバ同期API（バッチ1・researchman-ops-routine.md）のエンドポイント
const SYNC_ENDPOINT = "/api/favorites";

const { useSyncedIdSet } = createSyncedIdSet({
  storageKey: STORAGE_KEY,
  endpoint: SYNC_ENDPOINT,
});

export function useFavorites() {
  const { ids, toggle, mounted } = useSyncedIdSet();
  return { favorites: ids, toggle, mounted };
}
