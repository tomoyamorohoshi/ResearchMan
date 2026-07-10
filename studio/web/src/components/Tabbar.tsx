import type { Tab } from "../types";

const TABS: { id: Tab; label: string }[] = [
  { id: "research", label: "Research" },
  { id: "idea", label: "idea" },
];

interface Props {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

export default function Tabbar({ activeTab, onChange }: Props) {
  return (
    <div className="tabbar" role="tablist" aria-label="モード">
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          className="tab"
          role="tab"
          aria-selected={activeTab === t.id}
          aria-controls={`panel-${t.id}`}
          data-tab={t.id}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
