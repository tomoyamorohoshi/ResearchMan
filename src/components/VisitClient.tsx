"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Exhibition } from "@/lib/exhibition";
import { useWantToGo } from "@/hooks/useWantToGo";
import { useTrash } from "@/hooks/useTrash";
import { buildPins, clusterPins, deriveVisit, exhibitionsOpenOn, todayJst, type CalStyle, type VenueGeo } from "@/lib/visit";
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

type Props = {
  items: Exhibition[];
  geo: VenueGeo;
  initialToday: string;
  calStyle: CalStyle;
};

export default function VisitClient({ items, geo, initialToday, calStyle }: Props) {
  const [today, setToday] = useState(initialToday);
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

  // 地域グループ（50km 以内で連結）。初期表示は最大グループ、チップで切替
  const clusters = useMemo(() => clusterPins(pins, 50), [pins]);
  // 選択はグループ内ピンの会場名で保持（都道府県ラベルは重複しうる）。該当が無くなったら最大グループに正規化
  const [regionSel, setRegionSel] = useState<string[] | "all" | null>(null); // null=最大グループ, "all"=全体
  const [fitNonce, setFitNonce] = useState(0);
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const activeCluster = useMemo(() => {
    if (regionSel === "all") return -1;
    if (regionSel === null) return 0;
    let best = -1;
    let bestN = 0;
    clusters.forEach((c, i) => {
      const n = c.pins.filter((p) => regionSel.includes(p.venue)).length;
      if (n > bestN) {
        best = i;
        bestN = n;
      }
    });
    return best >= 0 ? best : 0;
  }, [regionSel, clusters]);
  const fitPins = useMemo(
    () => (activeCluster < 0 ? pins : (clusters[activeCluster]?.pins ?? pins)),
    [activeCluster, clusters, pins],
  );
  const pickRegion = useCallback((sel: string[] | "all") => {
    setRegionSel(sel);
    setFitNonce((n) => n + 1);
  }, []);
  const changeDateFilter = useCallback((d: string | null) => {
    setDateFilter(d);
    setFitNonce((n) => n + 1);
  }, []);
  const pinItemCount = useMemo(() => pins.reduce((n, p) => n + p.items.length, 0), [pins]);

  // 項目（リスト・バー）を押す: 強調 + 地図をその会場へ
  const selectItem = useCallback(
    (e: Exhibition) => {
      setHighlightIds([e.id]);
      // スマホ幅（lg 未満）は地図が画面外ならスクロールで見せる
      const box = mapBoxRef.current;
      const located = pins.some((p) => p.items.some((x) => x.id === e.id));
      if (box && located && window.innerWidth < 1024) {
        const r = box.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) box.scrollIntoView({ behavior: "smooth", block: "center" });
      }
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

  const chipClass = (on: boolean) =>
    `px-2.5 py-1 text-[11px] font-black tabular-nums border ${
      on ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-300 hover:border-gray-900"
    }`;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-black tracking-tight text-gray-900">
          行きたい展覧会{ready ? `（${active.length}件）` : ""}
        </h2>
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
          {clusters.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2" role="group" aria-label="地図の表示地域">
              {clusters.length > 1 && (
                <button type="button" aria-pressed={activeCluster < 0} onClick={() => pickRegion("all")} className={chipClass(activeCluster < 0)}>
                  全体 {pinItemCount}
                </button>
              )}
              {clusters.map((c, i) => (
                <button key={`${c.label}-${i}`} type="button" aria-pressed={activeCluster === i} onClick={() => pickRegion(c.pins.map((p) => p.venue))} className={chipClass(activeCluster === i)}>
                  {c.label} {c.count}
                </button>
              ))}
            </div>
          )}
          <div ref={mapBoxRef} className="relative h-[320px] lg:h-[calc(100vh-220px)] lg:min-h-[420px] border border-gray-300 bg-gray-100">
            <VisitMap pins={pins} fitPins={fitPins} fitNonce={fitNonce} highlightedVenue={highlightVenue} focus={focus} onPinSelect={selectPin} />
            {dateFilter && pins.length === 0 && (
              <p role="status" className="absolute inset-x-4 top-4 z-[1000] bg-white/95 border border-gray-300 px-3 py-2 text-[12px] font-black text-gray-700 text-center">
                この日に開いている展覧会はありません
              </p>
            )}
          </div>
          {dateFilter && (
            <p className="mt-2 text-[11px] text-gray-600">
              {dateFilter.replaceAll("-", ".")} に開いている展覧会だけを地図に表示中
              <button type="button" onClick={() => changeDateFilter(null)} className="ml-2 underline font-black text-gray-900">
                解除
              </button>
            </p>
          )}
        </div>

        <div className="min-w-0">
          <VisitCalendar
            active={active}
            today={today}
            dateFilter={dateFilter}
            onDateFilter={changeDateFilter}
            highlightIds={highlightSet}
            unlocatedIds={unlocatedIds}
            onSelect={selectItem}
            calStyle={calStyle}
          />
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
