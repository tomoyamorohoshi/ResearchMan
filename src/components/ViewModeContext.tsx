"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewMode = "grid" | "graph";

type Ctx = {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  // ON/OFF切替トランジション中はtrue。トグルの多重操作ガードに使う
  busy: boolean;
  setBusy: (b: boolean) => void;
};

// デフォルトgrid・busy=false: Provider不在ページ（/awards, /technology）では
// 常にグリッド＝現状不変
const ViewModeCtx = createContext<Ctx>({
  mode: "grid",
  setMode: () => {},
  busy: false,
  setBusy: () => {},
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>("grid");
  const [busy, setBusy] = useState(false);
  return (
    <ViewModeCtx.Provider value={{ mode, setMode, busy, setBusy }}>{children}</ViewModeCtx.Provider>
  );
}

export function useViewMode() {
  return useContext(ViewModeCtx);
}
