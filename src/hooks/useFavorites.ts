"use client";

import { useSyncExternalStore, useCallback } from "react";
import { mergeFavoritesItems, type FavoritesItems } from "@/lib/favoritesMerge";

// 旧プロジェクト名由来のキー。改名する場合は localStorage の移行処理が必須（P5-6参照）
const STORAGE_KEY = "creative-edge-favorites";
// お気に入りサーバ同期API（バッチ1・researchman-ops-routine.md）のエンドポイント
const SYNC_ENDPOINT = "/api/favorites";
// 連続トグル（複数枚を素早くお気に入り登録等）をまとめて1回のPOSTにするデバウンス幅
const SYNC_DEBOUNCE_MS = 1500;

// localStorage を単一の外部ストアとして扱う（useSyncExternalStore用）。
// getSnapshot は生文字列が変わらない限り同一 Set インスタンスを返す（毎回 new Set すると無限再レンダーになる）。
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedItems: FavoritesItems = {};
// UI(CaseCard/TechCard/GalleryClient等)はSetで参照する既存契約を維持する（fav:trueのidのみを含む派生ビュー）
let cachedSet: Set<string> = new Set();
const EMPTY: Set<string> = new Set(); // SSR/ハイドレーション時のスナップショット（サーバは常に空）

function computeFavSet(items: FavoritesItems): Set<string> {
  const set = new Set<string>();
  for (const [id, entry] of Object.entries(items)) {
    if (entry.fav) set.add(id);
  }
  return set;
}

// 旧形式(string[])からのマイグレーションで割り当てるts。
// 実際にユーザーが操作した時刻ではない（＝いつ本当にお気に入りにしたかは不明）ため、
// Date.now()等の「現在時刻」を使うと、他デバイスで過去に行われた本物の解除操作
// （ts=解除した実時刻。マイグレーション時刻より必ず小さい）をLWWマージで上書きし、
// 意図的に消したはずのお気に入りが復活してしまう（サーバに何らかの記録さえあれば
// そちらを常に信頼すべき）。0は「実時刻としては最古＝サーバ側に記録があれば必ず負ける」
// 番兵値として機能する
const MIGRATED_LEGACY_TS = 0;

// 保存済み文字列を新形式(FavoritesItems)へ変換する。
// 旧形式(string[])は fav:true・ts:MIGRATED_LEGACY_TS として取り込む（マイグレーション）。
// この関数はlocalStorageへ書き込まない（読み取り専用）。移行後の形は次回のtoggle→persist()で
// 自然に書き戻される（getSnapshot相当の関数内でlocalStorageへ書き込む副作用を避けるため）。
function parseStored(raw: string | null): FavoritesItems {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (Array.isArray(parsed)) {
    const items: FavoritesItems = {};
    for (const id of parsed) {
      if (typeof id === "string") items[id] = { fav: true, ts: MIGRATED_LEGACY_TS };
    }
    return items;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "items" in parsed &&
    typeof (parsed as { items: unknown }).items === "object" &&
    (parsed as { items: unknown }).items !== null
  ) {
    return (parsed as { items: FavoritesItems }).items;
  }
  return {};
}

function readStore(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {}
  if (raw === cachedRaw) return cachedSet; // 変化なし → 同一インスタンスを返す
  cachedRaw = raw;
  cachedItems = parseStored(raw);
  cachedSet = computeFavSet(cachedItems);
  return cachedSet;
}

function persist(items: FavoritesItems) {
  const raw = JSON.stringify({ version: 1, items });
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {}
  // getSnapshot が新インスタンスを返すようキャッシュを更新してから通知
  cachedRaw = raw;
  cachedItems = items;
  cachedSet = computeFavSet(items);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit() {
  for (const l of listeners) l();
}

// --- サーバ同期（バッチ1） ---
// toggle 時にデバウンスしてPOSTし、レスポンス（サーバ側でLWWマージ済みの全量items）を
// ローカルへ再度LWWマージで反映する。マウント時の GET は行わない（tokenをクライアントに
// 置かないため。サーバ分析ジョブ専用）。オフライン・エンドポイント未設定(503)・エラー時は
// 例外を握りつぶし、localStorageのみで動作を継続する（Blob未設定時も現状と同一挙動という要件）。
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight = false;
let syncPendingAfterInFlight = false;

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void runSync();
  }, SYNC_DEBOUNCE_MS);
}

async function runSync() {
  if (syncInFlight) {
    // 送信中にさらにtoggleがあった場合、完了後にもう一度まとめて送る
    syncPendingAfterInFlight = true;
    return;
  }
  syncInFlight = true;
  try {
    const res = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cachedItems }),
    });
    if (res.ok) {
      const serverData: unknown = await res.json().catch(() => null);
      if (
        serverData &&
        typeof serverData === "object" &&
        "items" in serverData &&
        typeof (serverData as { items: unknown }).items === "object" &&
        (serverData as { items: unknown }).items !== null
      ) {
        // 送信中にローカルで新たなtoggleが起きていても、LWWマージなのでより新しいts側が残る
        const merged = mergeFavoritesItems(cachedItems, (serverData as { items: FavoritesItems }).items);
        persist(merged);
        emit();
      }
    }
    // 503(未設定)・4xx/5xxはすべて無視してlocalStorageのみで継続する（要件どおり）
  } catch {
    // オフライン等のfetch失敗。localStorageのみで継続する
  } finally {
    syncInFlight = false;
    if (syncPendingAfterInFlight) {
      syncPendingAfterInFlight = false;
      scheduleSync();
    }
  }
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, readStore, () => EMPTY);
  // サーバでは false、クライアントのハイドレーション後に true（従来の mounted と同じ意味）
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const toggle = useCallback((id: string) => {
    readStore(); // cachedItemsを最新化（他タブでの変更・旧形式マイグレーションを取り込む）
    const current = cachedItems[id];
    const next: FavoritesItems = {
      ...cachedItems,
      [id]: { fav: !(current?.fav ?? false), ts: Date.now() },
    };
    persist(next);
    emit();
    scheduleSync();
  }, []);

  return { favorites, toggle, mounted };
}
