"use client";

// Technologyタブ 3Dノードグラフ用の右側詳細パネル（CasePanel.tsxのTech版）。
// 画面分割で左のグラフを操作し続けられるよう、モーダルではなく非モーダルの
// complementaryリージョンとして実装する（フォーカストラップ・body scroll lockはしない）。
// 構成・a11y・スクロール/Esc挙動はCasePanelに準拠する（計画書参照）。
import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { type TechItem, TYPE_BADGE, COMMERCIAL_BADGE, LINK_KIND_LABEL } from "@/lib/tech";

type Props = { t: TechItem; onClose: () => void };

export default function TechPanel({ t, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // 常に最新のonCloseを指す。effect依存にonCloseを入れると、親の再レンダーで
  // inline関数の参照が変わるたびにeffectが再実行され、フォーカス強奪・スクロール
  // リセットが起きる（CasePanelと同じ理由でGraph3DView経由のonCloseを守る）
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // アイテム切替時（別ノードクリック）のみ: 閉じるボタンへフォーカスし、スクロールを先頭へ。
  // 依存は[t]だけにする（CasePanel同様、無関係な親再レンダーで奪われないようにする）
  useEffect(() => {
    closeButtonRef.current?.focus();
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [t]);

  // Escで閉じる（パネル表示中のみ。フォーカストラップはしない＝左のグラフ操作を妨げない）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const typeBadge = TYPE_BADGE[t.type];
  const commercial = COMMERCIAL_BADGE[t.license.commercial];
  const licenseText = t.license.spdx ?? t.license.note ?? "—";
  const firstLink = t.links[0];

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={t.title}
      className="absolute inset-0 w-full sm:static sm:w-[420px] sm:max-w-[45vw] sm:shrink-0 h-full border-l border-gray-300 bg-white overflow-y-auto"
    >
      <div className="relative aspect-video">
        <Image src={t.thumbnail} alt={t.title} fill className="object-cover" sizes="420px" />
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="閉じる"
          className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-white/90 text-gray-900 hover:bg-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className={`text-[9px] font-black tracking-[0.15em] uppercase leading-none px-1.5 py-1 ${typeBadge.color} ${typeBadge.bg}`}>
            {t.type}
          </span>
          <span className={`text-[9px] font-black tracking-[0.1em] leading-none px-1.5 py-1 ${commercial.color} ${commercial.bg}`}>
            {commercial.label}
          </span>
          <span className="text-xs font-black text-gray-900 tabular-nums">{t.date}</span>
        </div>

        {t.domains.length > 0 && (
          <p className="flex flex-wrap gap-1.5 mb-4">
            {t.domains.map((d) => (
              <span key={d} className="text-[9px] tracking-wider uppercase px-2 py-0.5 border border-gray-300 text-gray-500">
                #{d}
              </span>
            ))}
          </p>
        )}

        <h2 className="text-lg font-black leading-tight tracking-tight text-gray-900 mb-2">{t.title}</h2>
        <p className="text-[11px] font-bold text-gray-500 mb-3">{t.org}</p>

        {t.summary && <p className="text-[11px] text-gray-600 leading-relaxed mb-4">{t.summary}</p>}

        <section className="mb-4">
          <h3 className="text-[9px] tracking-[0.25em] uppercase text-gray-400 font-bold mb-1.5">技術のポイント</h3>
          <p className="text-[11px] text-gray-800 leading-relaxed whitespace-pre-line">{t.point}</p>
        </section>

        <div className="bg-[#f6f4ef] p-4 grid grid-cols-2 gap-x-6 gap-y-3 mb-5">
          <MetaField label="開発元" value={t.org} />
          <MetaField label="発表" value={t.date} />
          <MetaField label="ライセンス" value={licenseText} />
          <MetaField label="商用利用" value={commercial.label} />
        </div>

        <div className="flex flex-col items-start gap-2">
          {firstLink && (
            <a
              href={firstLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] tracking-[0.2em] uppercase font-bold text-gray-700 hover:text-gray-900 underline underline-offset-4 transition-colors"
            >
              {LINK_KIND_LABEL[firstLink.kind]}を見る →
            </a>
          )}
          <Link
            href={`/technology/${t.id}`}
            className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#9c7a1f] hover:text-[#b08d2d] transition-colors"
          >
            詳細ページへ →
          </Link>
        </div>
      </div>
    </aside>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[9px] tracking-[0.25em] uppercase text-gray-400 mb-1">{label}</span>
      <span className="block text-xs font-bold text-gray-900 line-clamp-2">{value}</span>
    </div>
  );
}
