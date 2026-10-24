"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { VenuePin } from "@/lib/visit";
import { formatPeriod } from "./ExhibitionBadge";

type Props = {
  pins: VenuePin[];
  highlightedVenue: string | null;
  // 項目クリックで地図を会場へ移動しポップアップを開く（nonce が変わるたびに実行）
  focus: { venue: string; nonce: number } | null;
  onPinSelect: (venue: string) => void;
};

function pinIcon(pin: VenuePin, highlighted: boolean): L.DivIcon {
  const color = pin.urgent ? "#dc2626" : "#111827";
  const size = highlighted ? 26 : 20;
  const ring = highlighted ? "box-shadow:0 0 0 3px rgba(14,165,233,.8),0 1px 4px rgba(0,0,0,.5);" : "box-shadow:0 1px 4px rgba(0,0,0,.5);";
  const count = pin.items.length > 1 ? String(pin.items.length) : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid #fff;${ring}color:#fff;font:700 11px/${size - 4}px sans-serif;text-align:center">${count}</div>`,
  });
}

function popupContent(pin: VenuePin): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "font:12px/1.5 sans-serif;min-width:160px;max-width:240px";
  const v = document.createElement("div");
  v.textContent = pin.venue;
  v.style.cssText = "font-weight:700;color:#6b7280;margin-bottom:4px";
  root.appendChild(v);
  for (const e of pin.items) {
    const block = document.createElement("div");
    block.style.cssText = "margin-top:6px";
    const a = document.createElement("a");
    a.href = `/exhibition/${e.slug}`;
    a.textContent = e.title;
    a.style.cssText = "font-weight:900;color:#111827;text-decoration:underline";
    const p = document.createElement("div");
    p.textContent = formatPeriod(e.startDate, e.endDate);
    p.style.cssText = "color:#6b7280;font-variant-numeric:tabular-nums";
    block.append(a, p);
    root.appendChild(block);
  }
  return root;
}

export default function VisitMap({ pins, highlightedVenue, focus, onPinSelect }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onPinSelectRef = useRef(onPinSelect);
  useEffect(() => {
    onPinSelectRef.current = onPinSelect;
  }, [onPinSelect]);

  // 地図の生成と破棄
  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true }).setView([36, 138], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markers.clear();
    };
  }, []);

  // ピンの再描画と fitBounds
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    for (const pin of pins) {
      const m = L.marker([pin.lat, pin.lng], {
        icon: pinIcon(pin, false),
        title: pin.venue,
        alt: pin.venue,
        zIndexOffset: pin.urgent ? 1000 : 0,
      });
      m.bindPopup(() => popupContent(pin));
      m.on("click", () => onPinSelectRef.current(pin.venue));
      m.addTo(layer);
      markersRef.current.set(pin.venue, m);
    }
    if (pins.length > 0) {
      map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [40, 40],
        maxZoom: 15,
      });
    }
  }, [pins]);

  // 強調ピン
  useEffect(() => {
    for (const pin of pins) {
      markersRef.current.get(pin.venue)?.setIcon(pinIcon(pin, pin.venue === highlightedVenue));
    }
  }, [pins, highlightedVenue]);

  // 項目クリック → 会場へ移動 + ポップアップ
  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    const m = markersRef.current.get(focus.venue);
    if (!map || !m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 14), { animate: false });
    m.openPopup();
  }, [focus]);

  return <div ref={elRef} className="w-full h-full" role="region" aria-label="展覧会の会場地図" />;
}
