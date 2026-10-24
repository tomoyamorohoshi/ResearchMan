"use client";

import Link from "next/link";
import Image from "next/image";
import type { Exhibition, ExhibitionLayout } from "@/lib/exhibition";
import ExhibitionBadge, { formatPeriod } from "./ExhibitionBadge";

type Props = {
  e: Exhibition;
  today: string;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  isTrashed?: boolean;
  onToggleTrash?: (id: string) => void;
  // ごみ箱ビュー中（ボタンは「復元」になる）
  trashMode?: boolean;
  // 「行きたい」（Visitタブ用。いいね・ごみ箱とは独立）
  isWantToGo?: boolean;
  onToggleWantToGo?: (id: string) => void;
  // スマホ幅(sm未満)の並べ方。sm以上は常に従来のカード
  layout?: ExhibitionLayout;
};

export default function ExhibitionCard({
  e,
  today,
  isFavorite,
  onToggleFavorite,
  isTrashed = false,
  onToggleTrash,
  trashMode = false,
  isWantToGo = false,
  onToggleWantToGo,
  layout = "stack",
}: Props) {
  const row = layout === "row";
  const compact = layout === "compact";
  // 行リストのアイコンは白背景上に置くので sm 未満だけ暗色にする
  const idleIcon = row ? "text-gray-500 sm:text-white/80" : "text-white/80";
  const btnSize = "w-10 h-10 sm:w-7 sm:h-7";
  return (
    <div className={`group relative flex bg-white ${row ? "flex-row sm:flex-col" : "flex-col"}`} data-exhibition-id={e.id}>
      <Link
        href={`/exhibition/${e.slug}`}
        className={`block relative overflow-hidden bg-gray-100 ${
          row ? "w-24 h-24 shrink-0 sm:w-auto sm:h-auto sm:aspect-square" : layout === "stack" ? "aspect-[16/10] sm:aspect-square" : "aspect-square"
        }`}
      >
        <Image
          src={e.thumbnail}
          alt={e.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
      </Link>

      <div className="flex flex-col flex-1 min-w-0">
      <Link
        href={`/exhibition/${e.slug}`}
        className={`block flex-1 min-w-0 ${row ? "p-3 pb-1" : compact ? "p-2.5 pb-1.5" : "p-4 pb-3"} sm:p-4 sm:pb-3`}
      >
        <div className={`flex items-start justify-between mb-3 gap-2 ${row ? "mb-1.5" : compact ? "mb-2" : ""} sm:mb-3`}>
          <span className={`items-center gap-1.5 ${row || compact ? "hidden sm:flex" : "flex"}`}>
            <span
              className="text-[11px] font-black tracking-[0.2em] uppercase text-gray-900 leading-none"
              style={{ fontVariant: "all-small-caps" }}
            >
              RM
            </span>
            <span className="text-[8px] font-black tracking-[0.18em] uppercase text-rose-700 leading-none">
              Exhibition
            </span>
          </span>
          <ExhibitionBadge e={e} today={today} />
        </div>

        <h2
          className={`font-black leading-tight text-gray-900 mb-2 tracking-tight sm:text-base sm:line-clamp-none ${
            row ? "text-sm line-clamp-2 mb-1" : compact ? "text-[13px] line-clamp-3 mb-1" : "text-base"
          }`}
        >{e.title}</h2>
        {e.artists.length > 0 && (
          <p className={`text-[11px] text-gray-600 leading-relaxed sm:mb-2 sm:line-clamp-2 ${row ? "hidden sm:block" : compact ? "line-clamp-1 mb-1" : "line-clamp-2 mb-2"}`}>{e.artists.join(" / ")}</p>
        )}

        <div className={`w-5 h-px bg-gray-900 mb-2 ${row ? "hidden sm:block" : compact ? "hidden sm:block" : ""}`} />

        <p className={`text-[10px] text-gray-500 leading-snug line-clamp-2 ${compact ? "text-[9px] sm:text-[10px]" : ""}`}>
          <span className="font-bold text-gray-700">{e.venue}</span>
          <span className="text-gray-400">
            {" "}
            / {e.prefecture}
            {e.city ? ` ${e.city}` : ""}
          </span>
        </p>

        {e.tags.length > 0 && (
          <p className={`mt-1.5 flex-wrap gap-x-1.5 gap-y-0.5 ${row ? "hidden sm:flex" : "flex"}`}>
            {e.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] tracking-wider text-gray-400">
                #{t}
              </span>
            ))}
          </p>
        )}
      </Link>

      <div
        className={`flex justify-between gap-2 sm:px-4 sm:pb-3 sm:flex-row sm:items-center ${
          row
            ? "px-3 pb-2 flex-col items-start gap-0.5 pr-[7.5rem]"
            : compact
              ? "px-2.5 pb-2 flex-col items-start gap-0.5"
              : "px-4 pb-3 items-center"
        }`}
      >
        <span className="text-[10px] font-bold text-gray-700 min-w-0 line-clamp-2 sm:line-clamp-none">{e.admission === "UNKNOWN" ? "入場料不明" : e.admission}</span>
        <span className={`font-black text-gray-900 tabular-nums shrink-0 whitespace-nowrap sm:text-[11px] ${compact || row ? "text-[10px]" : "text-[11px]"}`}>
          {formatPeriod(e.startDate, e.endDate)}
        </span>
      </div>
      </div>

      <div className={`absolute flex items-center gap-1 sm:top-2 sm:right-2 sm:bottom-auto ${row ? "bottom-1 right-1" : "top-1 right-1"}`}>
        {onToggleWantToGo && (
          <button
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onToggleWantToGo(e.id);
            }}
            aria-label="行きたい"
            aria-pressed={isWantToGo}
            className={`${btnSize} flex items-center justify-center transition-all duration-150
              ${isWantToGo
                ? "text-sky-400 opacity-100"
                : `${idleIcon} opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-sky-300`
              }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill={isWantToGo ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4 drop-shadow"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 21V4m0 0h11l-2 4 2 4H5" />
            </svg>
          </button>
        )}
        {onToggleTrash && (
          <button
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onToggleTrash(e.id);
            }}
            aria-label={trashMode ? "復元" : "ごみ箱に入れる"}
            className={`${btnSize} flex items-center justify-center transition-all duration-150
              ${trashMode
                ? `${idleIcon} opacity-100 hover:text-emerald-300`
                : isTrashed
                  ? "text-red-400 opacity-100"
                  : `${idleIcon} opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-300`
              }`}
          >
            {trashMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 drop-shadow">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L4 10m0 0l5-5m-5 5h11a4 4 0 014 4v1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 drop-shadow">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.867 12.142A2 2 0 0115.138 21H8.862a2 2 0 01-1.995-1.858L6 7z"
                />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onToggleFavorite(e.id);
          }}
          aria-label={isFavorite ? "お気に入りを解除" : "お気に入りに追加"}
          className={`${btnSize} flex items-center justify-center transition-all duration-150
            ${isFavorite
              ? "text-yellow-400 opacity-100"
              : `${idleIcon} opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-yellow-300`
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
    </div>
  );
}
