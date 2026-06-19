"use client";

import Link from "next/link";
import Image from "next/image";
import type { Case } from "@/lib/cases";

type Props = {
  c: Case;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
};

export default function CaseCard({ c, isFavorite, onToggleFavorite }: Props) {
  return (
    <div className="group relative">
      <Link href={`/cases/${c.id}`} className="block">
        <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
          <div className="relative aspect-video bg-gray-100 overflow-hidden">
            <Image
              src={c.thumbnail}
              alt={c.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-1 mb-2">
              {c.categories.slice(0, 2).map((cat) => (
                <span
                  key={cat}
                  className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium"
                >
                  {cat}
                </span>
              ))}
            </div>
            <h2 className="font-bold text-gray-900 text-sm leading-tight mb-1 line-clamp-2">
              {c.title}
            </h2>
            <p className="text-xs text-gray-500 line-clamp-2 mb-3">{c.summary}</p>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{c.agency}</span>
              <span>{c.year}</span>
            </div>
          </div>
        </div>
      </Link>

      {/* お気に入りボタン */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(c.id);
        }}
        aria-label={isFavorite ? "お気に入りを解除" : "お気に入りに追加"}
        className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 shadow-sm
          ${isFavorite
            ? "bg-yellow-400 text-white opacity-100"
            : "bg-white/80 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-yellow-400"
          }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill={isFavorite ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
          className="w-4 h-4"
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
