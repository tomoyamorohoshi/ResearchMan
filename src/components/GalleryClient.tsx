"use client";

import { useState } from "react";
import type { Case } from "@/lib/cases";
import CaseCard from "./CaseCard";
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
  const [showFilters, setShowFilters] = useState(false);
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
  const activeFilterCount = [filters.category, filters.year, filters.region].filter(Boolean).length;

  return (
    <>
      {/* ── コントロールバー ── */}
      <div className="border-b border-gray-300 bg-[#eeece7] sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          {/* 検索 */}
          <input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-36 max-w-xs bg-transparent border-b border-gray-400 pb-0.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 tracking-wide"
          />

          {/* フィルタートグル */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
              showFilters || activeFilterCount > 0 ? "text-gray-900" : "text-gray-400 hover:text-gray-900"
            }`}
          >
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>

          <span className="text-gray-300">|</span>

          {/* ソート */}
          {(["added", "year"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
                sort === s ? "text-gray-900" : "text-gray-400 hover:text-gray-900"
              }`}
            >
              {s === "added" ? "New" : "Year"}
            </button>
          ))}

          <span className="text-gray-300">|</span>

          {/* お気に入り */}
          <button
            onClick={() => setShowFavoritesOnly((v) => !v)}
            className={`flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
              showFavoritesOnly ? "text-yellow-500" : "text-gray-400 hover:text-gray-900"
            }`}
          >
            <svg viewBox="0 0 24 24" fill={showFavoritesOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            Saved{favoriteCount > 0 ? ` ${favoriteCount}` : ""}
          </button>

          <span className="ml-auto text-[10px] text-gray-400 tabular-nums tracking-wider">
            {sorted.length} items
          </span>
        </div>

        {/* 展開フィルターパネル */}
        {showFilters && (
          <div className="border-t border-gray-200 max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap gap-x-8 gap-y-2">
            <FilterGroup label="Category" options={categories} value={filters.category}
              onSelect={(v) => setFilters((p) => ({ ...p, category: p.category === v ? "" : v }))} />
            <FilterGroup label="Year" options={years} value={filters.year}
              onSelect={(v) => setFilters((p) => ({ ...p, year: p.year === v ? "" : v }))} />
            <FilterGroup label="Region" options={regions} value={filters.region}
              onSelect={(v) => setFilters((p) => ({ ...p, region: p.region === v ? "" : v }))} />
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ category: "", year: "", region: "" })}
                className="text-[10px] tracking-widest uppercase text-gray-400 hover:text-gray-900 self-center"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── グリッド ── */}
      <div className="max-w-[1600px] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-gray-300">
          {sorted.map((c) => (
            <CaseCard
              key={c.id}
              c={c}
              isFavorite={mounted && favorites.has(c.id)}
              onToggleFavorite={toggle}
            />
          ))}
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
          {showFavoritesOnly ? "No saved items yet" : "No results found"}
        </div>
      )}
    </>
  );
}

function FilterGroup({
  label, options, value, onSelect,
}: {
  label: string; options: string[]; value: string; onSelect: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[9px] tracking-[0.25em] uppercase text-gray-400 font-bold w-14 shrink-0">{label}</span>
      {options.slice(0, 12).map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border transition-colors ${
            value === opt
              ? "border-gray-900 text-gray-900 font-bold"
              : "border-gray-300 text-gray-400 hover:border-gray-600 hover:text-gray-700"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
