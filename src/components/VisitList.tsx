"use client";

import Link from "next/link";
import type { Exhibition } from "@/lib/exhibition";
import { badgeFor, visitNo } from "@/lib/visit";
import { formatPeriod } from "./ExhibitionBadge";

export function VisitBadges({
  e,
  today,
  unlocated,
}: {
  e: Pick<Exhibition, "startDate" | "endDate">;
  today: string;
  unlocated: boolean;
}) {
  const badge = badgeFor(e, today);
  return (
    <>
      {badge && (
        <span
          className={`shrink-0 text-[9px] px-1.5 py-1 font-black leading-none ${
            badge.kind === "urgent" ? "bg-red-600 text-white" : "bg-white text-gray-900 border border-gray-900"
          }`}
        >
          {badge.label}
        </span>
      )}
      {unlocated && (
        <span className="shrink-0 text-[9px] px-1.5 py-1 leading-none text-gray-500 border border-dashed border-gray-400">
          地図未登録
        </span>
      )}
    </>
  );
}

export function VisitActiveList({
  active,
  today,
  highlightIds,
  unlocatedIds,
  onSelect,
}: {
  active: Exhibition[];
  today: string;
  highlightIds: Set<string>;
  unlocatedIds: Set<string>;
  onSelect: (e: Exhibition) => void;
}) {
  if (active.length === 0) return null;
  return (
    <section aria-labelledby="visit-list-h" className="mt-6">
      <h2 id="visit-list-h" className="text-sm font-black tracking-tight text-gray-900 mb-2">
        一覧（終了間近が先頭）
      </h2>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {active.map((e, i) => {
          const on = highlightIds.has(e.id);
          return (
            <li
              key={e.id}
              data-visit-id={e.id}
              className={`flex items-stretch bg-white border ${on ? "border-sky-500 ring-2 ring-sky-300" : "border-gray-300"}`}
            >
              <button
                type="button"
                onClick={() => onSelect(e)}
                aria-pressed={on}
                className="flex-1 min-w-0 text-left p-3 hover:bg-gray-50"
              >
                <span className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-black leading-tight text-gray-900 tracking-tight">
                    <span className="mr-1.5 text-[10px] tabular-nums tracking-wider text-gray-400">{visitNo(i)}</span>
                    {e.title}
                  </span>
                  <span className="flex flex-wrap justify-end gap-1">
                    <VisitBadges e={e} today={today} unlocated={unlocatedIds.has(e.id)} />
                  </span>
                </span>
                <span className="block text-[10px] text-gray-500 leading-snug">
                  <span className="font-bold text-gray-700">{e.venue}</span>
                  <span className="text-gray-400"> / {e.prefecture}</span>
                </span>
                <span className="block text-[11px] font-black text-gray-900 tabular-nums mt-1">
                  {formatPeriod(e.startDate, e.endDate)}
                </span>
              </button>
              <Link
                href={`/exhibition/${e.slug}`}
                className="shrink-0 px-3 flex items-center text-[10px] font-black text-gray-500 hover:text-gray-900 border-l border-gray-200"
                aria-label={`${e.title} の詳細ページ`}
              >
                詳細
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function VisitEndedList({ ended }: { ended: Exhibition[] }) {
  if (ended.length === 0) return null;
  return (
    <details className="mt-6 border-t border-gray-300 pt-3">
      <summary className="cursor-pointer text-[12px] font-black text-gray-500">
        終了した展覧会（{ended.length}件）
      </summary>
      <ul className="mt-2 grid gap-1 opacity-60">
        {ended.map((e) => (
          <li key={e.id} className="text-[12px] text-gray-600">
            <Link href={`/exhibition/${e.slug}`} className="underline">
              {e.title}
            </Link>
            <span className="text-gray-400"> / {e.venue} / </span>
            <span className="tabular-nums">{formatPeriod(e.startDate, e.endDate)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
