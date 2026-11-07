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

/** 投稿者確認で追加した展示（verifiedVia: "owner-intake"。公式・TAB の照合は通っていない）の小さな印。それ以外は何も出さない。 */
export function OwnerIntakeBadge({ e, size = "sm" }: { e: Pick<Exhibition, "verifiedVia">; size?: "sm" | "md" }) {
  if (e.verifiedVia !== "owner-intake") return null;
  return (
    <span
      className={`${size === "md" ? "text-[10px] px-2 py-1" : "text-[8px] px-1 py-0.5"} font-bold tracking-wider leading-none whitespace-nowrap border border-dashed border-gray-400 text-gray-500`}
      data-exhibition-verified="owner-intake"
      title="公式ページ・Tokyo Art Beat での照合は通っていません。投稿された情報をもとに登録しています"
    >
      公式未確認
    </span>
  );
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
      <span className={`${size === "md" ? "text-xs" : "text-[9px]"} font-bold tracking-wider text-gray-500 whitespace-nowrap`}>
        {STATUS_LABEL[status]}
      </span>
      <span
        className={`${base} font-black tracking-[0.08em] leading-none whitespace-nowrap ${tone}`}
        data-exhibition-badge={urgent ? "urgent" : "normal"}
      >
        {label}
      </span>
    </span>
  );
}
