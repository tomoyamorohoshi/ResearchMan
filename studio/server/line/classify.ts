/**
 * LINEメッセージ本文の先頭キーワードによる種別判定・OK/キャンセル判定（純粋関数のみ）。
 * DESIGN.md相当の「LINEで依頼」機能の書式:
 *   「調べて …」→ Research(Case Study) / 「技術調べて …」→ Research(Technology) /
 *   「アイデア …」→ idea
 *
 * 「両方調べて」ショートカット（kind:"両方"）はAWARDS追加に伴いLINEから廃止した
 * （メニュー3番をAWARDSに置き換えたため。pure.ts側のkind:"両方"・combinedResearch.ts自体は
 * API互換のため無改変で残す＝LINEから到達不能になるだけ）。
 */
import type { ResearchKind } from "../pipeline/pure.js";

export type LineRequestKind = ResearchKind | "idea" | "awards";

export interface ClassifiedRequest {
  kind: LineRequestKind;
  /** キーワードを除いた残りの自由文（前後空白は除去済み）。 */
  rest: string;
}

// 「技術調べて」は「調べて」を部分文字列として含まないため、判定順序自体は本来どの順でも
// startsWith一致する（「調べて」は先頭ではなく末尾に来るため）。ただし将来キーワードが
// 増えても事故らないよう、より具体的な語を先に置く方針を維持する。
const KEYWORD_RULES: Array<{ prefix: string; kind: LineRequestKind }> = [
  { prefix: "技術調べて", kind: "Technology" },
  { prefix: "調べて", kind: "Case Study" },
  { prefix: "アイデア", kind: "idea" },
];

/** 先頭キーワードから種別と残りの自由文を判定する。どれにも一致しなければ null。 */
export function classifyRequestText(text: string): ClassifiedRequest | null {
  const trimmed = text.trim();
  for (const rule of KEYWORD_RULES) {
    if (trimmed.startsWith(rule.prefix)) {
      return { kind: rule.kind, rest: trimmed.slice(rule.prefix.length).trim() };
    }
  }
  return null;
}

const OK_TEXTS = new Set(["ok", "ok!", "おけ", "実行"]);

/** 「OK/ok/OK！/おけ/実行」のいずれかに（大小文字・全角！を正規化のうえ）完全一致するか。 */
export function isOkText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/！/g, "!");
  return OK_TEXTS.has(normalized);
}

const CANCEL_TEXTS = new Set(["キャンセル", "やめる"]);

/** 「キャンセル/やめる」のいずれかに完全一致するか。全状態で有効（ウィザードの途中でも中断できる）。 */
export function isCancelText(text: string): boolean {
  return CANCEL_TEXTS.has(text.trim());
}

const RESUME_TEXTS = new Set(["再開"]);

/**
 * 「再開」に完全一致するか。isCancelTextと同じく全状態で有効な予約語として扱う
 * （webhook.ts側でstepWizardより前に判定し、予算超過で一時停止中のAWARDSジョブを
 * 再開する。要件A.3・D.3）。
 */
export function isResumeText(text: string): boolean {
  return RESUME_TEXTS.has(text.trim());
}

// ── ウィザード用: メニュー選択・y/n判定（対話ウィザード拡張） ──────────────

/** 全角数字を半角へ正規化する（メニュー番号・件数入力の表記ゆれ吸収）。 */
export function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const MENU_SELECTION_RULES: Array<{ kind: LineRequestKind; words: string[] }> = [
  { kind: "Case Study", words: ["1", "①", "事例調査", "事例"] },
  { kind: "Technology", words: ["2", "②", "技術調査", "技術"] },
  // メニュー3番は「事例+技術」からAWARDSに置換（要件A.1）。キーワード「アワード」単独でも
  // ここに一致させることで、要件A.3「キーワード『アワード』でも質問1から開始」を
  // 追加の分岐無しで満たす（wizard.ts::stepIdle は matchMenuSelection を最初に判定するため）。
  { kind: "awards", words: ["3", "③", "AWARDS", "アワード"] },
  { kind: "idea", words: ["4", "④", "アイデア出し", "アイデア"] },
];

/**
 * メニュー選択（番号・丸数字・種別名。リッチメニューのボタン文言もここに含む）の完全一致判定。
 * idle/menu状態でのみ使う。他の進行中状態（await_theme等）では入力をその状態の意味として
 * 解釈するため、ここでの判定結果を使わない（誤爆防止。webhook.tsのstepWizard呼び出し側の責務）。
 */
export function matchMenuSelection(text: string): LineRequestKind | null {
  const normalized = normalizeDigits(text.trim());
  for (const rule of MENU_SELECTION_RULES) {
    if (rule.words.includes(normalized)) return rule.kind;
  }
  return null;
}

const AFFIRMATIVE_TEXTS = new Set(["y", "yes", "はい", "ok", "ok!", "おけ", "いいです", "実行"]);

/** 「y/Y/yes/はい/OK/おけ/いいです」等の肯定応答（大小文字・全角！を正規化のうえ完全一致）。 */
export function isAffirmativeText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/！/g, "!");
  return AFFIRMATIVE_TEXTS.has(normalized);
}

const NEGATIVE_TEXTS = new Set(["n", "no", "いいえ", "ちがう", "直す"]);

/** 「n/N/no/いいえ/ちがう/直す」等の否定応答（完全一致）。 */
export function isNegativeText(text: string): boolean {
  return NEGATIVE_TEXTS.has(text.trim().toLowerCase());
}

// ── 事例追加（LINEでURLを送ると事例が cases.json に追加される機能） ─────────

export interface AddCaseTextRequest {
  /** 対象URL（複数含まれていた場合は最初の1件）。 */
  url: string;
  /** URL以外の残りテキスト（視点・メモとしてパイプラインに渡す補足コンテキスト）。 */
  context: string;
}

const ADD_CASE_URL_RE = /https?:\/\/\S+/;

// JSの`\s`は全角スペース（　）にはマッチするが、全角句読点・全角括弧・CJK文字には
// マッチしないため、URLマッチ（\S+）がこれらを巻き込んでしまう（指摘4）。この正規表現で
// マッチ文字列中の最初の該当位置を検出し、そこでURLを切り詰める。
const FULLWIDTH_OR_CJK_RE = /[　-〿぀-ゟ゠-ヿ一-鿿＀-￯]/;

/**
 * 既存キーワード（「調べて」等）に一致しないテキストからURLを抽出し、事例追加依頼として
 * 解釈する（wizard.ts::stepIdle が既存キーワード判定の後段で呼ぶ。呼び出し順で優先度を
 * 担保するため、この関数自体はキーワードの有無を考慮しない）。
 */
export function extractAddCaseRequest(text: string): AddCaseTextRequest | null {
  const trimmed = text.trim();
  const m = trimmed.match(ADD_CASE_URL_RE);
  if (!m || m.index === undefined) return null;
  const rawMatch = m[0];
  const cutIdx = rawMatch.search(FULLWIDTH_OR_CJK_RE);
  const url = cutIdx === -1 ? rawMatch : rawMatch.slice(0, cutIdx);
  // 切り詰めた残り（全角記号・CJK文字以降）は情報を失わずcontext側に含める。
  const trailing = cutIdx === -1 ? "" : rawMatch.slice(cutIdx);
  const context = (trimmed.slice(0, m.index) + " " + trailing + " " + trimmed.slice(m.index + rawMatch.length))
    .replace(/\s+/g, " ")
    .trim();
  return { url, context };
}
