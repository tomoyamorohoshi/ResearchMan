"use client";

// Exhibition「行きたい」。お気に入り(useFavorites.ts)と同一の同期機構(createSyncedIdSet.ts)を
// 別のlocalStorageキー・別のAPIエンドポイントで使う。いいね・ごみ箱とは独立した状態。
import { createSyncedIdSet } from "./createSyncedIdSet";

const STORAGE_KEY = "researchman-want-to-go";
const SYNC_ENDPOINT = "/api/want-to-go";

const { useSyncedIdSet } = createSyncedIdSet({
  storageKey: STORAGE_KEY,
  endpoint: SYNC_ENDPOINT,
});

export function useWantToGo() {
  const { ids, toggle, mounted } = useSyncedIdSet();
  return { wantToGo: ids, toggle, mounted };
}
