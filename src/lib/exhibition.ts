// Exhibition タブのデータ層（Technology の tech.ts と対）。仕様は SPEC.md が単一ソース。
// status 判定と slug 生成は scripts/lib の ESM を共有する（ロジックを複製しない）。
import exhibitionJson from "../../data/exhibition.json";
import exhibitionVocabulary from "../../data/exhibition-tag-vocabulary.json";
import {
  computeStatus,
  todayJst,
  daysBetween,
  isValidYmd,
} from "../../scripts/lib/exhibition-status.mjs";
import { slugify, buildExhibitionId } from "../../scripts/lib/exhibition-slug.mjs";

export { computeStatus, todayJst, daysBetween, isValidYmd, slugify, buildExhibitionId };

export type ExhibitionStatus = "upcoming" | "ongoing" | "ended";

export type VenueType =
  | "museum"
  | "alt_space"
  | "corporate"
  | "media_art_center"
  | "gallery"
  | "other";

export type ExhibitionSource = {
  name: string;
  url: string;
  kind: "official" | "listing" | "social" | "news";
};

export type Exhibition = {
  id: string;
  slug: string;
  title: string;
  artists: string[];
  venue: string;
  venueType: VenueType;
  prefecture: string;
  city: string;
  // YYYY-MM-DD（JST 暦日）
  startDate: string;
  endDate: string;
  // statusAsOf 時点の保存値。表示では信用せず today で再計算する（visibleExhibitions）
  status: ExhibitionStatus;
  admission: string;
  tags: string[];
  score: number;
  matchReason: string;
  sources: ExhibitionSource[];
  link: string;
  thumbnail: string;
  addedAt: string;
  origin: "auto" | "intake";
  intakeUrl?: string;
  highlight: boolean;
  quarantined?: boolean;
};

export type ExhibitionData = {
  version: 1;
  statusAsOf: string;
  items: Exhibition[];
};

export const exhibitionData = exhibitionJson as unknown as ExhibitionData;

// 隔離フラグ付きは tech と同様に表示対象から外す（データには残る）
export const exhibitionItems: Exhibition[] = exhibitionData.items.filter((e) => !e.quarantined);

export const EXHIBITION_TAGS: string[] = (exhibitionVocabulary as { Tag: string[] }).Tag;

export function getExhibitionBySlug(slug: string): Exhibition | undefined {
  return exhibitionItems.find((e) => e.slug === slug);
}

// 開催中の残り日数（endDate - today。当日は 0＝本日まで）
export function daysLeft(e: Pick<Exhibition, "endDate">, today: string): number {
  return daysBetween(today, e.endDate);
}

// 開始までの日数（startDate - today）
export function startsIn(e: Pick<Exhibition, "startDate">, today: string): number {
  return daysBetween(today, e.startDate);
}

// today で status を再計算した複製を返す（保存値は信用しない）
function withStatus<T extends Exhibition>(e: T, today: string): T {
  return { ...e, status: computeStatus(e.startDate, e.endDate, today) };
}

// 表示用の並び（SPEC §4）: ongoing → upcoming → ended。
// ongoing は endDate 昇順（終わりが近い順）、upcoming は startDate 昇順、ended は endDate 降順。
// 同順位内（同じ並び替えキー）では highlight が先頭。status は today から再計算して判定する。
export function sortExhibitions<T extends Exhibition>(items: T[], today: string): T[] {
  const rank = { ongoing: 0, upcoming: 1, ended: 2 } as const;
  return items
    .map((e) => ({ e, status: computeStatus(e.startDate, e.endDate, today) }))
    .sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      let cmp = 0;
      if (a.status === "ongoing") cmp = a.e.endDate.localeCompare(b.e.endDate);
      else if (a.status === "upcoming") cmp = a.e.startDate.localeCompare(b.e.startDate);
      else cmp = b.e.endDate.localeCompare(a.e.endDate);
      if (cmp !== 0) return cmp;
      return Number(b.e.highlight) - Number(a.e.highlight);
    })
    .map((x) => x.e);
}

// 表示対象: today で status を再計算し ended を除外（status は再計算値に差し替え。並びは保たない）
export function visibleExhibitions<T extends Exhibition>(items: T[], today: string): T[] {
  return items.map((e) => withStatus(e, today)).filter((e) => e.status !== "ended");
}
