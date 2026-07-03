"use client";

import { useSyncExternalStore, useCallback } from "react";

// 旧プロジェクト名由来のキー。改名する場合は localStorage の移行処理が必須（P5-6参照）
const STORAGE_KEY = "creative-edge-favorites";

// localStorage を単一の外部ストアとして扱う（useSyncExternalStore用）。
// getSnapshot は生文字列が変わらない限り同一 Set インスタンスを返す（毎回 new Set すると無限再レンダーになる）。
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSet: Set<string> = new Set();
const EMPTY: Set<string> = new Set(); // SSR/ハイドレーション時のスナップショット（サーバは常に空）

function readStore(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {}
  if (raw === cachedRaw) return cachedSet; // 変化なし → 同一インスタンスを返す
  cachedRaw = raw;
  try {
    cachedSet = new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    cachedSet = new Set();
  }
  return cachedSet;
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

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, readStore, () => EMPTY);
  // サーバでは false、クライアントのハイドレーション後に true（従来の mounted と同じ意味）
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  const toggle = useCallback((id: string) => {
    const next = new Set(readStore());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const raw = JSON.stringify([...next]);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {}
    // getSnapshot が新インスタンスを返すようキャッシュを更新してから通知
    cachedRaw = raw;
    cachedSet = next;
    emit();
  }, []);

  return { favorites, toggle, mounted };
}
