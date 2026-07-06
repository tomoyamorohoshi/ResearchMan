"use client";

import { useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import type { TechItem, TechType } from "@/lib/tech";
import TechCard from "./TechCard";
import TechPanel from "./TechPanel";
import { useFavorites } from "@/hooks/useFavorites";
import { useGraphViewTransition } from "@/hooks/useGraphViewTransition";
import { techGraphAdapter } from "@/lib/techGraphAdapter";
import type { Graph3DViewProps } from "./Graph3DView";

// 3d-force-graph/threeはwindow依存のためssr:false必須。トグルON時にのみチャンク取得される。
// Graph3DViewはジェネリック関数コンポーネントのため、dynamic()の型引数はこれを直接推論
// できない（GalleryClient.tsxと同じ理由・同じキャストパターン）
const Graph3DView = dynamic(() => import("./Graph3DView"), {
  ssr: false,
  loading: () => (
    <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
      Loading 3D view…
    </div>
  ),
}) as ComponentType<Graph3DViewProps<TechItem>>;

type Props = {
  items: TechItem[];
  types: TechType[];
  domains: string[];
  years: string[];
};

type SortOrder = "added" | "date";

export default function TechGalleryClient({ items, types, domains, years }: Props) {
  const [filters, setFilters] = useState({ domain: "", year: "", commercial: "" });
  const [tab, setTab] = useState<TechType | "">("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("added");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { favorites, toggle, mounted } = useFavorites();
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // 型タブ（Research/Prototype/Tool）— データに1件以上あるものだけ件数付きで表示
  const tabs = types
    .map((ty) => ({ type: ty, count: items.filter((t) => t.type === ty).length }))
    .filter((t) => t.count > 0);

  const filtered = items.filter((t) => {
    if (tab && t.type !== tab) return false;
    if (showFavoritesOnly && !favorites.has(t.id)) return false;
    if (filters.domain && !t.domains.includes(filters.domain)) return false;
    if (filters.year && t.year !== filters.year) return false;
    if (filters.commercial && t.license.commercial !== filters.commercial) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.point.toLowerCase().includes(q) ||
        t.org.toLowerCase().includes(q) ||
        t.domains.some((d) => d.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const sorted =
    sort === "date"
      ? [...filtered].sort((a, b) => b.date.localeCompare(a.date))
      : filtered;

  const { showGrid, showGraph, graphWrapRef, handleGraphReady } = useGraphViewTransition({
    items,
    sorted,
    adapter: techGraphAdapter,
    gridRef,
    headerRef,
  });

  const favoriteCount = mounted ? favorites.size : 0;
  const activeFilterCount = [filters.domain, filters.year, filters.commercial].filter(Boolean).length;

  return (
    <>
      {/* ── コントロールバー ── */}
      <div ref={headerRef} className="border-b border-gray-300 bg-[#eeece7] sticky top-0 z-10">
        {/* 型タブ */}
        {tabs.length > 0 && (
          <div className="border-b border-gray-200">
            <div
              className="max-w-[1600px] mx-auto px-4 flex items-stretch gap-1 overflow-x-auto"
              role="tablist"
              aria-label="技術タイプ"
            >
              <TabButton label="All" active={tab === ""} onClick={() => setTab("")} />
              {tabs.map((t) => (
                <TabButton
                  key={t.type}
                  label={t.type}
                  count={t.count}
                  active={tab === t.type}
                  onClick={() => setTab(tab === t.type ? "" : t.type)}
                />
              ))}
            </div>
          </div>
        )}
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
          {(["added", "date"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
                sort === s ? "text-gray-900" : "text-gray-400 hover:text-gray-900"
              }`}
            >
              {s === "added" ? "New" : "Date"}
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
            <FilterGroup label="Domain" options={domains} value={filters.domain} prefix="#"
              onSelect={(v) => setFilters((p) => ({ ...p, domain: p.domain === v ? "" : v }))} />
            <FilterGroup label="Year" options={years} value={filters.year}
              onSelect={(v) => setFilters((p) => ({ ...p, year: p.year === v ? "" : v }))} />
            <FilterGroup
              label="License"
              options={["ok", "conditional", "research-only", "paid"]}
              value={filters.commercial}
              format={(v) =>
                v === "ok" ? "商用OK" : v === "conditional" ? "条件付き" : v === "research-only" ? "研究用途のみ" : "有償"
              }
              onSelect={(v) => setFilters((p) => ({ ...p, commercial: p.commercial === v ? "" : v }))}
            />
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ domain: "", year: "", commercial: "" })}
                className="text-[10px] tracking-widest uppercase text-gray-400 hover:text-gray-900 self-center"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {showGrid && (
        <>
          {/* ── グリッド ── */}
          <div className="max-w-[1600px] mx-auto">
            <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-gray-300">
              {sorted.map((t) => (
                <TechCard
                  key={t.id}
                  t={t}
                  isFavorite={mounted && favorites.has(t.id)}
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
      )}
      {showGraph && (
        <div ref={graphWrapRef}>
          <Graph3DView
            items={sorted}
            adapter={techGraphAdapter}
            renderPanel={(t, onClose) => <TechPanel t={t} onClose={onClose} />}
            onReady={handleGraphReady}
          />
        </div>
      )}
    </>
  );
}

function TabButton({
  label, count, active, onClick,
}: {
  label: string; count?: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative shrink-0 px-3 py-2.5 text-[10px] tracking-[0.15em] uppercase font-bold transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
        active
          ? "text-gray-900 border-gray-900"
          : "text-gray-400 border-transparent hover:text-gray-700"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className="text-[9px] text-gray-400 tabular-nums font-normal">{count}</span>
      )}
    </button>
  );
}

function FilterGroup({
  label, options, value, onSelect, prefix = "", format, limit = 12,
}: {
  label: string; options: string[]; value: string; onSelect: (v: string) => void;
  prefix?: string; format?: (v: string) => string; limit?: number;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[9px] tracking-[0.25em] uppercase text-gray-400 font-bold w-14 shrink-0">{label}</span>
      {options.slice(0, limit).map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`text-[9px] tracking-wider uppercase px-2 py-0.5 border transition-colors ${
            value === opt
              ? "border-gray-900 text-gray-900 font-bold"
              : "border-gray-300 text-gray-400 hover:border-gray-600 hover:text-gray-700"
          }`}
        >
          {prefix}{format ? format(opt) : opt}
        </button>
      ))}
    </div>
  );
}
