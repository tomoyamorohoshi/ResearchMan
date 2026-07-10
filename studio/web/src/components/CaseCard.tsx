import type { ResultCard } from "../types";

// card.kind は "case" | "tech" | "idea" だが、このコンポーネントは Research タブ結果
// （Case Study / Technology、DESIGN.md §6・両方は混在表示）専用（idea は IdeaShape が別途担当）。
const KIND_LABEL: Record<string, string> = { case: "Case", tech: "Tech" };

export default function CaseCard({ card }: { card: ResultCard }) {
  return (
    <a className="rm-card" href={card.url} target="_blank" rel="noopener">
      <span className="rm-thumb">
        <span className="kind">{KIND_LABEL[card.kind] ?? "Case"}</span>
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
