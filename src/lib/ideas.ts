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
// IdeaCard・IdeasDeckのカウンター表示で共有する
export function dateLabelOf(idea: Idea): string {
  return idea.date ? idea.date.replaceAll("-", ".") : "ARCHIVE";
}
