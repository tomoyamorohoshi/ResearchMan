// Technology タブのデータ層（Case Study の cases.ts と対になる）。
// キュレーション方針・語彙は TECHNOLOGY_SPEC.md が単一ソース。
import techData from "../../data/tech.json";
import techVocabulary from "../../data/tech-tag-vocabulary.json";

export type TechType = "Research" | "Prototype" | "Tool";

// 商用利用可否（Research/Tool はライセンス由来、Prototype は原則 "none"）
export type Commercial = "ok" | "conditional" | "research-only" | "paid" | "none";

export type TechLink = {
  kind: "github" | "project" | "paper" | "post" | "product" | "video";
  url: string;
};

export type TechItem = {
  id: string;
  title: string;
  org: string;
  type: TechType;
  domains: string[];
  // 発表/収集時期（YYYY-MM）。カード表示とソートに使う
  date: string;
  year: string;
  summary: string;
  // 「何がすごいか」+「広告・体験づくりで何が作れそうか」のライト解説
  point: string;
  license: { spdx: string | null; commercial: Commercial; note?: string };
  links: TechLink[];
  thumbnail: string;
  relatedWorks: Array<{ title: string; description: string; url: string }>;
  sources?: string[];
};

export const techItems: TechItem[] = techData as TechItem[];

export const TECH_TYPES: TechType[] = (techVocabulary as { Type: TechType[] }).Type;

export const ALL_DOMAINS: string[] = (techVocabulary as { Domain: string[] }).Domain;

// 実データに登場するDomainのみ（語彙順を保つ）
const usedDomains = new Set(techItems.flatMap((t) => t.domains));
export const allDomains = ALL_DOMAINS.filter((d) => usedDomains.has(d));

export const allTechYears = Array.from(new Set(techItems.map((t) => t.year))).sort(
  (a, b) => Number(b) - Number(a)
);

export function getTechById(id: string): TechItem | undefined {
  return techItems.find((t) => t.id === id);
}

// 商用利用可否バッジの表示定義（TECHNOLOGY_SPEC.md §4）
export const COMMERCIAL_BADGE: Record<
  Commercial,
  { label: string; color: string; bg: string }
> = {
  ok: { label: "商用OK", color: "text-emerald-800", bg: "bg-emerald-100" },
  conditional: { label: "条件付き", color: "text-amber-800", bg: "bg-amber-100" },
  "research-only": { label: "研究用途のみ", color: "text-rose-800", bg: "bg-rose-100" },
  paid: { label: "有償ツール", color: "text-sky-800", bg: "bg-sky-100" },
  none: { label: "—", color: "text-gray-500", bg: "bg-gray-100" },
};

// 型バッジ（Research/Prototype/Tool）の表示定義
export const TYPE_BADGE: Record<TechType, { color: string; bg: string }> = {
  Research: { color: "text-indigo-800", bg: "bg-indigo-100" },
  Prototype: { color: "text-orange-800", bg: "bg-orange-100" },
  Tool: { color: "text-teal-800", bg: "bg-teal-100" },
};

export const LINK_KIND_LABEL: Record<TechLink["kind"], string> = {
  github: "GitHub",
  project: "Project",
  paper: "Paper",
  post: "Post",
  product: "Product",
  video: "Video",
};
