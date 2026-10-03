"use client";

import Link from "next/link";
import Image from "next/image";
import type { Exhibition } from "@/lib/exhibition";
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
};

export default function ExhibitionCard({
  e,
  today,
  isFavorite,
  onToggleFavorite,
  isTrashed = false,
  onToggleTrash,
  trashMode = false,
}: Props) {
  return (
    <div className="group relative flex flex-col bg-white" data-exhibition-id={e.id}>
      <Link href={`/exhibition/${e.slug}`} className="block relative aspect-square overflow-hidden bg-gray-100">
        <Image
          src={e.thumbnail}
          alt={e.title}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
      </Link>

      <Link href={`/exhibition/${e.slug}`} className="block flex-1 p-4 pb-3">
        <div className="flex items-start justify-between mb-3 gap-2">
          <span className="flex items-center gap-1.5">
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

        <h2 className="text-base font-black leading-tight text-gray-900 mb-2 tracking-tight">{e.title}</h2>
        {e.artists.length > 0 && (
          <p className="text-[11px] text-gray-600 leading-relaxed mb-2 line-clamp-2">{e.artists.join(" / ")}</p>
        )}

        <div className="w-5 h-px bg-gray-900 mb-2" />

        <p className="text-[10px] text-gray-500 leading-snug line-clamp-2">
          <span className="font-bold text-gray-700">{e.venue}</span>
          <span className="text-gray-400">
            {" "}
            / {e.prefecture}
            {e.city ? ` ${e.city}` : ""}
          </span>
        </p>

        {e.tags.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-0.5">
            {e.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] tracking-wider text-gray-400">
                #{t}
              </span>
            ))}
          </p>
        )}
      </Link>

      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-gray-700">{e.admission === "UNKNOWN" ? "入場料不明" : e.admission}</span>
        <span className="text-[11px] font-black text-gray-900 tabular-nums shrink-0">
          {formatPeriod(e.startDate, e.endDate)}
        </span>
      </div>

      <div className="absolute top-2 right-2 flex items-center gap-1">
        {onToggleTrash && (
          <button
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onToggleTrash(e.id);
            }}
            aria-label={trashMode ? "復元" : "ごみ箱に入れる"}
            className={`w-7 h-7 flex items-center justify-center transition-all duration-150
              ${trashMode
                ? "text-white/80 opacity-100 hover:text-emerald-300"
                : isTrashed
                  ? "text-red-400 opacity-100"
                  : "text-white/80 opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-300"
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
          className={`w-7 h-7 flex items-center justify-center transition-all duration-150
            ${isFavorite
              ? "text-yellow-400 opacity-100"
              : "text-white/80 opacity-0 [@media(hover:none)]:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-yellow-300"
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
