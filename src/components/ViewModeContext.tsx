"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewMode = "grid" | "graph";

type Ctx = { mode: ViewMode; setMode: (m: ViewMode) => void };

// デフォルトgrid: Provider不在ページ（/awards, /technology）では常にグリッド＝現状不変
const ViewModeCtx = createContext<Ctx>({ mode: "grid", setMode: () => {} });

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>("grid");
  return <ViewModeCtx.Provider value={{ mode, setMode }}>{children}</ViewModeCtx.Provider>;
}

export function useViewMode() {
  return useContext(ViewModeCtx);
}
