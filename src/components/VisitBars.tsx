"use client";

import type { Exhibition } from "@/lib/exhibition";
import { addDays, barLayout, computeBarRange, isEndingSoon, isUpcoming, todayLinePosition } from "@/lib/visit";
import { VisitBadges } from "./VisitList";

type Props = {
  active: Exhibition[];
  today: string;
  highlightIds: Set<string>;
  unlocatedIds: Set<string>;
  onSelect: (e: Exhibition) => void;
};

// 案①: 会期バー。横軸=日付（今日の7日前〜最も遅い終了日、最大6か月）
export default function VisitBars({ active, today, highlightIds, unlocatedIds, onSelect }: Props) {
  const range = computeBarRange(active, today);
  const todayPos = todayLinePosition(range, today) * 100;

  // 月の1日を目盛りにする
  const ticks: { label: string; pos: number }[] = [];
  for (let i = 0; i < range.days; i++) {
    const d = addDays(range.start, i);
    const pos = ((i + 0.5) / range.days) * 100;
    // 「今日」ラベルと近すぎる月ラベルは出さない（スマホ幅で重なるため）
    if (d.endsWith("-01") && Math.abs(pos - todayPos) >= 10) {
      ticks.push({ label: `${Number(d.slice(5, 7))}月`, pos });
    }
  }

  return (
    <section aria-labelledby="visit-bars-h">
      <h2 id="visit-bars-h" className="text-sm font-black tracking-tight text-gray-900 mb-2">
        会期バー
      </h2>
      <div className="relative h-5 border-b border-gray-300 text-[10px] text-gray-500" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t.pos} className="absolute top-0 -translate-x-1/2 border-l border-gray-300 pl-1 h-full" style={{ left: `${t.pos}%` }}>
            {t.label}
          </span>
        ))}
        <span className="absolute top-0 -translate-x-1/2 text-red-600 font-black bg-[#f5f3ee] px-0.5" style={{ left: `${todayPos}%` }}>
          今日
        </span>
      </div>
      {active.length === 0 ? (
        <p className="py-4 text-[12px] text-gray-400">表示する会期がありません</p>
      ) : (
        <ul>
          {active.map((e) => {
            const lay = barLayout(e, range);
            const urgent = isEndingSoon(e, today);
            const upcoming = isUpcoming(e, today);
            const on = highlightIds.has(e.id);
            const barColor = urgent ? "bg-red-600" : upcoming ? "bg-white border border-gray-900" : "bg-gray-900";
            return (
              <li key={e.id} data-visit-bar-id={e.id} className={`border-b border-gray-200 ${on ? "bg-sky-50" : ""}`}>
                <button
                  type="button"
                  onClick={() => onSelect(e)}
                  aria-pressed={on}
                  className="w-full text-left py-2 px-1 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-black text-gray-900 truncate">{e.title}</span>
                    <VisitBadges e={e} today={today} unlocated={unlocatedIds.has(e.id)} />
                  </span>
                  <span className="relative block h-3 bg-gray-100">
                    {lay.visible && (
                      <span
                        className={`absolute top-0 h-3 ${barColor}`}
                        style={{ left: `${lay.left * 100}%`, width: `${lay.width * 100}%` }}
                        title={`${e.startDate} – ${e.endDate}`}
                      />
                    )}
                    <span className="absolute top-[-2px] bottom-[-2px] w-px bg-red-600" style={{ left: `${todayPos}%` }} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {range.clipped && <p className="mt-1 text-[10px] text-gray-400">表示は最大6か月までです</p>}
    </section>
  );
}
