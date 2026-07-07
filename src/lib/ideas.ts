// Ideas タブのデータ層（Case Study の cases.ts / Technology の tech.ts と対になる）。
// 毎朝10時のアイデアの種パイプライン（generate-idea-seeds.mjs）が data/ideas.json に
// 自動追記し、push経由でここに反映される。バックフィル分は date=null・pattern=null の
// アーカイブ扱い（scripts/backfill-idea-seeds.mjs 参照）。
import ideasData from "../../data/ideas.json";

export type IdeaRefType = "case" | "tech";

export type IdeaRef = {
  type: IdeaRefType;
  id: string;
  title: string;
  desc: string;
};

export type Idea = {
  id: string;
  date: string | null;
  title: string;
  pattern: string | null;
  seed: string;
  refs: IdeaRef[];
};

export const ideas: Idea[] = ideasData as Idea[];

// idの末尾の連番（"2026-07-08-3" → 3 / "archive-12" → 12）。同日内・アーカイブ内の並び替えに使う
function seqOf(id: string): number {
  const m = id.match(/-(\d+)$/);
  return m ? Number(m[1]) : 0;
}

// 表示順: date降順（新しい種が先頭）。同日内はid連番の昇順（その日に生成された順）。
// date=nullのアーカイブ群は末尾にまとめ、archive内はid連番の昇順（履歴の古い順＝archive-1から）
export const sortedIdeas: Idea[] = [...ideas].sort((a, b) => {
  if (a.date === null || b.date === null) {
    if (a.date === b.date) return seqOf(a.id) - seqOf(b.id);
    return a.date === null ? 1 : -1;
  }
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return seqOf(a.id) - seqOf(b.id);
});

// カード表示用の日付ラベル（"2026-07-08" → "2026.07.08" / null → "ARCHIVE"）。
// IdeaShapeCardのカードで共有する
export function dateLabelOf(idea: Idea): string {
  return idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE";
}

// ── カテゴライズ（DESIGN: goofy-hatching-mango.md）────────────────────────
// カテゴリ = そのアイデアが参照する最初のtech refのDomain（tech.jsonのdomains[0]）。
// tech refが無い（case参照のみ・参照なし）アイデアは"CASE REMIX"扱い。
// 配色はRMのベージュ紙面(#eeece7)に調和するくすみ系エディトリアル8色（設計合意の色表）
export type CategoryKey =
  | "SPATIAL_3D"
  | "MOTION_BODY"
  | "GENVIDEO"
  | "CREATORTOOLS"
  | "AI_AGENTS"
  | "HCI_MEDIAART"
  | "AUDIO_MUSIC"
  | "CASE_REMIX";

export type Category = { key: CategoryKey; label: string; fill: string; text: string };

const CREAM = "#f4f0e6";
const INK = "#1f1f1f";

// 表示順（凡例・カテゴリ列挙で使う正準順）
const CATEGORY_ORDER: CategoryKey[] = [
  "SPATIAL_3D",
  "MOTION_BODY",
  "GENVIDEO",
  "CREATORTOOLS",
  "AI_AGENTS",
  "HCI_MEDIAART",
  "AUDIO_MUSIC",
  "CASE_REMIX",
];

// 配色: ビビッド原色系（GOOD SUMMER/FUN IS STILL LOADINGポスター参考。DESIGN差分:
// goofy-hatching-mango.md ユーザーフィードバックDによるくすみ系からの刷新）。
// yellow/pinkは文字がINKになる（ink on yellow=9.81:1・ink on pink=8.27:1でAA適合実測済み）。
const CATEGORIES: Record<CategoryKey, Category> = {
  SPATIAL_3D: { key: "SPATIAL_3D", label: "SPATIAL/3D", fill: "#2456d4", text: CREAM },
  MOTION_BODY: { key: "MOTION_BODY", label: "MOTION/BODY", fill: "#df2a1b", text: CREAM },
  GENVIDEO: { key: "GENVIDEO", label: "GENVIDEO", fill: "#8a4bc9", text: CREAM },
  CREATORTOOLS: { key: "CREATORTOOLS", label: "CREATORTOOLS", fill: "#f2c200", text: INK },
  AI_AGENTS: { key: "AI_AGENTS", label: "AI/AGENTS", fill: "#0e7d3d", text: CREAM },
  HCI_MEDIAART: { key: "HCI_MEDIAART", label: "HCI/MEDIAART", fill: "#e8651a", text: CREAM },
  AUDIO_MUSIC: { key: "AUDIO_MUSIC", label: "AUDIO/MUSIC", fill: "#f0a1bd", text: INK },
  CASE_REMIX: { key: "CASE_REMIX", label: "CASE REMIX", fill: INK, text: CREAM },
};

// tech.jsonのdomains[0]表記（TECHNOLOGY_SPEC.mdのDomain語彙）→ カテゴリキー
const DOMAIN_TO_CATEGORY: Record<string, CategoryKey> = {
  "Spatial/3D": "SPATIAL_3D",
  "Motion/Body": "MOTION_BODY",
  GenVideo: "GENVIDEO",
  CreatorTools: "CREATORTOOLS",
  "AI/Agents": "AI_AGENTS",
  "HCI/MediaArt": "HCI_MEDIAART",
  "Audio/Music": "AUDIO_MUSIC",
};

// アイデアのカテゴリを導出する。techDomainByIdはtech.json由来のid→domains[0]マップ
// （ページ側=サーバーで src/lib/tech.ts の techItems から構築して渡す）
export function categoryOf(idea: Idea, techDomainById: Map<string, string>): Category {
  const techRef = idea.refs.find((r) => r.type === "tech");
  if (!techRef) return CATEGORIES.CASE_REMIX;
  const domain0 = techDomainById.get(techRef.id);
  const key = domain0 ? DOMAIN_TO_CATEGORY[domain0] : undefined;
  return key ? CATEGORIES[key] : CATEGORIES.CASE_REMIX;
}

// 凡例用: 実際に存在するカテゴリだけを正準順で返す
export function existingCategories(ideas: Idea[], techDomainById: Map<string, string>): Category[] {
  const seen = new Set<CategoryKey>();
  for (const idea of ideas) seen.add(categoryOf(idea, techDomainById).key);
  return CATEGORY_ORDER.filter((k) => seen.has(k)).map((k) => CATEGORIES[k]);
}
