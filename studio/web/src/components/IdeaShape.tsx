import { useLayoutEffect, useRef } from "react";
import type { ResultCard } from "../types";

// RM本体の設計原則「切り詰め全廃」(2026-07-07) に合わせ、seed（概要・「〜かも」文）は
// 全文表示がマスト。line-clamp で切る代わりに、シェイプに収まるまで seed のフォント
// サイズを段階的に下げる（本体の「弧の選定・フォントサイズ決定は探索で行う」と同じ発想）。
const SEED_FONT_MAX_PX = 12.5;
const SEED_FONT_MIN_PX = 8;
const SEED_FONT_STEP_PX = 0.5;

function fitSeedFont(shape: HTMLElement, seed: HTMLElement): void {
  let size = SEED_FONT_MAX_PX;
  seed.style.fontSize = `${size}px`;
  // justify-content:space-between のため、収まっていれば scrollHeight == clientHeight
  while (size > SEED_FONT_MIN_PX && shape.scrollHeight > shape.clientHeight) {
    size -= SEED_FONT_STEP_PX;
    seed.style.fontSize = `${size}px`;
  }
}

export default function IdeaShape({ card }: { card: ResultCard }) {
  const shapeRef = useRef<HTMLAnchorElement>(null);
  const seedRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const shape = shapeRef.current;
    const seed = seedRef.current;
    if (!shape || !seed) return;
    fitSeedFont(shape, seed);
    // レスポンシブ（3列⇄2列⇄1列）でシェイプ寸法が変わるたびに再フィット
    const observer = new ResizeObserver(() => fitSeedFont(shape, seed));
    observer.observe(shape);
    return () => observer.disconnect();
  }, [card.seed, card.title, card.refs]);

  return (
    <a ref={shapeRef} className="idea-shape" href={card.url} target="_blank" rel="noopener">
      {card.angle && <span className="eyebrow">切り口 · {card.angle}</span>}
      {card.title && <span className="title">{card.title}</span>}
      <span ref={seedRef} className="seed">{card.seed}</span>
      {card.refs && card.refs.length > 0 && (
        <span className="refs">
          {card.refs.map((ref, i) => (
            <span className="refs-row" key={`${ref.type}-${i}`}>
              <b>{ref.type === "case" ? "CASE" : "TECH"}</b>
              <span className="refs-label">{ref.label}</span>
            </span>
          ))}
        </span>
      )}
    </a>
  );
}
