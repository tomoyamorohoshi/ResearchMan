import Link from "next/link";
import type { Idea } from "@/lib/ideas";

// QMStdポスター風のタイポグラフィックカード×RMトーン。
// カード背景はidの決定論ハッシュで3バリアントにローテーションする
// （白60% / ベージュ30% / インク反転10%。「1枚だけ濃い」変化をRM色内で再現）。
type Variant = "white" | "beige" | "black";

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function variantOf(id: string): Variant {
  const bucket = hashId(id) % 10;
  if (bucket === 9) return "black";
  if (bucket >= 6) return "beige";
  return "white";
}

const VARIANT_STYLE: Record<
  Variant,
  { bg: string; text: string; muted: string; body: string; rule: string; caseLabel: string }
> = {
  white: {
    bg: "#ffffff",
    text: "text-gray-900",
    muted: "text-gray-400",
    body: "text-gray-600",
    rule: "bg-gray-900",
    caseLabel: "text-gray-400",
  },
  beige: {
    bg: "#f6efdd",
    text: "text-gray-900",
    muted: "text-gray-500",
    body: "text-gray-600",
    rule: "bg-gray-900",
    caseLabel: "text-gray-500",
  },
  black: {
    bg: "#111111",
    text: "text-[#eeece7]",
    muted: "text-gray-400",
    body: "text-gray-300",
    rule: "bg-[#3a3a3a]",
    caseLabel: "text-gray-400",
  },
};

// テック参照ラベルのアクセントカラー（RMトーンのゴールド系）。反転カードでも視認できる明度
const TECH_LABEL_COLOR = "text-[#b08d2d]";

export default function IdeaCard({ idea }: { idea: Idea }) {
  const v = VARIANT_STYLE[variantOf(idea.id)];
  const dateLabel = idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE";

  return (
    <div className={`flex flex-col p-4 ${v.text}`} style={{ backgroundColor: v.bg }}>
      {/* メタ行: パターンタグ + 日付 */}
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[9px] tracking-widest uppercase ${v.muted}`}>
          {idea.pattern ? `【${idea.pattern}】` : ""}
        </span>
        <span className={`text-[10px] tabular-nums shrink-0 ${v.muted}`}>{dateLabel}</span>
      </div>

      <div className={`h-px my-2 ${v.rule}`} />

      {/* タイトル */}
      <h2 className="text-2xl font-black tracking-tight leading-tight">{idea.title}</h2>

      {/* アイデア文 */}
      <p className={`text-[11px] leading-relaxed mt-2 ${v.body}`}>{idea.seed}</p>

      {/* 参照フッター（QMStdのスペックシート風） */}
      {idea.refs.length > 0 && (
        <div className="mt-3 flex flex-col">
          {idea.refs.map((ref) => (
            <Link
              key={`${ref.type}-${ref.id}`}
              href={ref.type === "tech" ? `/technology/${ref.id}` : `/cases/${ref.id}`}
              title={ref.desc}
              className={`group flex items-center gap-2 py-1.5 border-t ${
                v.rule === "bg-gray-900" ? "border-gray-300" : "border-[#3a3a3a]"
              }`}
            >
              <span
                className={`text-[8px] font-black tracking-[0.2em] uppercase shrink-0 ${
                  ref.type === "tech" ? TECH_LABEL_COLOR : v.caseLabel
                }`}
              >
                {ref.type === "tech" ? "Tech" : "Case"}
              </span>
              {/* min-w-0: flex子の既定min-width:autoだとflex-1でも縮まずtruncateが効かない */}
              <span className="text-[10px] font-bold flex-1 min-w-0 truncate">{ref.title}</span>
              <span
                className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${v.muted}`}
                aria-hidden="true"
              >
                →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
