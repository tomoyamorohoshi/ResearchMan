// Ideas タブのデータ層（Case Study の cases.ts / Technology の tech.ts と対になる）。
// 毎朝10時のアイデアの種パイプライン（generate-idea-seeds.mjs）が data/ideas.json に
// 自動追記し、push経由でここに反映される。バックフィル分は date=null・pattern=null の
// アーカイブ扱い（scripts/backfill-idea-seeds.mjs 参照）。
//
// 型・定数・純粋関数（data/ideas.jsonを必要としない部分）は src/lib/ideaCategory.ts に
// 切り出し済み（クライアントコンポーネントがそちらだけをimportすることで、data/ideas.jsonの
// 即時importをバンドルに引きずり込まないため）。本ファイルはdata/ideas.json由来の値
// (ideas/sortedIdeas)を提供しつつ、既存の消費者を壊さないようideaCategory.tsを再exportする
// 後方互換レイヤーとして残す。
import ideasData from "../../data/ideas.json";
import { sortIdeas, type Idea } from "./ideaCategory";

export * from "./ideaCategory";

export const ideas: Idea[] = ideasData as Idea[];
export const sortedIdeas: Idea[] = sortIdeas(ideas);
