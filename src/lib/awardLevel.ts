// 受賞レベルの判定とソート用ランク（client/server 両用の純粋関数）

export type AwardLevel = {
  label: string;   // 表示用ラベル
  rank: number;    // ソート用（小さいほど上位）
  color: string;   // バッジ色（Tailwind text色クラス）
  bg: string;      // バッジ背景
};

export function getAwardLevel(award: string): AwardLevel | null {
  const a = (award || "").toLowerCase();
  // 上位から判定（同一文字列に複数該当する場合に最高位を優先）
  if (a.includes("grand prix") || a.includes("grand award") || a.includes("grand clio") || a.includes("グランプリ")) {
    return { label: "GRAND PRIX", rank: 0, color: "text-white", bg: "bg-gray-900" };
  }
  if (a.includes("titanium")) {
    return { label: "TITANIUM", rank: 1, color: "text-white", bg: "bg-gray-900" };
  }
  if (/\bgold\b/.test(a) || a.includes("ゴールド")) {
    return { label: "GOLD", rank: 2, color: "text-white", bg: "bg-[#b08d2d]" };
  }
  if (/\bsilver\b/.test(a) || a.includes("シルバー")) {
    return { label: "SILVER", rank: 3, color: "text-white", bg: "bg-[#8a8a8a]" };
  }
  if (/\bbronze\b/.test(a) || a.includes("ブロンズ")) {
    return { label: "BRONZE", rank: 4, color: "text-white", bg: "bg-[#9c6b3f]" };
  }
  if (a.includes("shortlist") || a.includes("finalist")) {
    return { label: "FINALIST", rank: 5, color: "text-gray-500", bg: "bg-gray-200" };
  }
  return null;
}

// 受賞レベル順（GP→Gold→Silver→Bronze）。同ランクは年の降順
export function compareByAward(
  a: { award: string; year: string },
  b: { award: string; year: string },
): number {
  const ra = getAwardLevel(a.award)?.rank ?? 9;
  const rb = getAwardLevel(b.award)?.rank ?? 9;
  if (ra !== rb) return ra - rb;
  return Number(b.year) - Number(a.year);
}
