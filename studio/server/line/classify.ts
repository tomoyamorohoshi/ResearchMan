/**
 * LINEメッセージ本文の先頭キーワードによる種別判定・OK/キャンセル判定（純粋関数のみ）。
 * DESIGN.md相当の「LINEで依頼」機能の書式:
 *   「調べて …」→ Research(Case Study) / 「技術調べて …」→ Research(Technology) /
 *   「両方調べて …」→ Research(両方) / 「アイデア …」→ idea
 */
import type { ResearchKind } from "../pipeline/pure.js";

export type LineRequestKind = ResearchKind | "idea";

export interface ClassifiedRequest {
  kind: LineRequestKind;
  /** キーワードを除いた残りの自由文（前後空白は除去済み）。 */
  rest: string;
}

// 「両方調べて」「技術調べて」は「調べて」を部分文字列として含まないため、判定順序自体は
// 本来どの順でもstartsWith一致する（「調べて」は先頭ではなく末尾に来るため）。ただし将来
// キーワードが増えても事故らないよう、より具体的な語を先に置く方針を維持する。
const KEYWORD_RULES: Array<{ prefix: string; kind: LineRequestKind }> = [
  { prefix: "両方調べて", kind: "両方" },
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

// ── ウィザード用: メニュー選択・y/n判定（対話ウィザード拡張） ──────────────

/** 全角数字を半角へ正規化する（メニュー番号・件数入力の表記ゆれ吸収）。 */
export function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const MENU_SELECTION_RULES: Array<{ kind: LineRequestKind; words: string[] }> = [
  { kind: "Case Study", words: ["1", "①", "事例調査", "事例"] },
  { kind: "Technology", words: ["2", "②", "技術調査", "技術"] },
  { kind: "両方", words: ["3", "③", "事例+技術", "事例＋技術", "両方"] },
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
