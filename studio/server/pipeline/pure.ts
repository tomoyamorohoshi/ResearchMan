/**
 * Research(Case Study) 実パイプラインの純粋関数群（ネットワーク/git/Agent SDKに触れない部分）。
 * P0のダミー実装をP1で実収集パイプラインへ差し替えるにあたり、単体テスト可能なロジックを
 * ここに集約する（DESIGN.md §6・auto-research-cc.mjsのtoId/normTitle等を移植・TS化）。
 */
import { clampCount } from "../jobs.js";

// ── リクエスト検証 ──────────────────────────────────────────────

export interface ValidatedResearchRequest {
  theme: string;
  viewpoint: string;
  refUrl: string;
  count: number;
}

export type ValidationResult =
  | { ok: true; value: ValidatedResearchRequest }
  | { ok: false; error: string };

const RESEARCH_COUNT_MIN = 1;
const RESEARCH_COUNT_MAX = 10;
const RESEARCH_COUNT_DEFAULT = 5;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Research タブのリクエストを検証する。P1はCase Studyのみ対応
 * （Technology/両方はP2予定 → 400で弾く。DESIGN.md §10 P1のスコープ外定義）。
 */
export function validateResearchRequest(request: Record<string, unknown>): ValidationResult {
  const kind = str(request.kind);
  if (kind !== "Case Study") {
    return { ok: false, error: "Technology リサーチは P2 で対応予定です" };
  }
  const theme = str(request.theme);
  if (!theme) {
    return { ok: false, error: "テーマを入力してください" };
  }
  const viewpoint = str(request.viewpoint);
  const refUrl = str(request.refUrl);
  const count = clampCount(request.count, RESEARCH_COUNT_MIN, RESEARCH_COUNT_MAX, RESEARCH_COUNT_DEFAULT);
  return { ok: true, value: { theme, viewpoint, refUrl, count } };
}

// ── 収集角度 ────────────────────────────────────────────────────

/**
 * case-collectorを並列実行する角度を組み立てる（DESIGN.md §6: 角度別並列）。
 * 観点が指定されていれば角度ラベルにも織り込み、収集精度を上げる。
 */
export function buildAngles(theme: string, viewpoint: string): string[] {
  const base = viewpoint ? `${theme}（観点: ${viewpoint}）` : theme;
  return [`${base} — 海外事例中心`, `${base} — 国内事例中心`];
}

// ── id / タイトル正規化（auto-research-cc.mjsのtoId/normTitleを移植） ──────

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function slugOf(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** cases.json の id 生成ルール（auto-research-cc.mjs::toId と同一アルゴリズム）。 */
export function toCaseId(title: string, year: string | number, client = ""): string {
  let base = slugOf(title);
  // 日本語のみのタイトルはスラッグが空になる → クライアント名 or ハッシュで一意化
  if (base.replace(/[\d-]/g, "").length < 3) {
    const clientSlug = slugOf(client);
    base = clientSlug.replace(/[\d-]/g, "").length >= 3 ? clientSlug : `case-${shortHash(title)}`;
  }
  return `${base}-${year}`.replace(/-+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");
}

/** id違いの重複検出用タイトル正規化（auto-research-cc.mjs::normTitle と同一アルゴリズム）。 */
export function normalizeTitleKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // 結合分音記号を除去
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, "");
}

// ── 重複除外 ────────────────────────────────────────────────────

export interface ExistingCaseIndex {
  ids: Set<string>;
  titleKeys: Set<string>;
  links: Set<string>;
}

const normalizeLink = (link: string | undefined | null): string => (link || "").replace(/\/+$/, "");

export function buildExistingCaseIndex(
  cases: Array<{ id: string; title: string; link?: string }>,
): ExistingCaseIndex {
  return {
    ids: new Set(cases.map((c) => c.id)),
    titleKeys: new Set(cases.map((c) => normalizeTitleKey(c.title))),
    links: new Set(cases.map((c) => normalizeLink(c.link)).filter(Boolean)),
  };
}

export interface RawCandidate {
  title: string;
  client?: string;
  agency?: string;
  year: string | number;
  link: string;
  award?: string;
  summary?: string;
  youtubeId?: string;
  angle?: string;
}

export interface DedupedCandidate extends RawCandidate {
  id: string;
}

/**
 * 既存事例（data/cases.json）およびジョブ内の候補同士の重複を除外する。
 * id・正規化タイトル・リンクのいずれかが一致すれば重複とみなす
 * （auto-research-cc.mjsのexistingIds/existingTitleKeysと同じ二重防波堤の考え方）。
 */
export function dedupeCandidates(
  candidates: RawCandidate[],
  existing: ExistingCaseIndex,
): DedupedCandidate[] {
  const seenIds = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const seenLinks = new Set<string>();
  const kept: DedupedCandidate[] = [];

  for (const c of candidates) {
    if (!c?.title?.trim() || !c?.year || !c?.link?.trim()) continue;
    const id = toCaseId(c.title, c.year, c.client);
    const titleKey = normalizeTitleKey(c.title);
    const linkKey = normalizeLink(c.link);

    if (existing.ids.has(id) || existing.titleKeys.has(titleKey) || existing.links.has(linkKey)) continue;
    if (seenIds.has(id) || seenTitleKeys.has(titleKey) || seenLinks.has(linkKey)) continue;

    seenIds.add(id);
    seenTitleKeys.add(titleKey);
    seenLinks.add(linkKey);
    kept.push({ ...c, id });
  }
  return kept;
}

// ── Agent応答のJSON抽出 ────────────────────────────────────────

/** テキスト中の最初の `[` 〜 最後の `]` をJSON配列としてパースする（説明文混入を許容）。 */
export function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── タグ語彙フィルタ ────────────────────────────────────────────

export interface TagVocabulary {
  Tech: string[];
  Form: string[];
  Theme: string[];
}

/** data/tag-vocabulary.json の語彙外タグを除外し、最大5個に丸める。 */
export function filterTagsByVocabulary(tags: unknown, vocab: TagVocabulary): string[] {
  if (!Array.isArray(tags)) return [];
  const valid = new Set([...vocab.Tech, ...vocab.Form, ...vocab.Theme]);
  const unique = Array.from(new Set(tags.filter((t): t is string => typeof t === "string" && valid.has(t))));
  return unique.slice(0, 5);
}

// ── cases.json エントリ組み立て ────────────────────────────────

export interface WriterFields {
  summary: string;
  categories: string[];
  award: string;
  regions: string[];
  tags: string[];
  overview: string;
  background: string;
  execution: string;
  evaluationImpact: string;
  relatedWorks: { title: string; description: string; url: string }[];
}

export interface CaseEntry {
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
  videoId: string;
  overview: string;
  background: string;
  execution: string;
  evaluationImpact: string;
  relatedWorks: { title: string; description: string; url: string }[];
  sources: string[];
  tags: string[];
}

export function buildCaseEntry(params: {
  id: string;
  title: string;
  client: string;
  agency: string;
  year: string | number;
  link: string;
  thumbnail: string;
  videoId: string;
  sourceTag: string;
  writer: WriterFields;
}): CaseEntry {
  return {
    id: params.id,
    title: params.title,
    summary: params.writer.summary,
    client: params.client,
    agency: params.agency,
    categories: params.writer.categories.length ? params.writer.categories : ["コンテンツ革新"],
    award: params.writer.award || "",
    year: String(params.year),
    regions: params.writer.regions.length ? params.writer.regions : ["グローバル"],
    link: params.link,
    thumbnail: params.thumbnail,
    videoId: params.videoId,
    overview: params.writer.overview || "",
    background: params.writer.background || "",
    execution: params.writer.execution || "",
    evaluationImpact: params.writer.evaluationImpact || "",
    relatedWorks: params.writer.relatedWorks || [],
    sources: [params.sourceTag],
    tags: params.writer.tags,
  };
}

// ── commitメッセージ ────────────────────────────────────────────

export function buildCommitMessage(theme: string, count: number): string {
  return `Studio research: ${theme} ${count}件追加 (Case Study)`;
}

// ── researchSources.ts への新オーダー行追加 ────────────────────

const RADAR_LINE = '  { tag: "Radar", kind: "radar", label: "Radar" },';

function escapeForTsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export interface UpsertOrderTagResult {
  content: string;
  changed: boolean;
  /** 実際に使われたタグ名。衝突回避で入力(tag)と異なる場合がある。呼び出し側は
   * cases.jsonのsourcesにこの値を使うこと（researchSources.tsとの整合を保つため）。 */
  tag: string;
}

interface ParsedSourceEntry {
  tag: string;
  kind: string;
}

// `{ tag: "...", kind: "...", label: "..." }` 形式の行を kind 問わず全て拾う
// （researchSources.ts の既存フォーマット・エスケープ無しの単純な引用符文字列前提）。
const SOURCE_ENTRY_RE = /\{\s*tag:\s*"([^"]*)",\s*kind:\s*"([^"]*)",\s*label:\s*"([^"]*)"\s*,?\s*\}/g;

function parseSourceEntries(fileContent: string): ParsedSourceEntry[] {
  const entries: ParsedSourceEntry[] = [];
  for (const m of fileContent.matchAll(SOURCE_ENTRY_RE)) {
    entries.push({ tag: m[1], kind: m[2] });
  }
  return entries;
}

/**
 * src/lib/researchSources.ts の RESEARCH_SOURCES 配列に新しい order タグを1行追加する。
 * 挿入位置はRadar行の直前（2026-07-09 Newspaper追加コミットと同じパターン）。
 *
 * adversarial-reviewer指摘#3: 既存タグとの名前一致だけで「再利用」と判定すると、
 * haiku生成のタグ名がたまたま既存の radar/award タグ（例: "Radar"・"Cannes 2026"）と
 * 同名になった場合、新規caseがRadar/Award扱いに誤分類されてしまう。
 * kind==="order" の同名のみ安全に再利用し、他kindと衝突した場合は数字サフィックスで
 * 確実に別名の新規orderタグを作る（サフィックスも衝突していたら更にインクリメント）。
 */
export function upsertOrderTagLine(
  fileContent: string,
  tag: string,
  label: string,
): UpsertOrderTagResult {
  const entries = parseSourceEntries(fileContent);
  const byTag = new Map(entries.map((e) => [e.tag, e.kind]));

  const existingKind = byTag.get(tag);
  if (existingKind === "order") {
    return { content: fileContent, changed: false, tag };
  }

  let finalTag = tag;
  let finalLabel = label;
  if (existingKind !== undefined) {
    // 他kind（radar/award等）と衝突 → 数字サフィックスで確実に新規order名にする
    let n = 2;
    while (byTag.has(`${tag} (${n})`)) n++;
    finalTag = `${tag} (${n})`;
    finalLabel = `${label} (${n})`;
  }

  if (!fileContent.includes(RADAR_LINE)) {
    throw new Error("researchSources.ts の Radar 行が想定フォーマットと一致しません（手動確認が必要）");
  }
  const newLine = `  { tag: "${escapeForTsString(finalTag)}", kind: "order", label: "${escapeForTsString(finalLabel)}" },`;
  const content = fileContent.replace(RADAR_LINE, `${newLine}\n${RADAR_LINE}`);
  return { content, changed: true, tag: finalTag };
}
