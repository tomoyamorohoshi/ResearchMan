"use client";

// ヘッダーの表示モードトグル（グリッド / 3Dノードグラフ）
import { useViewMode } from "./ViewModeContext";

export default function ViewModeToggle() {
  const { mode, setMode, busy } = useViewMode();
  const on = mode === "graph";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="3Dノードグラフ表示に切り替え"
      disabled={busy}
      onClick={(e) => {
        // マウスクリック時（e.detail>0）はフォーカスを外す。残したままだと、直後の
        // スペースキーが「ボタンの再活性化＝モード再切替」になり、3Dモードの
        // スペース操作（カテゴリ接近/整列）を意図した押下がOFFトグルとして誤発火する。
        // キーボード操作（e.detail===0）ではフォーカスを維持しa11yを保つ
        if (e.detail > 0) e.currentTarget.blur();
        setMode(on ? "grid" : "graph");
      }}
      className={`flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
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
