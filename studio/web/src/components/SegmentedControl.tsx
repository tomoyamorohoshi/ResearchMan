interface Props {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export default function SegmentedControl({
  label,
  options,
  value,
  onChange,
}: Props) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
