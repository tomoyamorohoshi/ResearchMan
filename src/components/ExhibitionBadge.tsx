import type { Exhibition } from "@/lib/exhibition";
import { computeStatus, daysLeft, startsIn } from "@/lib/exhibition";

// 会期バッジ（SPEC §4）。色だけに依存しないよう必ずテキストで状態を示す。
// ongoing: 「残りN日」（N<=7 は強調・当日は「本日まで」）／upcoming: 「N日後に開始」／ended: 「終了」。
// status は保存値でなく today から再計算する。サーバ/クライアント両方から使える純コンポーネント。
export function exhibitionBadgeInfo(
  e: Pick<Exhibition, "startDate" | "endDate">,
  today: string,
): { label: string; status: "ongoing" | "upcoming" | "ended"; urgent: boolean } {
  const status = computeStatus(e.startDate, e.endDate, today);
  if (status === "ended") return { label: "終了", status, urgent: false };
  if (status === "upcoming") return { label: `${startsIn(e, today)}日後に開始`, status, urgent: false };
  const n = daysLeft(e, today);
  return { label: n === 0 ? "本日まで" : `残り${n}日`, status, urgent: n <= 7 };
}

export function formatPeriod(startDate: string, endDate: string): string {
  return `${startDate.replaceAll("-", ".")} – ${endDate.replaceAll("-", ".")}`;
}

const STATUS_LABEL = { ongoing: "開催中", upcoming: "開催前", ended: "終了" } as const;

export default function ExhibitionBadge({
  e,
  today,
  size = "sm",
}: {
  e: Pick<Exhibition, "startDate" | "endDate">;
  today: string;
  size?: "sm" | "md";
}) {
  const { label, status, urgent } = exhibitionBadgeInfo(e, today);
  const base = size === "md" ? "text-xs px-2 py-1" : "text-[9px] px-1.5 py-1";
  const tone = urgent
    ? "bg-red-600 text-white"
    : status === "ongoing"
      ? "bg-gray-900 text-white"
      : status === "upcoming"
        ? "bg-white text-gray-900 border border-gray-900"
        : "bg-gray-200 text-gray-500";
  return (
    <span className="inline-flex items-center gap-1.5" data-exhibition-status={status}>
      <span className={`${size === "md" ? "text-xs" : "text-[9px]"} font-bold tracking-wider text-gray-500`}>
        {STATUS_LABEL[status]}
      </span>
      <span
        className={`${base} font-black tracking-[0.08em] leading-none ${tone}`}
        data-exhibition-badge={urgent ? "urgent" : "normal"}
      >
        {label}
      </span>
    </span>
  );
}
