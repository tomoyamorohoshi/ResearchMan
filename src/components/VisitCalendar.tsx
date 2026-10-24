"use client";

import { useMemo, useState } from "react";
import type { Exhibition } from "@/lib/exhibition";
import {
  endingOn,
  isEndingSoon,
  isUpcoming,
  rangeCalendar,
  rangeLabel,
  visitNo,
  weekSegments,
} from "@/lib/visit";
import { VisitBadges } from "./VisitList";

// 帯1段の高さ(px)。帯は h-5(20px)＋隙間2px
const LANE_H = 22;
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
// 日付行の高さ(px)。今日を含む週だけ「今日」ラベルの1行ぶん広げる
const HEAD = 22;
const HEAD_TODAY = 34;

// 今日の目印: 淡い黄色のマス＋「今日」（黄色はこの1か所だけ。2026-10-25 オーナー選定）

type Props = {
  active: Exhibition[];
  today: string;
  dateFilter: string | null;
  onDateFilter: (d: string | null) => void;
  highlightIds: Set<string>;
  unlocatedIds: Set<string>;
  onSelect: (e: Exhibition) => void;
};

// 今日から6週のカレンダー（過去は出さない）。日付を押すとその日に開いている展覧会だけ地図に絞る。
// 展示の識別は色でなく番号（一覧と同じ並び順）。色は白黒グレー＋終了間近の赤のみ。
// 表示は名前入り横帯（週をまたいで連続）。
export default function VisitCalendar({ active, today, dateFilter, onDateFilter, highlightIds, unlocatedIds, onSelect }: Props) {
  const [page, setPage] = useState(0); // 0 = 今日を含む週から6週。過去へは戻れない
  const cells = useMemo(() => rangeCalendar(today, page, active), [today, page, active]);
  const numberOf = useMemo(() => new Map(active.map((e, i) => [e.id, visitNo(i)] as const)), [active]);
  const byId = useMemo(() => new Map(active.map((e) => [e.id, e] as const)), [active]);

  const tone = (e: Exhibition) => (isEndingSoon(e, today) ? "urgent" : isUpcoming(e, today) ? "upcoming" : "open");
  const dim = (id: string) => (highlightIds.size > 0 && !highlightIds.has(id) ? 0.35 : 1);

  type Cell = (typeof cells)[number];
  const dayLabel = (c: Cell) => {
    const base = `${Number(c.date.slice(5, 7))}月${c.day}日`;
    if (c.past) return `${base} 過去`;
    const ends = endingOn(active, c.date).length;
    return `${c.date === today ? "今日 " : ""}${base} ${c.ids.length}件${ends > 0 ? "、この日が最終日の展示あり" : ""}`;
  };

  // 選択枠・今日の枠は帯(z-20)より手前の overlay(z-30) で描くので、セル自体は z-index を持たない
  const cellClass = (c: Cell) =>
    `relative flex flex-col items-stretch justify-start min-w-0 text-left border-r border-b border-gray-300 ${
      c.past ? "bg-[#eeece7] text-gray-300 cursor-default" : c.date === today ? "bg-[#fff3b0] hover:opacity-90" : "bg-white hover:bg-gray-50"
    }`;

  const dayNum = (c: Cell) => {
    const isToday = c.date === today;
    const text = c.showMonth ? `${Number(c.date.slice(5, 7))}/${c.day}` : c.day;
    return (
      <span
        className={`inline-block min-w-[18px] px-1 text-[10px] tabular-nums leading-[18px] text-center ${
          c.past ? "" : isToday ? "font-black text-gray-900" : "font-bold text-gray-700"
        }`}
      >
        {text}
      </span>
    );
  };

  const todayLabel = (
    <span aria-hidden="true" className={`block px-1 text-[9px] font-black leading-[12px] tracking-wider text-gray-900`}>
      今日
    </span>
  );

  const navBtn = "min-h-[40px] min-w-[56px] px-3 text-[11px] font-black tracking-wider border border-gray-300 bg-white text-gray-900 hover:border-gray-900";

  return (
    <section aria-labelledby="visit-cal-h">
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 leading-none mb-1">Calendar</p>
          <h2 id="visit-cal-h" className="text-xl font-black tracking-tight text-gray-900 tabular-nums leading-none">
            {rangeLabel(cells)}
          </h2>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="前の6週間"
            disabled={page === 0}
            aria-disabled={page === 0}
            onClick={() => setPage((v) => Math.max(0, v - 1))}
            className={`${navBtn} disabled:opacity-30 disabled:hover:border-gray-300 disabled:cursor-default`}
          >
            ‹ 前
          </button>
          <button type="button" aria-label="次の6週間" onClick={() => setPage((v) => v + 1)} className={navBtn}>
            次 ›
          </button>
        </div>
      </div>

      <div className="border-t border-l border-gray-300">
        <div className="grid grid-cols-7 text-center text-[10px] font-black tracking-wider text-gray-500" aria-hidden="true">
          {WEEK.map((w) => (
            <span key={w} className="py-1 border-r border-b border-gray-300 bg-[#eeece7]">{w}</span>
          ))}
        </div>

        {/* 週ごとの行に、週をまたぐ連続した横帯を重ねる */}
        {weekSegments(cells, active).map((segs, w) => {
          const n = Math.max(1, ...segs.map((s) => s.lane + 1));
          const todayCol = cells.slice(w * 7, w * 7 + 7).findIndex((c) => c.date === today);
          const filterCol = cells.slice(w * 7, w * 7 + 7).findIndex((c) => c.date === dateFilter);
          const head = todayCol >= 0 ? HEAD_TODAY : HEAD;
          const h = head + n * LANE_H + 4;
          const overlay = (col: number, shadow: string, key: string) => (
            <span
              key={key}
              aria-hidden="true"
              className="absolute z-30 pointer-events-none top-0 bottom-0"
              style={{ left: `${(col / 7) * 100}%`, width: `${100 / 7}%`, boxShadow: shadow }}
            />
          );
          return (
            <div key={w} className="relative grid grid-cols-7" style={{ minHeight: h }}>
              {cells.slice(w * 7, w * 7 + 7).map((c) => (
                <button
                  key={c.date}
                  type="button"
                  disabled={c.past}
                  aria-pressed={c.past ? undefined : dateFilter === c.date}
                  aria-label={dayLabel(c)}
                  onClick={() => onDateFilter(dateFilter === c.date ? null : c.date)}
                  className={`${cellClass(c)} pt-0.5 px-0.5`}
                >
                  {dayNum(c)}
                  {c.date === today && todayLabel}
                </button>
              ))}
              {filterCol >= 0 && overlay(filterCol, "inset 0 0 0 2px #111827", "filter-ring")}
              {segs.map((s) => {
                const e = byId.get(s.id)!;
                const t = tone(e);
                return (
                  <span
                    key={s.id}
                    aria-hidden="true"
                    className={`absolute z-20 pointer-events-none overflow-hidden whitespace-nowrap text-ellipsis text-[11px] font-black leading-5 h-5 px-1 tabular-nums ${
                      t === "urgent"
                        ? "bg-red-600 text-white"
                        : t === "upcoming"
                          ? "bg-white text-gray-900 border border-gray-900 leading-[18px]"
                          : "bg-gray-900 text-white"
                    }`}
                    style={{
                      left: `calc(${(s.col / 7) * 100}% + 1px)`,
                      width: `calc(${(s.span / 7) * 100}% - 2px)`,
                      top: head + s.lane * LANE_H,
                      opacity: dim(s.id),
                    }}
                  >
                    {numberOf.get(s.id)}
                    {s.span >= 2 && ` ${e.title}`}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tracking-wider text-gray-500" aria-hidden="true">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2 bg-gray-900" />開催中</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2 border border-gray-900 bg-white" />開催前</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2 bg-red-600" />終了間近</span>
      </div>

      <ol className="mt-2 border-t border-gray-300" aria-label="展覧会の番号">
        {active.map((e, i) => (
          <li key={e.id} className="border-b border-gray-200">
            <button type="button" onClick={() => onSelect(e)} className="flex w-full items-center gap-2 min-h-[40px] text-left text-[12px] hover:bg-gray-50">
              <span className="shrink-0 w-6 text-[10px] font-black tabular-nums tracking-wider text-gray-400">{visitNo(i)}</span>
              <span className="min-w-0 truncate font-black text-gray-900">{e.title}</span>
              <span className="ml-auto flex shrink-0 gap-1">
                <VisitBadges e={e} today={today} unlocated={unlocatedIds.has(e.id)} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
