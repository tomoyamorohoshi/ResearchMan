"use client";

import { useMemo, useState } from "react";
import type { Exhibition } from "@/lib/exhibition";
import { isEndingSoon, monthCalendar, shiftMonth } from "@/lib/visit";

const PALETTE = ["#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#a16207"];
const URGENT = "#dc2626";
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

type Props = {
  active: Exhibition[];
  today: string;
  dateFilter: string | null;
  onDateFilter: (d: string | null) => void;
  highlightIds: Set<string>;
  onSelect: (e: Exhibition) => void;
};

// 案②: 月カレンダー。会期を色帯で重ね、日付クリックでその日に開いている展覧会だけ地図に絞る
export default function VisitCalendar({ active, today, dateFilter, onDateFilter, highlightIds, onSelect }: Props) {
  const [ym, setYm] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const cells = useMemo(() => monthCalendar(ym.year, ym.month, active), [ym, active]);

  const colors = new Map(
    active.map((e, i) => [e.id, isEndingSoon(e, today) ? URGENT : PALETTE[i % PALETTE.length]] as const),
  );
  // この月に重なる展覧会だけに帯のレーンを固定割り当て（月内で帯が途切れず揃う）
  const monthIds = new Set(cells.flatMap((c) => c.ids));
  const lanes = active.filter((e) => monthIds.has(e.id));

  return (
    <section aria-labelledby="visit-cal-h">
      <div className="flex items-center justify-between mb-2">
        <h2 id="visit-cal-h" className="text-sm font-black tracking-tight text-gray-900">
          {ym.year}年{ym.month}月
        </h2>
        <div className="flex gap-1">
          <button type="button" aria-label="前の月" onClick={() => setYm((v) => shiftMonth(v.year, v.month, -1))} className="px-3 py-1 text-[12px] font-black border border-gray-300 bg-white hover:border-gray-900">
            ‹ 前月
          </button>
          <button type="button" aria-label="次の月" onClick={() => setYm((v) => shiftMonth(v.year, v.month, 1))} className="px-3 py-1 text-[12px] font-black border border-gray-300 bg-white hover:border-gray-900">
            翌月 ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] text-gray-500 border-b border-gray-300" aria-hidden="true">
        {WEEK.map((w) => (
          <span key={w} className="py-1">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c) => {
          const m = Number(c.date.slice(5, 7));
          const selected = dateFilter === c.date;
          const isToday = c.date === today;
          return (
            <button
              key={c.date}
              type="button"
              aria-pressed={selected}
              aria-label={`${m}月${c.day}日 ${c.ids.length}件`}
              onClick={() => onDateFilter(selected ? null : c.date)}
              className={`relative min-w-0 text-left border border-gray-200 pt-0.5 pb-1 ${
                c.inMonth ? "bg-white" : "bg-gray-50 text-gray-300"
              } ${selected ? "outline outline-2 outline-sky-500 z-10" : "hover:bg-gray-100"}`}
            >
              <span
                className={`block px-1 text-[10px] tabular-nums leading-4 ${
                  isToday ? "font-black text-red-600" : c.inMonth ? "text-gray-700" : ""
                }`}
              >
                {c.day}
              </span>
              <span className="block mt-0.5" style={{ minHeight: lanes.length * 6 }} aria-hidden="true">
                {lanes.map((e) => (
                  <span
                    key={e.id}
                    className="block h-[5px] mb-px"
                    style={{
                      background: c.ids.includes(e.id) ? colors.get(e.id) : "transparent",
                      opacity: highlightIds.size > 0 && !highlightIds.has(e.id) ? 0.35 : 1,
                    }}
                  />
                ))}
              </span>
              {isToday && <span className="absolute inset-0 border-2 border-red-600 pointer-events-none" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 grid gap-1" aria-label="色の凡例">
        {active.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onSelect(e)} className="flex items-center gap-2 text-left text-[11px] text-gray-700 hover:text-gray-900">
              <span className="inline-block w-3 h-3 shrink-0" style={{ background: colors.get(e.id) }} aria-hidden="true" />
              <span className="truncate">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
