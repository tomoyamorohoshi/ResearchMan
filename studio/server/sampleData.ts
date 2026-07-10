/**
 * 静的サンプルカード（idea タブは P0/P3待ちのダミージョブ用。research タブの
 * サンプルは P1 で実パイプライン化済みのため現在未使用 — jobs.ts::createJob 参照）。
 *
 * idea の見た目は data/ideas.json（RM本体の実エントリ・毎朝のアイデアの種
 * パイプラインが追記）から読み込む。中身は実データだが生成そのものは行わない
 * ダミー実装で、テーマ/縛り等の入力は無視して既存エントリを返すだけ（P3で
 * テーマ駆動の実生成に置き換え予定。DESIGN.md §6 idea参照）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IdeaRefChip, ResultCard } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDEAS_JSON_PATH = path.join(__dirname, "..", "..", "data", "ideas.json");

const research: ResultCard[] = [
  {
    kind: "case",
    id: "annahar-blank-edition",
    url: "https://research-man.vercel.app/cases/annahar-blank-edition",
    title: "An-Nahar「The Blank Edition」",
    meta: "An-Nahar · レバノン · 2018",
    chip: { label: "Cannes 2019 GP", jp: false },
  },
  {
    kind: "case",
    id: "annahar-elections-edition",
    url: "https://research-man.vercel.app/cases/annahar-elections-edition",
    title: "An-Nahar「The Elections Edition」",
    meta: "An-Nahar · レバノン · 2022",
    chip: { label: "Cannes 2022 GP", jp: false },
  },
  {
    kind: "case",
    id: "annahar-newspapers-inside-the-newspaper",
    url: "https://research-man.vercel.app/cases/annahar-newspapers-inside-the-newspaper",
    title: "Newspapers Inside The Newspaper",
    meta: "An-Nahar · レバノン · 2022",
    chip: { label: "Cannes 2023 GP", jp: false },
  },
  {
    kind: "case",
    id: "mawbima-mosquito-repellent-newspaper",
    url: "https://research-man.vercel.app/cases/mawbima-mosquito-repellent-newspaper",
    title: "世界初「蚊よけ新聞」Mawbima",
    meta: "スリランカ · 2014",
    chip: { label: "D&AD Graphite", jp: true },
  },
  {
    kind: "case",
    id: "mainichi-green-newspaper",
    url: "https://research-man.vercel.app/cases/mainichi-green-newspaper",
    title: "Green Newspaper（種入り新聞）",
    meta: "毎日新聞 · 日本 · 2016",
    chip: { label: "話題化", jp: true },
  },
  {
    kind: "case",
    id: "ajinomoto-danran-lantern",
    url: "https://research-man.vercel.app/cases/ajinomoto-danran-lantern",
    title: "味の素「団らんランタン」",
    meta: "味の素 · 日本 · 2023",
    chip: { label: "新聞広告賞2024", jp: true },
  },
  {
    kind: "case",
    id: "daiichikosho-dam-1000-meigara",
    url: "https://research-man.vercel.app/cases/daiichikosho-dam-1000-meigara",
    title: "第一興商「DAM 1,000銘柄」",
    meta: "日本経済新聞 · 2024",
    chip: { label: "新聞広告賞2024", jp: true },
  },
  {
    kind: "case",
    id: "akita-sakigake-akitaben-karuta",
    url: "https://research-man.vercel.app/cases/akita-sakigake-akitaben-karuta",
    title: "あきた弁企業かるた",
    meta: "秋田魁新報 · 2024",
    chip: { label: "新聞広告賞2025", jp: true },
  },
];

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

export const sampleData = { research, idea };
