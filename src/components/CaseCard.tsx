"use client";

import Link from "next/link";
import Image from "next/image";
import type { Case } from "@/lib/cases";
import { getAwardLevel } from "@/lib/awardLevel";
import { getCaseAwardRefs, getAwardLevelForCollection, type OrgKey } from "@/lib/awards";
import { isRadarCase } from "@/lib/researchSources";
import { tagLabel } from "@/lib/tags";

type Props = {
  c: Case;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  // 指定時、バッジは「award文字列全体の最高賞」ではなくこの部門でのレベルを表示する
  // （部門ページ用。通常ギャラリーでは未指定＝従来どおり全体最高賞を表示）
  awardContext?: { org: OrgKey; year: string; category: string };
};

export default function CaseCard({ c, isFavorite, onToggleFavorite, awardContext }: Props) {
  const level = awardContext
    ? getAwardLevelForCollection(c.award, awardContext.org, c.year, awardContext.year, awardContext.category)
    : getAwardLevel(c.award);
  const awardCount = getCaseAwardRefs(c).length;
  const isRadar = isRadarCase(c);
  return (
    <div
      className={`group relative flex flex-col ${
        isRadar ? "bg-[#f6efdd]" : "bg-white"
      }`}
    >
      {/* ── 上段：画像エリア ── */}
      <Link href={`/cases/${c.id}`} className="block relative aspect-square overflow-hidden">
        <Image
          src={c.thumbnail}
          alt={c.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
      </Link>

      {/* ── 下段：テキストエリア ── */}
      <Link href={`/cases/${c.id}`} className="block flex-1 p-4 pb-3">
        {/* ロゴマーク + カテゴリ */}
        <div className="flex items-start justify-between mb-3">
          <span className="flex items-center gap-1.5">
            <span
              className="text-[11px] font-black tracking-[0.2em] uppercase text-gray-900 leading-none"
              style={{ fontVariant: "all-small-caps" }}
            >
              RM
            </span>
            {isRadar && (
              <span className="flex items-center gap-1 text-[8px] font-black tracking-[0.18em] uppercase text-[#9c7a1f] leading-none">
                <span className="w-1 h-1 rounded-full bg-[#b08d2d]" aria-hidden="true" />
                Radar
              </span>
            )}
          </span>
          <div className="text-right">
            {c.categories.slice(0, 1).map((cat) => (
              <span
                key={cat}
                className="text-[9px] tracking-widest uppercase text-gray-400 leading-tight block"
              >
                {cat}
              </span>
            ))}
            {c.categories[1] && (
              <span className="text-[9px] tracking-widest uppercase text-gray-400 leading-tight block">
                {c.categories[1]}
              </span>
            )}
          </div>
        </div>

        {/* タイトル */}
        <h2 className="text-base font-black leading-tight text-gray-900 mb-2 tracking-tight">
          {c.title}
        </h2>

        {/* 概要文 */}
        {c.summary && (
          <p className="text-[11px] text-gray-600 leading-relaxed mb-2 line-clamp-3">
            {c.summary}
          </p>
        )}

        {/* 区切り線 */}
        <div className="w-5 h-px bg-gray-900 mb-2" />

        {/* クライアント + 受賞 */}
        <p className="text-[10px] text-gray-500 leading-snug line-clamp-2">
          <span className="font-bold text-gray-700">{c.client}</span>
          {c.client && c.agency ? " / " : ""}
          {c.agency}
        </p>

        {/* ハッシュタグ（逆引き導線。最大4つ） */}
        {(c.tags ?? []).length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5">
            {(c.tags ?? []).slice(0, 4).map((t) => (
              <span key={t} className="text-[9px] tracking-wider text-gray-400">
                #{tagLabel(t)}
              </span>
            ))}
          </p>
        )}
      </Link>

      {/* 年・受賞バッジ */}
      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0">
          {level ? (
            <span
              className={`text-[9px] font-black tracking-[0.15em] leading-none px-1.5 py-1 ${level.color} ${level.bg}`}
            >
              {level.label}
            </span>
          ) : (
            <span className="text-[9px] tracking-widest text-gray-400 uppercase leading-none truncate">
              {c.award.split(" ").slice(0, 3).join(" ")}
            </span>
          )}
          {awardCount > 1 && (
            <span
              className="text-[9px] font-black leading-none px-1 py-1 border border-gray-900 text-gray-900 shrink-0"
              title={`${awardCount}部門で受賞`}
            >
              +{awardCount - 1}
            </span>
          )}
        </div>
        <span className="text-xs font-black text-gray-900 tabular-nums shrink-0">
          {c.year}
        </span>
      </div>

      {/* お気に入りボタン（画像に重ねる） */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(c.id);
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
