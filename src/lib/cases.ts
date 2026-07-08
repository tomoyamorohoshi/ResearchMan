import casesData from "../../data/cases.json";
import { ALL_TAGS } from "./tags";

export type Case = {
  id: string;
  title: string;
  summary: string;
  client: string;
  agency: string;
  categories: string[];
  award: string;
  year: string;
  regions: string[];
  link: string;
  thumbnail: string;
  videoId?: string;
  overview: string;
  background: string;
  execution: string;
  evaluationImpact: string;
  relatedWorks: Array<{ title: string; description: string; url: string }> | string;
  // どのリサーチ文脈で収集したかを示すソースタグ（例: "Cannes 2026", "Web & Social", "Radar"）
  sources?: string[];
  // 逆引き用ハッシュタグ（統制語彙は src/lib/tags.ts。例: "Tech/AI", "Form/MV", "Theme/Music"）
  tags?: string[];
  // legacy fields (backward compat)
  mechanism?: string;
  impact?: string;
  evaluation?: string;
  // 自己回復ウォッチドッグ(scripts/watchdog.mjs)の日曜deep監査が低確度の問題を検知した際に
  // 立てる隔離フラグ。削除・配列からの除去はしない（quarantined:trueを手で戻せば復帰可能）
  quarantined?: boolean;
  quarantineReason?: string;
  quarantineTs?: string;
};

export const cases: Case[] = (casesData as Case[]).filter((c) => !c.quarantined);

export const allCategories = Array.from(
  new Set(cases.flatMap((c) => c.categories))
).sort();

export const allYears = Array.from(new Set(cases.map((c) => c.year))).sort(
  (a, b) => Number(b) - Number(a)
);

export const allRegions = Array.from(
  new Set(cases.flatMap((c) => c.regions))
).sort();

export const allSources = Array.from(
  new Set(cases.flatMap((c) => c.sources ?? []))
).sort();

// 実データに登場するタグのみ（語彙順を保つため tags.ts の ALL_TAGS でソート）
const usedTags = new Set(cases.flatMap((c) => c.tags ?? []));
export const allTags = ALL_TAGS.filter((t) => usedTags.has(t));

export function getCaseById(id: string): Case | undefined {
  return cases.find((c) => c.id === id);
}
