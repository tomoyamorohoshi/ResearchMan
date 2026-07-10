/**
 * 静的サンプルカード（idea タブ用。data/ideas.json から読んだ実データをResultCard形式へ
 * マップするヘルパー。research タブのサンプル配列は P1 でresearchが実パイプライン化された
 * ため使われなくなり、P4 #6でデッドコードとして削除した — jobs.ts::createJob参照）。
 *
 * idea の見た目は data/ideas.json（RM本体の実エントリ・毎朝のアイデアの種パイプラインが
 * 追記）から読み込む。jobs.ts::createJob は idea も P3 で実パイプライン化済み（idea.ts経由の
 * 生成は行わない）のため、本モジュールの mapRealIdeasToResultCards は現状どこからも実行時に
 * 参照されていない。ただし sampleData.test.ts が data/ideas.json のスキーマ前提（pattern付き
 * エントリが実在すること等）を検知する回帰ガードとして機能しているため、本体は残す。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IdeaRefChip, ResultCard } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDEAS_JSON_PATH = path.join(__dirname, "..", "..", "data", "ideas.json");

const IDEAS_URL = "https://research-man.vercel.app/ideas";

export interface RealIdeaRef {
  type: "case" | "tech";
  id: string;
  title: string;
  desc: string;
}

export interface RealIdea {
  id: string;
  date: string | null;
  title: string;
  pattern: string | null;
  seed: string;
  refs: RealIdeaRef[];
}

/**
 * data/ideas.json の実エントリ配列を ResultCard(idea) 形式へマップする（純粋関数・単体テスト対象）。
 * eyebrow（切り口）を必ず出せるよう pattern が付いた実エントリのみを対象にする
 * （バックフィル分は pattern=null のアーカイブ扱いのため除外。src/lib/ideas.ts参照）。
 * 並びは新しい種が先頭（RM本体 sortedIdeas と同じ日付降順方針）。
 */
export function mapRealIdeasToResultCards(raw: RealIdea[]): ResultCard[] {
  const withPattern = raw.filter((i) => i.pattern);
  const sorted = [...withPattern].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return sorted.map((i) => ({
    kind: "idea",
    id: i.id,
    url: IDEAS_URL,
    title: i.title,
    angle: i.pattern ?? undefined,
    seed: i.seed,
    refs: i.refs.map((r): IdeaRefChip => ({ type: r.type, label: r.title })),
  }));
}

function loadIdeaResultCards(): ResultCard[] {
  const raw = JSON.parse(readFileSync(IDEAS_JSON_PATH, "utf-8")) as RealIdea[];
  return mapRealIdeasToResultCards(raw);
}

const idea: ResultCard[] = loadIdeaResultCards();

export const sampleData = { idea };
