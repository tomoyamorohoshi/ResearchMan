"use client";

import { useMemo, useState } from "react";
import type { Exhibition } from "@/lib/exhibition";
import {
  endingOn,
  exhibitionsOpenOn,
  isEndingSoon,
  isUpcoming,
  monthCalendar,
  shiftMonth,
  visitNo,
  weekSegments,
  type CalStyle,
} from "@/lib/visit";
import { VisitBadges } from "./VisitList";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

type Props = {
  active: Exhibition[];
  today: string;
  dateFilter: string | null;
  onDateFilter: (d: string | null) => void;
  highlightIds: Set<string>;
  unlocatedIds: Set<string>;
  onSelect: (e: Exhibition) => void;
  calStyle: CalStyle;
};

// 月カレンダー。日付を押すとその日に開いている展覧会だけ地図に絞る。
// 展示の識別は色でなく番号（一覧と同じ並び順）。色は白黒グレー＋終了間近の赤のみ。
// 表示案は ?cal= で切替: lines(既定) / count / bands
export default function VisitCalendar({ active, today, dateFilter, onDateFilter, highlightIds, unlocatedIds, onSelect, calStyle }: Props) {
  const [ym, setYm] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const cells = useMemo(() => monthCalendar(ym.year, ym.month, active), [ym, active]);
  const numberOf = useMemo(() => new Map(active.map((e, i) => [e.id, visitNo(i)] as const)), [active]);
  const byId = useMemo(() => new Map(active.map((e) => [e.id, e] as const)), [active]);

  // この月に重なる展覧会だけを段(lane)に割り当て（月内で線が途切れず揃う）
  const monthIds = new Set(cells.flatMap((c) => c.ids));
  const lanes = active.filter((e) => monthIds.has(e.id));

  const tone = (e: Exhibition) => (isEndingSoon(e, today) ? "urgent" : isUpcoming(e, today) ? "upcoming" : "open");
  const dim = (id: string) => (highlightIds.size > 0 && !highlightIds.has(id) ? 0.35 : 1);

  const dayLabel = (c: { date: string; day: number; ids: string[] }) => {
    const ends = endingOn(active, c.date).length;
    return `${Number(c.date.slice(5, 7))}月${c.day}日 ${c.ids.length}件${ends > 0 ? "、この日が最終日の展示あり" : ""}`;
  };

  const cellClass = (c: { date: string; inMonth: boolean }) =>
    `relative flex flex-col items-stretch justify-start min-w-0 text-left border-r border-b border-gray-300 ${c.inMonth ? "bg-white" : "bg-[#eeece7] text-gray-300"} ${
      dateFilter === c.date ? "outline outline-2 -outline-offset-2 outline-gray-900 z-10" : "hover:bg-gray-50"
    }`;

  const dayNum = (c: { date: string; day: number; inMonth: boolean }) => {
    const isToday = c.date === today;
    return (
      <span
        className={`inline-block min-w-[18px] px-1 text-[10px] tabular-nums leading-[18px] text-center ${
          isToday ? "bg-gray-900 font-black text-white" : c.inMonth ? "font-bold text-gray-700" : ""
        }`}
      >
        {c.day}
      </span>
    );
  };

  const navBtn = "min-h-[40px] min-w-[56px] px-3 text-[11px] font-black tracking-wider border border-gray-300 bg-white text-gray-900 hover:border-gray-900";

  return (
    <section aria-labelledby="visit-cal-h">
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 leading-none mb-1">Calendar</p>
          <h2 id="visit-cal-h" className="text-xl font-black tracking-tight text-gray-900 tabular-nums leading-none">
            {ym.year}.{String(ym.month).padStart(2, "0")}
          </h2>
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label="前の月" onClick={() => setYm((v) => shiftMonth(v.year, v.month, -1))} className={navBtn}>
            ‹ 前月
          </button>
          <button type="button" aria-label="次の月" onClick={() => setYm((v) => shiftMonth(v.year, v.month, 1))} className={navBtn}>
            翌月 ›
          </button>
        </div>
      </div>

      <div className="border-t border-l border-gray-300">
        <div className="grid grid-cols-7 text-center text-[10px] font-black tracking-wider text-gray-500" aria-hidden="true">
          {WEEK.map((w) => (
            <span key={w} className="py-1 border-r border-b border-gray-300 bg-[#eeece7]">{w}</span>
          ))}
        </div>

        {calStyle === "bands" ? (
          // 案3: 週ごとの行に、週をまたぐ連続した横帯を重ねる
          weekSegments(cells, active).map((segs, w) => {
            const n = Math.max(1, ...segs.map((s) => s.lane + 1));
            const h = 22 + n * 18 + 4;
            return (
              <div key={w} className="relative grid grid-cols-7" style={{ minHeight: h }}>
                {cells.slice(w * 7, w * 7 + 7).map((c) => (
                  <button
                    key={c.date}
                    type="button"
                    aria-pressed={dateFilter === c.date}
                    aria-label={dayLabel(c)}
                    onClick={() => onDateFilter(dateFilter === c.date ? null : c.date)}
                    className={`${cellClass(c)} pt-0.5 px-0.5`}
                  >
                    {dayNum(c)}
                  </button>
                ))}
                {segs.map((s) => {
                  const e = byId.get(s.id)!;
                  const t = tone(e);
                  return (
                    <span
                      key={s.id}
                      aria-hidden="true"
                      className={`absolute z-20 pointer-events-none overflow-hidden whitespace-nowrap text-ellipsis text-[9px] font-black leading-4 h-4 px-1 tabular-nums ${
                        t === "urgent"
                          ? "bg-red-600 text-white"
                          : t === "upcoming"
                            ? "bg-white text-gray-900 border border-gray-900 leading-[14px]"
                            : "bg-gray-900 text-white"
                      }`}
                      style={{
                        left: `calc(${(s.col / 7) * 100}% + 1px)`,
                        width: `calc(${(s.span / 7) * 100}% - 2px)`,
                        top: 22 + s.lane * 18,
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
          })
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((c, idx) => {
              const selected = dateFilter === c.date;
              const ends = endingOn(active, c.date).length > 0;
              return (
                <button
                  key={c.date}
                  type="button"
                  aria-pressed={selected}
                  aria-label={dayLabel(c)}
                  onClick={() => onDateFilter(selected ? null : c.date)}
                  className={`${cellClass(c)} ${calStyle === "count" ? "min-h-[56px]" : ""} pt-0.5 pb-1`}
                  style={calStyle === "lines" ? { minHeight: 28 + lanes.length * 11 } : undefined}
                >
                  <span className="block px-0.5">{dayNum(c)}</span>
                  {calStyle === "count" ? (
                    <>
                      <span
                        className={`block text-center text-xl font-black tabular-nums leading-7 ${
                          c.ids.length === 0 ? "text-gray-300 font-bold" : c.inMonth ? "text-gray-900" : "text-gray-400"
                        }`}
                        aria-hidden="true"
                      >
                        {c.ids.length}
                      </span>
                      {ends && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-600" aria-hidden="true" />}
                    </>
                  ) : (
                    <span className="block mt-0.5" aria-hidden="true">
                      {lanes.map((e) => {
                        const open = c.ids.includes(e.id);
                        const t = tone(e);
                        const showNo = open && (c.date === e.startDate || idx % 7 === 0);
                        return (
                          <span
                            key={e.id}
                            className={`block h-[10px] mb-px text-[8px] font-black leading-[10px] tabular-nums overflow-hidden ${
                              !open
                                ? ""
                                : t === "urgent"
                                  ? "bg-red-600 text-white"
                                  : t === "upcoming"
                                    ? "bg-white text-gray-900 border-y border-gray-900 leading-[8px]"
                                    : "bg-gray-900 text-white"
                            }`}
                            style={{ opacity: dim(e.id) }}
                          >
                            {showNo && <span className="pl-0.5">{numberOf.get(e.id)}</span>}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {calStyle === "count" && (
        <div className="mt-2 min-w-0 border border-gray-300 bg-white p-3" aria-live="polite">
          {dateFilter ? (
            <>
              <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 leading-none mb-2 tabular-nums">
                {dateFilter.replaceAll("-", ".")}
              </p>
              {(() => {
                const open = exhibitionsOpenOn(active, dateFilter);
                if (open.length === 0) return <p className="text-[12px] text-gray-500">この日に開いている展覧会はありません</p>;
                return (
                  <ul className="grid gap-1 min-w-0">
                    {open.map((e) => (
                      <li key={e.id} className="flex min-w-0 items-center gap-2 text-[12px]">
                        <span className="text-[10px] font-black tabular-nums text-gray-400">{numberOf.get(e.id)}</span>
                        <span className="font-black text-gray-900 truncate">{e.title}</span>
                        {e.endDate === dateFilter && (
                          <span className="shrink-0 text-[9px] px-1.5 py-1 font-black leading-none bg-red-600 text-white">本日まで</span>
                        )}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </>
          ) : (
            <p className="text-[11px] text-gray-500">日付を押すと、その日に開いている展覧会が出ます（赤い印＝最終日の展示あり）</p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tracking-wider text-gray-500" aria-hidden="true">
        {calStyle !== "count" && (
          <>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2 bg-gray-900" />開催中</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2 border border-gray-900 bg-white" />開催前</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2 bg-red-600" />終了間近</span>
          </>
        )}
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
