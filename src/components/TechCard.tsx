"use client";

import Link from "next/link";
import Image from "next/image";
import {
  type TechItem,
  COMMERCIAL_BADGE,
  TYPE_BADGE,
} from "@/lib/tech";

type Props = {
  t: TechItem;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
};

export default function TechCard({ t, isFavorite, onToggleFavorite }: Props) {
  const typeBadge = TYPE_BADGE[t.type];
  const commercial = COMMERCIAL_BADGE[t.license.commercial];
  const github = t.links.find((l) => l.kind === "github");
  return (
    <div className="group relative flex flex-col bg-white">
      {/* ── 上段：画像エリア ── */}
      <Link href={`/technology/${t.id}`} className="block relative aspect-square overflow-hidden">
        <Image
          src={t.thumbnail}
          alt={t.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
      </Link>

      {/* ── 下段：テキストエリア ── */}
      <Link href={`/technology/${t.id}`} className="block flex-1 p-4 pb-3">
        {/* ロゴマーク + 型バッジ */}
        <div className="flex items-start justify-between mb-3">
          <span className="flex items-center gap-1.5">
            <span
              className="text-[11px] font-black tracking-[0.2em] uppercase text-gray-900 leading-none"
              style={{ fontVariant: "all-small-caps" }}
            >
              RM
            </span>
            <span className="text-[8px] font-black tracking-[0.18em] uppercase text-cyan-700 leading-none">
              Tech
            </span>
          </span>
          <span
            className={`text-[9px] font-black tracking-[0.15em] uppercase leading-none px-1.5 py-1 ${typeBadge.color} ${typeBadge.bg}`}
          >
            {t.type}
          </span>
        </div>

        {/* タイトル */}
        <h2 className="text-base font-black leading-tight text-gray-900 mb-2 tracking-tight">
          {t.title}
        </h2>

        {/* 概要文 */}
        {t.summary && (
          <p className="text-[11px] text-gray-600 leading-relaxed mb-2 line-clamp-3">
            {t.summary}
          </p>
        )}

        {/* 区切り線 */}
        <div className="w-5 h-px bg-gray-900 mb-2" />

        {/* 開発元 + GitHub有無 */}
        <p className="text-[10px] text-gray-500 leading-snug line-clamp-2">
          <span className="font-bold text-gray-700">{t.org}</span>
          {github && <span className="text-gray-400"> / GitHub</span>}
        </p>

        {/* Domainハッシュタグ */}
        {t.domains.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5">
            {t.domains.slice(0, 3).map((d) => (
              <span key={d} className="text-[9px] tracking-wider text-gray-400">
                #{d}
              </span>
            ))}
          </p>
        )}
      </Link>

      {/* 商用利用可否 + 時期 */}
      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <span
          className={`text-[9px] font-black tracking-[0.1em] leading-none px-1.5 py-1 ${commercial.color} ${commercial.bg}`}
          title={t.license.spdx ?? undefined}
        >
          {commercial.label}
        </span>
        <span className="text-xs font-black text-gray-900 tabular-nums shrink-0">
          {t.date}
        </span>
      </div>

      {/* お気に入りボタン（画像に重ねる） */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(t.id);
        }}
        aria-label={isFavorite ? "お気に入りを解除" : "お気に入りに追加"}
        className={`absolute top-2 right-2 w-7 h-7 flex items-center justify-center transition-all duration-150
          ${isFavorite
            ? "text-yellow-400 opacity-100"
            : "text-white/80 opacity-0 group-hover:opacity-100 hover:text-yellow-300"
          }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill={isFavorite ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
          className="w-4 h-4 drop-shadow"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
      </button>
    </div>
  );
}
