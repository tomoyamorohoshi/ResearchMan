/**
 * add-case パイプライン（LINEでURLを送ると事例が cases.json に追加される機能）の
 * 純粋関数群（ネットワーク/git/Agent SDKに触れない部分）。caseResearch.tsのpure.tsと
 * 役割分担は同じ（DESIGN: 実装依頼「LINEでURLを送ると事例が cases.json に追加される」）。
 */
import { normLink } from "../../../scripts/lib/norm-link.mjs";
import { filterTagsByVocabulary, normalizeTitleKey, type CaseEntry, type TagVocabulary, type WriterFields } from "./pure.js";

// ── リクエスト検証 ──────────────────────────────────────────────

export interface ValidatedAddCaseRequest {
  url: string;
  /** URL以外の補足テキスト（視点・メモ）。空文字なら指定なし。 */
  context: string;
  /** LINE経由の依頼の場合の送信者userId。API入口（Claude Code一括処理）は空文字
   * （空ならパイプラインはLINE通知をスキップする。addCase.ts::notifyLineIfPossible参照）。 */
  lineUserId: string;
  /** trueならcases.json書き込み・git・LINE通知をスキップし、生成エントリと検証結果のみ
   * job結果に残す（auto-research-cc.mjs --dry-run の慣例に合わせる）。 */
  dryRun: boolean;
}

export type AddCaseValidationResult =
  | { ok: true; value: ValidatedAddCaseRequest }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function validateAddCaseRequest(request: Record<string, unknown>): AddCaseValidationResult {
  const url = str(request.url);
  if (!url) {
    return { ok: false, error: "URLを入力してください" };
  }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "http(s)のURLを指定してください" };
  }
  return {
    ok: true,
    value: {
      url,
      context: str(request.context),
      lineUserId: str(request.lineUserId),
      dryRun: request.dryRun === true,
    },
  };
}

// ── X/Twitterリンク判定 ────────────────────────────────────────

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);

/** x.com/twitter.comのURLか（本文直接取得が難しいため、case-adder Agentへの指示を出し分ける）。 */
export function isXLink(url: string): boolean {
  try {
    return X_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// ── Agent応答のJSON抽出 ────────────────────────────────────────

/** テキスト中の最初の `{` 〜 最後の `}` をJSONオブジェクトとしてパースする（説明文混入を許容）。 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── case-adder Agent応答の解釈 ──────────────────────────────────

export interface ExtractedCandidate {
  found: boolean;
  reason?: string;
  title: string;
  client: string;
  agency: string;
  year: string | number;
  link: string;
  award: string;
  summary: string;
  youtubeId?: string;
}

/**
 * case-adder Agentの応答（extractJsonObjectで得たオブジェクト）を型付きの候補へ変換する。
 * found は明示的に true が返された場合のみ true とする（未指定/曖昧な応答を「見つかった」と
 * 見切り発車で扱わない。事実確認できない場合は必ず false 側に倒す方針 — DESIGN要件6）。
 */
export function parseExtractedCandidate(obj: Record<string, unknown>): ExtractedCandidate {
  return {
    found: obj.found === true,
    reason: typeof obj.reason === "string" ? obj.reason : undefined,
    title: typeof obj.title === "string" ? obj.title.trim() : "",
    client: typeof obj.client === "string" ? obj.client.trim() : "",
    agency: typeof obj.agency === "string" ? obj.agency.trim() : "",
    year: typeof obj.year === "string" || typeof obj.year === "number" ? obj.year : "",
    link: typeof obj.link === "string" ? obj.link.trim() : "",
    award: typeof obj.award === "string" ? obj.award.trim() : "",
    summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
    youtubeId: typeof obj.youtubeId === "string" ? obj.youtubeId.trim() : undefined,
  };
}

/** found=trueかつ必須項目（title/year/link）が揃っているか。 */
export function isUsableCandidate(c: ExtractedCandidate): boolean {
  return c.found && !!c.title && !!String(c.year) && !!c.link;
}

/**
 * case-adder Agentが返すyear（"2024/25"のような表記ゆれを含みうる）から、最初に現れる
 * 4桁連続数字を抽出する（指摘1: 表記ゆれがid生成・サムネイルパス・URLに混入するのを防ぐ）。
 * 4桁が見つからなければnull（事実確認できない年を当年フォールバック等で埋めない —
 * isUsableCandidateと同じfail-closed方針。呼び出し側でエラーとして扱うこと）。
 */
export function normalizeYear(year: string | number): string | null {
  const m = String(year).match(/\d{4}/);
  return m ? m[0] : null;
}

// ── 重複判定 ────────────────────────────────────────────────────

export interface DuplicateMatch {
  id: string;
  title: string;
}

/**
 * 既存事例（data/cases.json）との重複判定（DESIGN要件4: 「正規化リンク+タイトル」）。
 * id・正規化タイトル・正規化リンクのいずれかが一致すれば重複とみなし、既存側の
 * {id, title} を返す（LINE返信「既に登録済み: <タイトル>」に使う）。
 */
export function findDuplicateCase(
  candidate: { id: string; title: string; link: string },
  existingCases: Array<{ id: string; title: string; link?: string }>,
): DuplicateMatch | null {
  const titleKey = normalizeTitleKey(candidate.title);
  const linkKey = normLink(candidate.link);
  for (const c of existingCases) {
    if (c.id === candidate.id) return { id: c.id, title: c.title };
    if (normalizeTitleKey(c.title) === titleKey) return { id: c.id, title: c.title };
    if (linkKey && c.link && normLink(c.link) === linkKey) return { id: c.id, title: c.title };
  }
  return null;
}

// ── id一意化（衝突回避の連番サフィックス） ────────────────────────

/** cases.json の id 上限文字数。toCaseId（pure.ts）の `.slice(0, 60)` と同じ上限を踏襲する。 */
const CASE_ID_MAX_LENGTH = 60;

/**
 * toCaseId の結果が既存id集合と衝突する場合に `-2`, `-3`... の連番で一意化する
 * （日本語タイトルはslug化で大半の文字が落ち、似たタイトルのid衝突→サムネイル上書き/
 * 詳細ページ衝突を招くための対策）。60字上限を超える場合はbase側を切り詰めて収める。
 */
export function ensureUniqueCaseId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate =
      baseId.length + suffix.length <= CASE_ID_MAX_LENGTH
        ? `${baseId}${suffix}`
        : `${baseId.slice(0, CASE_ID_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

// ── case-writer Agent応答 → WriterFields ────────────────────────

/**
 * case-writer Agentの応答（writerItem）をWriterFieldsへ変換する。
 * award は常に引数の verifiedAward（award-verifierによる照合済みの値）を採用し、
 * writerItem.award は一切参照しない（指摘2: writerが記事本文から未照合の受賞情報を
 * 再生成して最終エントリに紛れ込むのを防ぐ）。
 */
export function buildWriterFieldsFromAgentOutput(
  writerItem: Record<string, unknown>,
  tagVocab: TagVocabulary,
  verifiedAward: string,
): WriterFields {
  return {
    summary: typeof writerItem.summary === "string" ? writerItem.summary : "",
    categories: Array.isArray(writerItem.categories) ? (writerItem.categories as string[]) : [],
    award: verifiedAward,
    regions: Array.isArray(writerItem.regions) ? (writerItem.regions as string[]) : [],
    tags: filterTagsByVocabulary(writerItem.tags, tagVocab),
    overview: typeof writerItem.overview === "string" ? writerItem.overview : "",
    background: typeof writerItem.background === "string" ? writerItem.background : "",
    execution: typeof writerItem.execution === "string" ? writerItem.execution : "",
    evaluationImpact: typeof writerItem.evaluationImpact === "string" ? writerItem.evaluationImpact : "",
    relatedWorks: Array.isArray(writerItem.relatedWorks)
      ? (writerItem.relatedWorks as { title: string; description: string; url: string }[])
      : [],
  };
}

// ── cases.json エントリ組み立て ────────────────────────────────

export function buildAddCaseEntry(params: {
  id: string;
  title: string;
  client: string;
  agency: string;
  year: string | number;
  link: string;
  thumbnail: string;
  videoId: string;
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
    // DESIGN要件5: ユーザー由来の目印。今後の週次チューンアップの入力になる。
    sources: ["User"],
    tags: params.writer.tags,
  };
}

// ── commitメッセージ ────────────────────────────────────────────

export function buildAddCaseCommitMessage(title: string): string {
  return `Studio(LINE) 事例追加: ${title}`;
}
