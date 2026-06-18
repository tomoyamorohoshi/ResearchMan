"use client";

import { useState } from "react";
import type { Case } from "@/lib/cases";
import CaseCard from "./CaseCard";
import FilterBar from "./FilterBar";

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

  const filtered = cases.filter((c) => {
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
    : filtered; // "added" = JSON順をそのまま維持

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

      <FilterBar
        categories={categories}
        years={years}
        regions={regions}
        selected={filters}
        onChange={(key, value) =>
          setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }))
        }
      />

      <p className="text-sm text-gray-400 mb-6">{sorted.length} 件</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sorted.map((c) => (
          <CaseCard key={c.id} c={c} />
        ))}
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          条件に一致する事例が見つかりませんでした
        </div>
      )}
    </>
  );
}
