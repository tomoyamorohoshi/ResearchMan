"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Exhibition } from "@/lib/exhibition";
import { useWantToGo } from "@/hooks/useWantToGo";
import { useTrash } from "@/hooks/useTrash";
import { buildPins, deriveVisit, exhibitionsOpenOn, todayJst, type VenueGeo } from "@/lib/visit";
import VisitBars from "./VisitBars";
import VisitCalendar from "./VisitCalendar";
import { VisitActiveList, VisitEndedList } from "./VisitList";

const VisitMap = dynamic(() => import("./VisitMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-400 bg-gray-100">
      地図を読み込み中…
    </div>
  ),
});

export type VisitView = "bars" | "calendar";

type Props = {
  items: Exhibition[];
  geo: VenueGeo;
  initialToday: string;
  initialView: VisitView;
};

export default function VisitClient({ items, geo, initialToday, initialView }: Props) {
  const [today, setToday] = useState(initialToday);
  const [view, setView] = useState<VisitView>(initialView);
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [highlightVenue, setHighlightVenue] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ venue: string; nonce: number } | null>(null);
  const { wantToGo, mounted: wantMounted } = useWantToGo();
  const { trashed, mounted: trashMounted } = useTrash();

  useEffect(() => {
    // hydration 後にだけ実時刻(JST)を反映する（SSR 一致のため初期値では読めない）。意図的な mount 時 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(todayJst());
  }, []);

  const { active, ended } = useMemo(
    () => deriveVisit(items, wantToGo, trashed, today),
    [items, wantToGo, trashed, today],
  );

  const mapItems = useMemo(
    () => (dateFilter ? exhibitionsOpenOn(active, dateFilter) : active),
    [active, dateFilter],
  );
  const { pins } = useMemo(() => buildPins(mapItems, geo, today), [mapItems, geo, today]);
  const { unlocated } = useMemo(() => buildPins(active, geo, today), [active, geo, today]);
  const unlocatedIds = useMemo(() => new Set(unlocated.map((e) => e.id)), [unlocated]);

  const changeView = useCallback((v: VisitView) => {
    setView(v);
    setDateFilter(null);
    try {
      window.history.replaceState(null, "", `?view=${v}`);
    } catch {}
  }, []);

  // 項目（リスト・バー）を押す: 強調 + 地図をその会場へ
  const selectItem = useCallback(
    (e: Exhibition) => {
      setHighlightIds([e.id]);
      const pin = pins.find((p) => p.items.some((x) => x.id === e.id));
      if (pin) {
        setHighlightVenue(pin.venue);
        setFocus((f) => ({ venue: pin.venue, nonce: (f?.nonce ?? 0) + 1 }));
      } else {
        setHighlightVenue(null);
      }
    },
    [pins],
  );

  // ピンを押す: その会場の項目を強調 + リストへスクロール
  const selectPin = useCallback(
    (venue: string) => {
      const pin = pins.find((p) => p.venue === venue);
      if (!pin) return;
      setHighlightVenue(venue);
      setHighlightIds(pin.items.map((e) => e.id));
      const el = document.querySelector(`[data-visit-id="${CSS.escape(pin.items[0].id)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [pins],
  );

  const ready = wantMounted && trashMounted;
  const highlightSet = useMemo(() => new Set(highlightIds), [highlightIds]);

  const toggleClass = (on: boolean) =>
    `px-3 py-1.5 text-[11px] font-black tracking-wider border ${
      on ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:border-gray-900"
    }`;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-black tracking-tight text-gray-900">
          行きたい展覧会{ready ? `（${active.length}件）` : ""}
        </h2>
        <div className="flex" role="group" aria-label="表示切替">
          <button type="button" aria-pressed={view === "bars"} onClick={() => changeView("bars")} className={toggleClass(view === "bars")}>
            地図＋会期バー
          </button>
          <button type="button" aria-pressed={view === "calendar"} onClick={() => changeView("calendar")} className={`${toggleClass(view === "calendar")} -ml-px`}>
            地図＋カレンダー
          </button>
        </div>
      </div>

      {ready && active.length === 0 && (
        <div className="border border-gray-300 bg-white p-4 mb-4 text-sm text-gray-700">
          <p>Exhibition タブで「行きたい」を押すと、ここに地図と会期が出ます</p>
          <Link href="/exhibition" className="inline-block mt-2 text-[12px] font-black text-gray-900 underline">
            Exhibition タブへ
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="lg:sticky lg:top-4">
          <div className="h-[320px] lg:h-[calc(100vh-180px)] lg:min-h-[420px] border border-gray-300 bg-gray-100">
            <VisitMap pins={pins} highlightedVenue={highlightVenue} focus={focus} onPinSelect={selectPin} />
          </div>
          {dateFilter && (
            <p className="mt-2 text-[11px] text-gray-600">
              {dateFilter.replaceAll("-", ".")} に開いている展覧会だけを地図に表示中
              <button type="button" onClick={() => setDateFilter(null)} className="ml-2 underline font-black text-gray-900">
                解除
              </button>
            </p>
          )}
        </div>

        <div className="min-w-0">
          {view === "bars" ? (
            <VisitBars
              active={active}
              today={today}
              highlightIds={highlightSet}
              unlocatedIds={unlocatedIds}
              onSelect={selectItem}
            />
          ) : (
            <VisitCalendar
              active={active}
              today={today}
              dateFilter={dateFilter}
              onDateFilter={setDateFilter}
              highlightIds={highlightSet}
              onSelect={selectItem}
            />
          )}
        </div>
      </div>

      <VisitActiveList
        active={active}
        today={today}
        highlightIds={highlightSet}
        unlocatedIds={unlocatedIds}
        onSelect={selectItem}
      />
      <VisitEndedList ended={ended} />
    </div>
  );
}
