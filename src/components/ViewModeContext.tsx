"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewMode = "grid" | "graph";

type Ctx = {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  // ON/OFF切替トランジション中はtrue。トグルの多重操作ガードに使う
  busy: boolean;
  setBusy: (b: boolean) => void;
  // 3D MAPトグルが有効なページか（Provider在り=true）。trueの時だけ各ギャラリーは
  // マウント後のアイドル時間にサムネイルの事前ウォームを開始する
  // （Provider在りページ: /（Case）・/technology（Tech）。/awards等Provider不在ページで
  // 無駄な帯域を使わないためのゲート）
  enabled: boolean;
};

// デフォルトgrid・busy=false・enabled=false: Provider不在ページ（/awards/*等）
// では常にグリッド＝現状不変・事前ウォームも行わない
const ViewModeCtx = createContext<Ctx>({
  mode: "grid",
  setMode: () => {},
  busy: false,
  setBusy: () => {},
  enabled: false,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>("grid");
  const [busy, setBusy] = useState(false);
  return (
    <ViewModeCtx.Provider value={{ mode, setMode, busy, setBusy, enabled: true }}>{children}</ViewModeCtx.Provider>
  );
}

export function useViewMode() {
  return useContext(ViewModeCtx);
}
