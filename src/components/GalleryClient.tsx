"use client";

import { useState } from "react";
import type { Case } from "@/lib/cases";
import CaseCard from "./CaseCard";
import FilterBar from "./FilterBar";
import { useFavorites } from "@/hooks/useFavorites";

type Props = {
  cases: Case[];
  categories: string[];
  years: string[];
  regions: string[];
};

type SortOrder = "added" | "year";

export default function GalleryClient({ cases, categories, years, regions }: Props) {
  const [filters, setFilters] = useState({ category: "", year: "", region: "" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("added");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const { favorites, toggle, mounted } = useFavorites();

  const filtered = cases.filter((c) => {
    if (showFavoritesOnly && !favorites.has(c.id)) return false;
    if (filters.category && !c.categories.includes(filters.category)) return false;
    if (filters.year && c.year !== filters.year) return false;
    if (filters.region && !c.regions.includes(filters.region)) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.client.toLowerCase().includes(q) ||
        c.agency.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const sorted = sort === "year"
    ? [...filtered].sort((a, b) => parseInt(b.year) - parseInt(a.year))
    : filtered;

  const favoriteCount = mounted ? favorites.size : 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="タイトル・クライアント・エージェンシーで検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-48 max-w-md px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-400 mr-1">並び順:</span>
          {(["added", "year"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                sort === s
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {s === "added" ? "更新順" : "年代順"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <FilterBar
          categories={categories}
          years={years}
          regions={regions}
          selected={filters}
          onChange={(key, value) =>
            setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }))
          }
        />
        {/* お気に入りフィルター */}
        <button
          onClick={() => setShowFavoritesOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all shrink-0 ${
            showFavoritesOnly
              ? "bg-yellow-400 text-white border-yellow-400"
              : "bg-white text-gray-600 border-gray-200 hover:border-yellow-400 hover:text-yellow-500"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill={showFavoritesOnly ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={2}
            className="w-3.5 h-3.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
            />
          </svg>
          お気に入り
          {favoriteCount > 0 && (
            <span className={`rounded-full px-1.5 text-[10px] font-bold ${
              showFavoritesOnly ? "bg-white/30 text-white" : "bg-yellow-100 text-yellow-600"
            }`}>
              {favoriteCount}
            </span>
          )}
        </button>
      </div>

      <p className="text-sm text-gray-400 mb-6">{sorted.length} 件</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sorted.map((c) => (
          <CaseCard
            key={c.id}
            c={c}
            isFavorite={mounted && favorites.has(c.id)}
            onToggleFavorite={toggle}
          />
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          {showFavoritesOnly
            ? "お気に入りはまだありません。カードの★ボタンで追加できます。"
            : "条件に一致する事例が見つかりませんでした"}
        </div>
      )}
    </>
  );
}
