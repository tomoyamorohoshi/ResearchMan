"use client";

import { useWantToGo } from "@/hooks/useWantToGo";

// 詳細ページ用の「行きたい」ボタン（ページ本体は Server Component のため分離）
export default function WantToGoButton({ id }: { id: string }) {
  const { wantToGo, toggle, mounted } = useWantToGo();
  const on = mounted && wantToGo.has(id);
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-label="行きたい"
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 text-[11px] tracking-[0.2em] uppercase font-black px-4 py-2 border transition-colors
        ${on ? "border-sky-500 bg-sky-50 text-sky-600" : "border-gray-400 text-gray-600 hover:border-gray-900 hover:text-gray-900"}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        className="w-4 h-4"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 21V4m0 0h11l-2 4 2 4H5" />
      </svg>
      <span aria-hidden="true">行きたい</span>
    </button>
  );
}
