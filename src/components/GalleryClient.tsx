"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Case } from "@/lib/cases";
import CaseCard from "./CaseCard";
import { useFavorites } from "@/hooks/useFavorites";
import { compareByAward } from "@/lib/awardLevel";
import { compareByAwardForCollection, type OrgKey } from "@/lib/awards";
import { tabSources, getSourceKind } from "@/lib/researchSources";
import { TAG_AXES, tagAxis, tagLabel } from "@/lib/tags";
import { useViewMode } from "./ViewModeContext";
import { blowAwayCards, landCards } from "@/lib/viewTransition";

// 3d-force-graph/threeはwindow依存のためssr:false必須。トグルON時にのみチャンク取得される
const Graph3DView = dynamic(() => import("./Graph3DView"), {
  ssr: false,
  loading: () => (
    <div className="text-center py-32 text-[10px] tracking-[0.3em] uppercase text-gray-400">
      Loading 3D view…
    </div>
  ),
});

type Props = {
  cases: Case[];
  categories: string[];
  years: string[];
  regions: string[];
  sources?: string[];
  tags?: string[];
  defaultSort?: SortOrder;
  // 指定時、award系ソート・バッジは「その部門でのレベル」を使う（部門ページ用）
  awardContext?: { org: OrgKey; year: string; category: string };
};

type SortOrder = "added" | "year" | "award";

// "toGraph"/"toGrid" はトランジション中の一時状態（表示自体はgrid側と同じJSXを使う）。
// mode(ViewModeContext)は「目標状態」のまま変えず、phaseだけがこの間接的な状態を持つ
type DisplayPhase = "grid" | "toGraph" | "graph" | "toGrid";

export default function GalleryClient({ cases, categories, years, regions, sources = [], tags = [], defaultSort = "added", awardContext }: Props) {
  const [filters, setFilters] = useState({ category: "", year: "", region: "", source: "", tag: "" });
  const [tab, setTab] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>(defaultSort);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { favorites, toggle, mounted } = useFavorites();
  const { mode, setBusy } = useViewMode();
  const [phase, setPhase] = useState<DisplayPhase>(mode === "graph" ? "graph" : "grid");
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollYRef = useRef(0);
  const prevModeRef = useRef(mode);
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // mode（ON/OFFの目標状態）の変化を検知し、吹き飛び/帰還トランジションを開始する。
  // /awards・/technology等（ViewModeProvider不在＝modeが常にgrid固定）ではmodeが
  // 変化しないためこのeffectは初回以降一切作動せず、グリッドの挙動に影響しない。
  //
  // ON方向（グリッド→3D）は、この時点でまだ実グリッドがマウントされている
  // （phaseはまだ"grid"）ため、ここで直接gridRef.currentを読んで完結できる。
  // OFF方向（3D→グリッド）はphaseを"toGrid"にするところまでで、実際の着地アニメーションは
  // 下の別effect（phase依存）に委ねる。理由: setPhase後すぐrequestAnimationFrameを
  // 1回待つだけでは、Graph3DViewのアンマウント（_destructor内の475件のSprite/Texture
  // 解放）が重く、実グリッドDOMのコミットが単一のrAFより後にずれ込むことがあり、
  // gridRef.currentがまだnullのままアニメーションが無言でスキップされるバグを引き起こす
  // （実機Playwright検証で発見）。useEffect(..., [phase])はReactのコミット後にしか
  // 走らないため、この確認が要らず確実。
  useEffect(() => {
    if (mode === prevModeRef.current) return;
    prevModeRef.current = mode;

    if (mode === "graph") {
      let cancelled = false;
      async function run() {
        setBusy(true);
        setPhase("toGraph"); // 表示はgridと同じJSX（吹き飛びはオーバーレイのクローンで表現）
        scrollYRef.current = window.scrollY;
        const gridEl = gridRef.current;
        if (reduceMotion || !gridEl) {
          setPhase("graph");
        } else {
          const flying = blowAwayCards(gridEl); // クローンが独立して吹き飛ぶ（Reactツリー非依存）
          window.scrollTo({ top: 0, behavior: "instant" });
          setPhase("graph"); // Graph3DViewをマウント開始＝裏で3D用サムネのロードが始まる
          await flying;
        }
        if (!cancelled) setBusy(false);
      }
      run();
      return () => {
        cancelled = true;
      };
    }
    // 実グリッドDOMのコミットは下のeffectで検知する（ここではphaseを倒すだけ）
    function startToGrid() {
      setBusy(true);
      setPhase("toGrid");
    }
    startToGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // phaseが"toGrid"になった＝実グリッドDOM（gridRef）がコミット済みの状態でのみ発火。
  // ここで初めてスクロール復元と着地アニメーションを安全に実行できる
  useEffect(() => {
    if (phase !== "toGrid") return;
    let cancelled = false;
    async function run() {
      window.scrollTo({ top: scrollYRef.current, behavior: "instant" });
      const gridEl = gridRef.current;
      if (!reduceMotion && gridEl) {
        await landCards(gridEl);
      }
      if (!cancelled) {
        setPhase("grid");
        setBusy(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // タブ（リサーチオーダー／Radar）— データに1件以上あるものだけ件数付きで表示
  const tabs = tabSources
    .map((s) => ({
      ...s,
      count: cases.filter((c) => (c.sources ?? []).includes(s.tag)).length,
    }))
    .filter((s) => s.count > 0);

  // 「#」ハッシュタグフィルターはアワード系ソースのみ（タブと役割を分ける）
  const awardSources = sources.filter((s) => getSourceKind(s) === "award");

  const filtered = cases.filter((c) => {
    if (tab && !(c.sources ?? []).includes(tab)) return false;
    if (showFavoritesOnly && !favorites.has(c.id)) return false;
    if (filters.category && !c.categories.includes(filters.category)) return false;
    if (filters.year && c.year !== filters.year) return false;
    if (filters.region && !c.regions.includes(filters.region)) return false;
    if (filters.source && !(c.sources ?? []).includes(filters.source)) return false;
    if (filters.tag && !(c.tags ?? []).includes(filters.tag)) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.client.toLowerCase().includes(q) ||
        c.agency.toLowerCase().includes(q) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const sorted =
    sort === "year"
      ? [...filtered].sort((a, b) => parseInt(b.year) - parseInt(a.year))
      : sort === "award"
        ? [...filtered].sort(
            awardContext
              ? (a, b) => compareByAwardForCollection(a, b, awardContext.org, awardContext.year, awardContext.category)
              : compareByAward,
          )
        : filtered;

  const favoriteCount = mounted ? favorites.size : 0;
  const activeFilterCount = [filters.category, filters.year, filters.region, filters.source, filters.tag].filter(Boolean).length;

  return (
    <>
      {/* ── コントロールバー ── */}
      <div className="border-b border-gray-300 bg-[#eeece7] sticky top-0 z-10">
        {/* リサーチオーダー別タブ */}
        {tabs.length > 0 && (
          <div className="border-b border-gray-200">
            <div
              className="max-w-[1600px] mx-auto px-4 flex items-stretch gap-1 overflow-x-auto"
              role="tablist"
              aria-label="リサーチオーダー"
            >
              <TabButton label="All" active={tab === ""} onClick={() => setTab("")} />
              {tabs.map((t) => (
                <TabButton
                  key={t.tag}
                  label={t.label}
                  count={t.count}
                  radar={t.kind === "radar"}
                  active={tab === t.tag}
                  onClick={() => setTab(tab === t.tag ? "" : t.tag)}
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
          {(["added", "year", "award"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
                sort === s ? "text-gray-900" : "text-gray-400 hover:text-gray-900"
              }`}
            >
              {s === "added" ? "New" : s === "year" ? "Year" : "Award"}
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
            {awardSources.length > 0 && (
              <FilterGroup label="Source" options={awardSources} value={filters.source} prefix="#"
                onSelect={(v) => setFilters((p) => ({ ...p, source: p.source === v ? "" : v }))} />
            )}
            {/* ハッシュタグ（Tech/Form/Theme の3軸。表示は #キーワードのみ、値はフルパス） */}
            {TAG_AXES.map((axis) => {
              const axisTags = tags.filter((t) => tagAxis(t) === axis);
              if (axisTags.length === 0) return null;
              return (
                <FilterGroup key={axis} label={axis} options={axisTags} value={filters.tag}
                  prefix="#" format={tagLabel} limit={16}
                  onSelect={(v) => setFilters((p) => ({ ...p, tag: p.tag === v ? "" : v }))} />
              );
            })}
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ category: "", year: "", region: "", source: "", tag: "" })}
                className="text-[10px] tracking-widest uppercase text-gray-400 hover:text-gray-900 self-center"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {phase !== "graph" ? (
        <>
          {/* ── グリッド ── */}
          <div className="max-w-[1600px] mx-auto">
            <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-gray-300">
              {sorted.map((c) => (
                <CaseCard
                  key={c.id}
                  c={c}
                  isFavorite={mounted && favorites.has(c.id)}
                  onToggleFavorite={toggle}
                  awardContext={awardContext}
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
      ) : (
        <Graph3DView cases={sorted} />
      )}
    </>
  );
}

function TabButton({
  label, count, active, radar = false, onClick,
}: {
  label: string; count?: number; active: boolean; radar?: boolean; onClick: () => void;
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
      {radar && <span className="w-1 h-1 rounded-full bg-[#b08d2d]" aria-hidden="true" />}
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
