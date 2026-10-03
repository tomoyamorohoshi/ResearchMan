"use client";

import { useEffect, useMemo, useState } from "react";
import type { Exhibition } from "@/lib/exhibition";
import { sortExhibitions, visibleExhibitions } from "@/lib/exhibition";
import { todayJst } from "../../scripts/lib/exhibition-status.mjs";
import ExhibitionCard from "./ExhibitionCard";
import { useFavorites } from "@/hooks/useFavorites";
import { useTrash } from "@/hooks/useTrash";

type Props = {
  // サーバが initialToday で ended を除外済みの一覧（終了済みは HTML に載せない）
  items: Exhibition[];
  initialToday: string;
  // タグ語彙（表示順の基準）
  tagVocabulary: string[];
};

type StatusFilter = "" | "ongoing" | "upcoming";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "ongoing", label: "開催中" },
  { value: "upcoming", label: "開催前" },
];

export default function ExhibitionGalleryClient({ items, initialToday, tagVocabulary }: Props) {
  // 初期描画はサーバ計算の today（hydration 一致）。mount 後に実際の今日(JST)で再計算し、
  // ビルド/ISR 後に日付が進んでいても ended を非表示にする（SPEC §3.2 / §13）
  const [today, setToday] = useState(initialToday);
  const [pref, setPref] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTrashOnly, setShowTrashOnly] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const { favorites, toggle, mounted } = useFavorites();
  const { trashed, toggle: toggleTrash, mounted: trashMounted } = useTrash();

  useEffect(() => {
    // hydration 後にだけ実時刻/URLを反映する必要がある（SSR一致のため初期値では読めない）。意図的な mount 時 setState
    /* eslint-disable react-hooks/set-state-in-effect */
    setToday(todayJst());
    // URL クエリからフィルタを復元（pref / tag / status）。初期描画は SSR と一致させるため mount 後に反映
    const q = new URLSearchParams(window.location.search);
    setPref(q.get("pref") ?? "");
    setTag(q.get("tag") ?? "");
    const s = q.get("status");
    setStatus(s === "ongoing" || s === "upcoming" ? s : "");
    setUrlReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const q = new URLSearchParams(window.location.search);
    const set = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k));
    set("pref", pref);
    set("tag", tag);
    set("status", status);
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [pref, tag, status, urlReady]);

  const visible = useMemo(
    () => sortExhibitions(visibleExhibitions(items, today), today),
    [items, today],
  );

  // 都道府県・タグはデータに登場するものだけ
  const prefectures = useMemo(
    () => [...new Set(visible.map((e) => e.prefecture))].sort((a, b) => a.localeCompare(b, "ja")),
    [visible],
  );
  const tags = useMemo(() => {
    const present = new Set(visible.flatMap((e) => e.tags));
    return tagVocabulary.filter((t) => present.has(t));
  }, [visible, tagVocabulary]);

  const filtered = visible.filter((e) => {
    if (showTrashOnly) {
      if (!trashed.has(e.id)) return false;
    } else if (trashed.has(e.id)) {
      return false;
    }
    if (showFavoritesOnly && !favorites.has(e.id)) return false;
    if (pref && e.prefecture !== pref) return false;
    if (tag && !e.tags.includes(tag)) return false;
    if (status && e.status !== status) return false;
    return true;
  });

  const favoriteCount = mounted ? [...favorites].filter((id) => !trashed.has(id)).length : 0;
  const trashCount = trashMounted ? trashed.size : 0;
  const hasFilter = Boolean(pref || tag || status);

  return (
    <>
      <div className="border-b border-gray-300 bg-[#eeece7] sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-x-6 gap-y-2 flex-wrap">
          <FilterGroup
            label="状態"
            options={STATUS_OPTIONS.map((o) => o.value)}
            value={status}
            format={(v) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v}
            onSelect={(v) => setStatus(v as StatusFilter)}
          />
          {prefectures.length > 0 && (
            <FilterGroup label="都道府県" options={prefectures} value={pref} onSelect={(v) => setPref(pref === v ? "" : v)} />
          )}
          {tags.length > 0 && (
            <FilterGroup label="タグ" options={tags} value={tag} prefix="#" onSelect={(v) => setTag(tag === v ? "" : v)} />
          )}
          {hasFilter && (
            <button
              onClick={() => {
                setPref("");
                setTag("");
                setStatus("");
              }}
              className="text-[10px] tracking-widest uppercase text-gray-400 hover:text-gray-900"
            >
              Clear all
            </button>
          )}

          <span className="text-gray-300">|</span>

          <button
            onClick={() =>
              setShowFavoritesOnly((v) => {
                const next = !v;
                if (next) setShowTrashOnly(false);
                return next;
              })
            }
            aria-pressed={showFavoritesOnly}
            className={`flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
              showFavoritesOnly ? "text-yellow-500" : "text-gray-400 hover:text-gray-900"
            }`}
          >
            <svg viewBox="0 0 24 24" fill={showFavoritesOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.5} className="w-3 h-3" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            Saved{favoriteCount > 0 ? ` ${favoriteCount}` : ""}
          </button>

          <button
            onClick={() =>
              setShowTrashOnly((v) => {
                const next = !v;
                if (next) setShowFavoritesOnly(false);
                return next;
              })
            }
            aria-pressed={showTrashOnly}
            className={`flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase font-bold transition-colors ${
              showTrashOnly ? "text-red-500" : "text-gray-400 hover:text-gray-900"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.867 12.142A2 2 0 0115.138 21H8.862a2 2 0 01-1.995-1.858L6 7z" />
            </svg>
            Trash{trashCount > 0 ? ` ${trashCount}` : ""}
          </button>

          <span className="ml-auto text-[10px] text-gray-400 tabular-nums tracking-wider" data-exhibition-count>
            {filtered.length} items
          </span>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-gray-300">
          {filtered.map((e) => (
            <ExhibitionCard
              key={e.id}
              e={e}
              today={today}
              isFavorite={mounted && favorites.has(e.id)}
              onToggleFavorite={toggle}
              isTrashed={trashMounted && trashed.has(e.id)}
              onToggleTrash={toggleTrash}
              trashMode={showTrashOnly}
            />
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-32 px-4 text-[11px] tracking-[0.2em] text-gray-400" data-exhibition-empty>
          {showTrashOnly
            ? "ごみ箱は空です"
            : showFavoritesOnly
              ? "お気に入りはまだありません"
              : visible.length === 0
                ? "開催中・開催前の展覧会はありません"
                : "条件に合う展覧会はありません"}
        </div>
      )}
    </>
  );
}

function FilterGroup({
  label, options, value, onSelect, prefix = "", format,
}: {
  label: string; options: string[]; value: string; onSelect: (v: string) => void;
  prefix?: string; format?: (v: string) => string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={label}>
      <span className="text-[9px] tracking-[0.25em] text-gray-400 font-bold shrink-0">{label}</span>
      {options.map((opt) => (
        <button
          key={opt || "all"}
          onClick={() => onSelect(opt)}
          aria-pressed={value === opt}
          className={`text-[10px] tracking-wider px-2 py-0.5 border transition-colors ${
            value === opt
              ? "border-gray-900 text-gray-900 font-bold"
              : "border-gray-300 text-gray-500 hover:border-gray-600 hover:text-gray-700"
          }`}
        >
          {prefix}{format ? format(opt) : opt}
        </button>
      ))}
    </div>
  );
}
