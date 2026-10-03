"use client";

import { useEffect, useState } from "react";
import type { Exhibition } from "@/lib/exhibition";
import { todayJst } from "../../scripts/lib/exhibition-status.mjs";
import ExhibitionBadge from "@/components/ExhibitionBadge";

// 静的生成ページ用。サーバ(ビルド時)の today を初期 state にして hydration を一致させ、
// マウント後にクライアントの JST 今日で再計算する（一覧 ExhibitionGalleryClient と同方式）。
export default function ExhibitionBadgeLive({
  e,
  initialToday,
  size,
}: {
  e: Pick<Exhibition, "startDate" | "endDate">;
  initialToday: string;
  size?: "sm" | "md";
}) {
  const [today, setToday] = useState(initialToday);
  useEffect(() => {
    // hydration 後にだけ実時刻を反映する（SSR 一致のため初期値では読めない）。意図的な mount 時 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(todayJst());
  }, []);
  return <ExhibitionBadge e={e} today={today} size={size} />;
}
