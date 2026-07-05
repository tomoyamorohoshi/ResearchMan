"use client";

// ヘッダーの表示モードトグル（グリッド / 3Dノードグラフ）
import { useViewMode } from "./ViewModeContext";

export default function ViewModeToggle() {
  const { mode, setMode } = useViewMode();
  const on = mode === "graph";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="3Dノードグラフ表示に切り替え"
      onClick={() => setMode(on ? "grid" : "graph")}
      className={`flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors shrink-0 ${
        on ? "text-[#9c7a1f]" : "text-gray-400 hover:text-gray-900"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${on ? "bg-[#b08d2d]" : "bg-gray-300"}`}
        aria-hidden="true"
      />
      3D Map
    </button>
  );
}
