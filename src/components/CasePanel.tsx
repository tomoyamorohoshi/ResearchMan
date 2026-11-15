"use client";

// TOPページ3Dノードグラフ用の右側詳細パネル（旧CaseModalの置き換え）。
// 画面分割で左のグラフを操作し続けられるよう、モーダルではなく非モーダルの
// complementaryリージョンとして実装する（フォーカストラップ・body scroll lockはしない）。
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Case } from "@/lib/cases";
import { getAwardLevel } from "@/lib/awardLevel";
import { tagLabel } from "@/lib/tags";
import { fetchCaseDetail } from "@/lib/caseDetail";

type Props = { c: Case; onClose: () => void };

// 長文（概要など）は一覧のインデックスに含まれないため、パネルを開いた事例の分だけ事例別JSONから取得する
type DetailState = { id: string; status: "ok" | "error"; overview: string };

export default function CasePanel({ c, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // 常に最新のonCloseを指す。effect依存にonCloseを入れると、親の再レンダーで
  // inline関数の参照が変わるたびにeffectが再実行され、フォーカス強奪・スクロール
  // リセットが起きる（非モーダル化で顕在化するリグレッション。下のコメント参照）
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ケース切替時（別ノードクリック）のみ: 閉じるボタンへフォーカスし、スクロールを先頭へ。
  // 依存は[c]だけにする。非モーダルパネルは表示中も左のグラフや検索欄を操作できるため、
  // 無関係な親再レンダー（検索打鍵・フィルタ・busy変化等）でこのeffectが再実行されると
  // 「検索欄に1文字打つたびフォーカスが閉じるボタンへ奪われる」壊滅的なUXになる
  useEffect(() => {
    closeButtonRef.current?.focus();
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [c]);

  // 詳細取得。結果は取得対象のidとセットで持ち、id不一致の間は「読み込み中」として扱う
  // （effect内で同期setStateしない）。awardsページ等で既に長文を持つ事例はfetchしない
  const hasInlineOverview = typeof c.overview === "string" && c.overview !== "";
  const [detail, setDetail] = useState<DetailState | null>(null);
  useEffect(() => {
    if (hasInlineOverview) return;
    let cancelled = false;
    fetchCaseDetail(c.id)
      .then((d) => {
        if (!cancelled) setDetail({ id: c.id, status: "ok", overview: d.overview ?? "" });
      })
      .catch((err) => {
        console.error("Failed to load case detail", c.id, err);
        if (!cancelled) setDetail({ id: c.id, status: "error", overview: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [c.id, hasInlineOverview]);
  const detailForThis = detail && detail.id === c.id ? detail : null;
  const overview = hasInlineOverview ? c.overview : (detailForThis?.overview ?? "");

  // Escで閉じる（パネル表示中のみ。フォーカストラップはしない＝左のグラフ操作を妨げない）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const level = getAwardLevel(c.award);
  const chips: Array<{ key: string; text: string }> = [
    ...c.categories.map((v) => ({ key: `cat-${v}`, text: v })),
    ...c.regions.map((v) => ({ key: `region-${v}`, text: v })),
    ...(c.sources ?? []).map((v) => ({ key: `src-${v}`, text: `#${v}` })),
    ...(c.tags ?? []).map((v) => ({ key: `tag-${v}`, text: `#${tagLabel(v)}` })),
  ];

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={c.title}
      className="absolute inset-0 w-full sm:static sm:w-[420px] sm:max-w-[45vw] sm:shrink-0 h-full border-l border-gray-300 bg-white overflow-y-auto"
    >
      <div className="relative aspect-video">
        <Image src={c.thumbnail} alt={c.title} fill className="object-cover" sizes="420px" />
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
        {chips.length > 0 && (
          <p className="flex flex-wrap gap-1.5 mb-4">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="text-[9px] tracking-wider uppercase px-2 py-0.5 border border-gray-300 text-gray-500"
              >
                {chip.text}
              </span>
            ))}
          </p>
        )}

        <div className="flex items-center gap-2 mb-2">
          {level ? (
            <span className={`text-[9px] font-black tracking-[0.15em] leading-none px-1.5 py-1 ${level.color} ${level.bg}`}>
              {level.label}
            </span>
          ) : (
            <span className="text-[9px] tracking-widest text-gray-400 uppercase leading-none">
              {c.award.split(" ").slice(0, 3).join(" ")}
            </span>
          )}
          <span className="text-xs font-black text-gray-900 tabular-nums">{c.year}</span>
        </div>

        <h2 className="text-lg font-black leading-tight tracking-tight text-gray-900 mb-2">{c.title}</h2>

        {c.summary && <p className="text-[11px] text-gray-600 leading-relaxed mb-4">{c.summary}</p>}

        {overview ? (
          <p className="text-[11px] text-gray-600 leading-relaxed mb-4 whitespace-pre-line line-clamp-6">{overview}</p>
        ) : !hasInlineOverview && !detailForThis ? (
          <p role="status" className="text-[10px] tracking-widest text-gray-400 mb-4">詳細を読み込み中…</p>
        ) : !hasInlineOverview && detailForThis?.status === "error" ? (
          <p role="alert" className="text-[10px] tracking-widest text-red-500 mb-4">詳細を読み込めませんでした</p>
        ) : null}

        <div className="bg-[#f6f4ef] p-4 grid grid-cols-2 gap-x-6 gap-y-3 mb-5">
          <MetaField label="クライアント" value={c.client} />
          <MetaField label="エージェンシー" value={c.agency} />
          <MetaField label="年" value={c.year} />
          <MetaField label="受賞" value={c.award} />
        </div>

        <div className="flex flex-col items-start gap-2">
          {c.link && (
            <a
              href={c.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] tracking-[0.2em] uppercase font-bold text-gray-700 hover:text-gray-900 underline underline-offset-4 transition-colors"
            >
              一次ソースを見る →
            </a>
          )}
          <Link
            href={`/cases/${c.id}`}
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
      <span className="block text-xs font-bold text-gray-900">{value}</span>
    </div>
  );
}
