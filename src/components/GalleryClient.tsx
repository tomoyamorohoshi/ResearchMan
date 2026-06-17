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

export default function GalleryClient({ cases, categories, years, regions }: Props) {
  const [filters, setFilters] = useState({ category: "", year: "", region: "" });
  const [query, setQuery] = useState("");

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

  return (
    <>
      <div className="mb-6">
        <input
          type="text"
          placeholder="タイトル・クライアント・エージェンシーで検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md px-4 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        />
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

      <p className="text-sm text-gray-400 mb-6">{filtered.length} 件</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((c) => (
          <CaseCard key={c.id} c={c} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          条件に一致する事例が見つかりませんでした
        </div>
      )}
    </>
  );
}
