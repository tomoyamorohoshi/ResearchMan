"use client";

import { useEffect, useState } from "react";

// 値の変化をdelayMs遅らせて反映する（検索入力ごとの全件走査を減らす）。空文字への戻りも同じ遅延
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
