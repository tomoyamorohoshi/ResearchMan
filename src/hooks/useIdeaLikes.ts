"use client";

// /ideas ページの「いいね」機能。useFavorites.ts(cases/tech)と同一の同期機構
// (createSyncedIdSet.ts)を、別のlocalStorageキー・別のAPIエンドポイントで使う。
// お気に入り(useFavorites)とはlocalStorageキー・Blob pathnameが独立しているため、
// cases/techのいいねとideaのいいねは互いに影響しない。
import { createSyncedIdSet } from "./createSyncedIdSet";

const STORAGE_KEY = "researchman-idea-likes";
const SYNC_ENDPOINT = "/api/idea-likes";

const { useSyncedIdSet } = createSyncedIdSet({
  storageKey: STORAGE_KEY,
  endpoint: SYNC_ENDPOINT,
});

export function useIdeaLikes() {
  const { ids, toggle, mounted } = useSyncedIdSet();
  return { likes: ids, toggle, mounted };
}
