import type { ResultCard } from "../types";

export default function CaseCard({ card }: { card: ResultCard }) {
  return (
    <a className="rm-card" href={card.url} target="_blank" rel="noopener">
      <span className="rm-thumb">
        <span className="kind">Case</span>
      </span>
      <span className="rm-body">
        <span className="rm-title">{card.title}</span>
        <span className="rm-meta">{card.meta}</span>
        {card.chip && (
          <span className={`rm-chip${card.chip.jp ? " jp" : ""}`}>
            {card.chip.label}
          </span>
        )}
      </span>
    </a>
  );
}
