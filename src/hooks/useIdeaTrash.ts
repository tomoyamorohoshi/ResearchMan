"use client";

// /ideas ページの「ゴミ箱」機能。useTrash.ts(cases/tech)と同一の同期機構
// (createSyncedIdSet.ts)を、別のlocalStorageキー・別のAPIエンドポイントで使う。
// data/ideas.json本体は一切変更しない。「ゴミ箱行きなidの集合」を持つだけで、
// 復元はこの集合からidを外すこと（＝toggleの再実行）に過ぎない。
import { createSyncedIdSet } from "./createSyncedIdSet";

const STORAGE_KEY = "researchman-idea-trash";
const SYNC_ENDPOINT = "/api/idea-trash";

const { useSyncedIdSet } = createSyncedIdSet({
  storageKey: STORAGE_KEY,
  endpoint: SYNC_ENDPOINT,
});

export function useIdeaTrash() {
  const { ids, toggle, mounted } = useSyncedIdSet();
  return { trashed: ids, toggle, mounted };
}
