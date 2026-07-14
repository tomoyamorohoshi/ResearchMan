"use client";

// カードの「ごみ箱」機能。お気に入り(useFavorites.ts)と同一の同期機構
// (createSyncedIdSet.ts)を、別のlocalStorageキー・別のAPIエンドポイントで使う。
// data/cases.json 本体は一切変更しない。「trashedなidの集合」を持つだけで、
// 復元はこの集合からidを外すこと（＝toggleの再実行）に過ぎない。
import { createSyncedIdSet } from "./createSyncedIdSet";

const STORAGE_KEY = "researchman-trash";
const SYNC_ENDPOINT = "/api/trash";

const { useSyncedIdSet } = createSyncedIdSet({
  storageKey: STORAGE_KEY,
  endpoint: SYNC_ENDPOINT,
});

export function useTrash() {
  const { ids, toggle, mounted } = useSyncedIdSet();
  return { trashed: ids, toggle, mounted };
}
