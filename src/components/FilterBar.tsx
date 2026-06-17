"use client";

type Props = {
  categories: string[];
  years: string[];
  regions: string[];
  selected: { category: string; year: string; region: string };
  onChange: (key: "category" | "year" | "region", value: string) => void;
};

export default function FilterBar({ categories, years, regions, selected, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mb-8">
      <FilterGroup
        label="カテゴリ"
        options={categories}
        value={selected.category}
        onSelect={(v) => onChange("category", v)}
      />
      <FilterGroup
        label="年代"
        options={years}
        value={selected.year}
        onSelect={(v) => onChange("year", v)}
      />
      <FilterGroup
        label="地域"
        options={regions}
        value={selected.region}
        onSelect={(v) => onChange("region", v)}
      />
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs text-gray-400 mr-1">{label}:</span>
      <button
        onClick={() => onSelect("")}
        className={`text-xs px-3 py-1 rounded-full border transition-colors ${
          value === ""
            ? "bg-gray-900 text-white border-gray-900"
            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
        }`}
      >
        すべて
      </button>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            value === opt
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
