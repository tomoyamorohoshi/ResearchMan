"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Case } from "@/lib/cases";
import { getAwardLevel } from "@/lib/awardLevel";
import { tagLabel } from "@/lib/tags";

type Props = { c: Case | null; onClose: () => void };

const FOCUSABLE_SELECTOR = 'a[href], button, [tabindex]:not([tabindex="-1"])';

export default function CaseModal({ c, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!c) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
  }, [c, onClose]);

  if (!c) return null;

  const level = getAwardLevel(c.award);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#111111]/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-modal-title"
        className="bg-white w-full max-w-md max-h-[85vh] overflow-y-auto"
      >
        <div className="relative aspect-square">
          <Image
            src={c.thumbnail}
            alt={c.title}
            fill
            className="object-cover"
            sizes="448px"
          />
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

          <h2 id="case-modal-title" className="text-lg font-black leading-tight tracking-tight text-gray-900 mb-2">
            {c.title}
          </h2>

          <p className="text-[10px] text-gray-500 leading-snug mb-2">
            <span className="font-bold text-gray-700">{c.client}</span>
            {c.client && c.agency ? " / " : ""}
            {c.agency}
          </p>

          {c.summary && (
            <p className="text-[11px] text-gray-600 leading-relaxed mb-3">{c.summary}</p>
          )}

          {(c.tags ?? []).length > 0 && (
            <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 mb-4">
              {(c.tags ?? []).map((t) => (
                <span key={t} className="text-[9px] tracking-wider text-gray-400">
                  #{tagLabel(t)}
                </span>
              ))}
            </p>
          )}

          <Link
            href={`/cases/${c.id}`}
            className="inline-block text-[10px] tracking-[0.2em] uppercase font-bold text-[#9c7a1f] hover:text-[#b08d2d] transition-colors"
          >
            詳細ページへ →
          </Link>
        </div>
      </div>
    </div>
  );
}
