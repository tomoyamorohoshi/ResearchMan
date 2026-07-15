/**
 * add-case パイプライン（LINEでURLを送ると事例が cases.json に追加される機能）の
 * 純粋関数群（ネットワーク/git/Agent SDKに触れない部分）。caseResearch.tsのpure.tsと
 * 役割分担は同じ（DESIGN: 実装依頼「LINEでURLを送ると事例が cases.json に追加される」）。
 */
import { normLink } from "../../../scripts/lib/norm-link.mjs";
import { filterTagsByVocabulary, normalizeTitleKey, type CaseEntry, type TagVocabulary, type WriterFields } from "./pure.js";
import {
  filterValidDomains,
  findPrimaryLink,
  isProxyUrl,
  isValidDateFormat,
  toTechId,
  type ExistingTechIndex,
  type RawTechCandidate,
  type RelatedWork,
  type TechLicense,
  type TechLink,
  type TechVocab,
  type ValidatedTechCandidate,
} from "./techPure.js";

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

export type AddCaseContentKind = "case" | "tech" | "neither";

/**
 * case-adder Agent応答の contentKind を解釈する（要件1: case/tech/neitherの自動振り分け）。
 * "case"/"tech" 以外（未指定・想定外の値）はすべて "neither" 扱いにする。isUsableCandidate と
 * 同じfail-closed方針で、判定不能な応答を見切り発車で "case" 等に倒さない。
 */
export function parseContentKind(obj: Record<string, unknown>): AddCaseContentKind {
  return obj.contentKind === "case" || obj.contentKind === "tech" ? obj.contentKind : "neither";
}

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

// ── case-adder Agent応答（contentKind:"tech"時）の解釈 ──────────────

/**
 * case-adder Agentの応答（contentKind:"tech"時）を techPure.RawTechCandidate 形式へ変換する。
 * verdictは常に"adopt"を強制する（add-caseは単一URL指定のため、techResearch.tsのような
 * 複数候補からの採否選別は存在しない。抽出できた1件を常に検証対象として扱い、書式・重複・
 * 語彙チェックはすべて validateAndDedupeTechCandidates（techPure.ts）に委ねる — 要件2）。
 */
export function parseExtractedTechCandidate(obj: Record<string, unknown>): RawTechCandidate {
  return {
    techName: obj.techName,
    org: obj.org,
    type: obj.type,
    domains: obj.domains,
    date: obj.date,
    links: obj.links,
    license: obj.license,
    summaryJa: obj.summaryJa,
    pointJa: obj.pointJa,
    detailJa: obj.detailJa,
    relatedWorks: obj.relatedWorks,
    thumbnailSource: obj.thumbnailSource,
    verdict: "adopt",
  };
}

// ── tech候補の検証（一次ソース欠如を許容するadd-case専用フォールバック） ────────

export interface TechCandidateFallbackResult {
  ok: true;
  value: ValidatedTechCandidate;
  /** falseなら一次ソース（github/project/product）が見つからず、送信URLをpostリンクとして採用した。 */
  primarySourceFound: boolean;
}

export interface TechCandidateFallbackFailure {
  ok: false;
  reason: string;
}

/**
 * tech候補（contentKind:"tech"）の検証（add-case専用）。
 *
 * 実際に起きた失敗: Xポスト（ソフトロボット研究紹介動画）を送信した際、case-adder Agentが
 * Web検索しても一次ソース（github/project/product）を見つけられず、
 * techPure.validateAndDedupeTechCandidates の「一次ソースが無ければ却下」に引っかかって
 * 「事例の追加に失敗しました」で終わっていた。日次バッチ収集（techResearch.ts）は複数候補から
 * 質の高いものだけを間引く前提のため一次ソース必須のままでよいが、add-case はユーザーが
 * 明示的に指定した単一URLが起点のため、一次ソースが見つからない場合でも失敗にはせず、
 * 送信されたURL（fallbackUrl）を kind:"post" のリンクとして採用してエントリを成立させる
 * （techPure.ts・techResearch.tsは日次バッチ側の共有ロジックのため無改変とし、この縮退は
 * addCasePure.ts側にのみ持つ）。
 *
 * 一次ソース欠如以外の検証項目（verdict/techName・id重複/タイトル重複/Case Study重複/
 * type語彙/domains語彙/date形式/org・summary・point必須/プロキシURL除外）は
 * techPure.validateAndDedupeTechCandidates と同じ基準で却下する（品質バーは変えない）。
 */
export function validateTechCandidateAllowingFallbackSource(
  raw: RawTechCandidate,
  vocab: TechVocab,
  existingTech: ExistingTechIndex,
  existingCaseTitleKeys: Set<string>,
  fallbackUrl: string,
): TechCandidateFallbackResult | TechCandidateFallbackFailure {
  const techName = typeof raw.techName === "string" && raw.techName.trim() ? raw.techName.trim() : "";
  const id = toTechId(techName);

  if (raw.verdict !== "adopt" && raw.verdict !== "adopt-adjusted") {
    return { ok: false, reason: `verdictがadoptではありません: ${String(raw.verdict)}` };
  }
  if (!techName || !id) {
    return { ok: false, reason: "techNameが不正です" };
  }
  const titleKey = normalizeTitleKey(techName);

  if (existingTech.ids.has(id)) {
    return { ok: false, reason: "既存tech.jsonまたは今回内でidが重複" };
  }
  if (existingTech.titleKeys.has(titleKey)) {
    return { ok: false, reason: "既存tech.jsonまたは今回内でタイトルが重複" };
  }
  if (existingCaseTitleKeys.has(titleKey)) {
    return { ok: false, reason: "Case Studyとタイトルが重複" };
  }

  const type = typeof raw.type === "string" ? raw.type : "";
  if (!vocab.Type.includes(type)) {
    return { ok: false, reason: `不正type: ${type}` };
  }

  const domains = filterValidDomains(raw.domains, vocab);
  if (domains.length === 0) {
    return { ok: false, reason: "有効なdomainがありません" };
  }

  if (!isValidDateFormat(raw.date)) {
    return { ok: false, reason: `不正なdate形式: ${String(raw.date)}` };
  }

  const org = typeof raw.org === "string" && raw.org.trim() ? raw.org.trim() : "";
  const summary = typeof raw.summaryJa === "string" && raw.summaryJa.trim() ? raw.summaryJa.trim() : "";
  const point = typeof raw.pointJa === "string" && raw.pointJa.trim() ? raw.pointJa.trim() : "";
  if (!org || !summary || !point) {
    return { ok: false, reason: "org/summary/pointのいずれかが空です" };
  }
  const detail = typeof raw.detailJa === "string" && raw.detailJa.trim() ? raw.detailJa.trim() : undefined;

  const linksRaw = Array.isArray(raw.links) ? raw.links : [];
  let links: TechLink[] = linksRaw
    .filter((l): l is { kind: unknown; url: unknown } => !!l && typeof l === "object")
    .map((l) => ({ kind: String((l as { kind: unknown }).kind ?? ""), url: String((l as { url: unknown }).url ?? "") }))
    .filter((l) => l.kind && l.url);

  const proxyLink = links.find((l) => isProxyUrl(l.url));
  if (proxyLink) {
    return { ok: false, reason: `プロキシURLが混入: ${proxyLink.url}` };
  }

  const primarySourceFound = !!findPrimaryLink(links);
  if (!primarySourceFound && !links.some((l) => l.url === fallbackUrl)) {
    // 要件1: 一次ソースが見つからない場合の縮退。TechLink["kind"]の語彙（src/lib/tech.ts）に
    // "article"は無く、既存tech.jsonでもXポストの単独リンクは"post"を使っているため、
    // 記事URLも含めてここでは"post"に統一する。
    links = [...links, { kind: "post", url: fallbackUrl }];
  }

  const licenseRaw = raw.license && typeof raw.license === "object" ? (raw.license as Record<string, unknown>) : {};
  const license: TechLicense = {
    spdx: typeof licenseRaw.spdx === "string" ? licenseRaw.spdx : null,
    commercial: typeof licenseRaw.commercial === "string" ? licenseRaw.commercial : "none",
    ...(typeof licenseRaw.note === "string" && licenseRaw.note.trim() ? { note: licenseRaw.note.trim() } : {}),
  };

  const relatedWorksRaw = Array.isArray(raw.relatedWorks) ? raw.relatedWorks : [];
  const relatedWorks: RelatedWork[] = relatedWorksRaw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      description: typeof r.description === "string" ? r.description : "",
      url: typeof r.url === "string" ? r.url : "",
    }));

  const thumbnailFallback = findPrimaryLink(links)?.url ?? fallbackUrl;
  const thumbnailSource =
    typeof raw.thumbnailSource === "string" && raw.thumbnailSource.trim() ? raw.thumbnailSource.trim() : thumbnailFallback;

  return {
    ok: true,
    primarySourceFound,
    value: {
      id,
      title: techName,
      org,
      type,
      domains,
      date: raw.date as string,
      year: (raw.date as string).slice(0, 4),
      summary,
      point,
      ...(detail ? { detail } : {}),
      license,
      links,
      thumbnailSource,
      relatedWorks,
    },
  };
}

/**
 * tech重複時のLINE案内文言（buildAddCaseDuplicateText）に使う「既存側のタイトル」を探す。
 * validateAndDedupeTechCandidatesの却下理由には新規候補側のid/techNameしか含まれず、既存
 * tech.json側の表示名は分からないため、findDuplicateCase（Case Study側）と同じ
 * 「利用者には既存エントリのタイトルを見せる」体験に合わせるための専用ルックアップ。
 * 見つからなければnull（呼び出し側で候補自身のtechNameへフォールバックすること）。
 */
export function findExistingTechTitle(
  candidateTechName: string,
  existingTech: Array<{ id: string; title: string }>,
): string | null {
  const id = toTechId(candidateTechName);
  const titleKey = normalizeTitleKey(candidateTechName);
  for (const t of existingTech) {
    if (t.id === id || normalizeTitleKey(t.title) === titleKey) return t.title;
  }
  return null;
}

/**
 * tech候補が「Case Studyとタイトルが重複」で却下された場合の既存側タイトル探索
 * （レビュー指摘: この却下理由はcases.json側との衝突のため、findExistingTechTitle
 * （tech.json専用）で探しても当然見つからず、案内が候補自身の名前へフォールバックして
 * 不正確になっていた）。tech.json用のtoTechId相当のid突き合わせはせず、cases.json側の
 * id体系（toCaseId、client/year込み）とは無関係なタイトル一致のみで探す。
 * 見つからなければnull（呼び出し側で候補自身のtechNameへフォールバックすること）。
 */
export function findExistingCaseTitleForTech(
  candidateTechName: string,
  existingCases: Array<{ id: string; title: string }>,
): string | null {
  const titleKey = normalizeTitleKey(candidateTechName);
  for (const c of existingCases) {
    if (normalizeTitleKey(c.title) === titleKey) return c.title;
  }
  return null;
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

/** cases.json/tech.json の id 上限文字数。toCaseId・toTechId（techPure.ts）双方の
 * `.slice(0, 60)` と同じ上限を踏襲する。 */
const ID_MAX_LENGTH = 60;

/**
 * baseId が既存id集合と衝突する場合に `-2`, `-3`... の連番で一意化する（日本語タイトルは
 * slug化で大半の文字が落ち、似たタイトルのid衝突→サムネイル上書き/詳細ページ衝突を招く
 * ための対策）。60字上限を超える場合はbase側を切り詰めて収める。
 * ensureUniqueCaseId・ensureUniqueTechId（要件5: 同じid衝突ガード方針をtech側にも適用）の
 * 共通実装。
 */
function ensureUniqueId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate =
      baseId.length + suffix.length <= ID_MAX_LENGTH
        ? `${baseId}${suffix}`
        : `${baseId.slice(0, ID_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

export function ensureUniqueCaseId(baseId: string, existingIds: Set<string>): string {
  return ensureUniqueId(baseId, existingIds);
}

/**
 * tech.json版のensureUniqueCaseId（要件5）。validateAndDedupeTechCandidates（techPure.ts）は
 * 既存idとの衝突を「重複」として却下するため、通常はこの関数に到達する時点でidは既に
 * 非衝突のはずだが、case側と同じ防御方針を明示的に適用しておく（将来の呼び出し順変更等に
 * 対する保険）。
 */
export function ensureUniqueTechId(baseId: string, existingIds: Set<string>): string {
  return ensureUniqueId(baseId, existingIds);
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

/**
 * add-case（tech振り分け時）専用のcommitメッセージ。techPure.buildTechCommitMessageは
 * Research(Technology)の日次バッチ収集と同一文言「Studio research: <title> 1件追加
 * (Technology)」になり、LINE経由の単発追加とgit履歴上で区別できない（レビュー指摘）。
 * buildAddCaseCommitMessage（case側）に倣い、tech側にも専用文言を用意する。
 */
export function buildAddTechCommitMessage(title: string): string {
  return `Studio(LINE) 技術追加: ${title}`;
}
