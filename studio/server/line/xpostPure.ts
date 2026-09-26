/**
 * LINE「X投稿」タブの純粋関数群（I/O・Claude呼び出しはstudio/server/pipeline/xpost.tsが行う）。
 * 設計: docs/X_POST_DRAFTS_DESIGN.md（v2）/ 生成仕様: docs/X_POST_RESEARCH.md セクションC。
 */

// ── URL→(kind,id) 解析 ──────────────────────────────────────────────

export type XPostEntryKind = "case" | "tech";

export interface ParsedXPostUrl {
  kind: XPostEntryKind;
  id: string;
}

// RMの事例/技術ページのみ受理する。www.無し・パス末尾のスラッシュ/クエリ/ハッシュは許容する。
// 他ホスト（プレビュードメイン等）・httpは不可（DESIGN合意: "www.無し前提、プレビュー等別ホストは不可"）。
const XPOST_URL_RE = /^https:\/\/research-man\.vercel\.app\/(cases|technology)\/([^/?#]+)\/?(?:[?#].*)?$/;

const FIRST_URL_RE = /https?:\/\/\S+/;

/**
 * テキストからRMの事例/技術ページURLを1件だけ抽出し、種別とidを返す。
 * テキスト中に他の語が混在していても最初のURLらしき部分を候補として検査する。
 * RM以外のURL・存在し得ない形式・URLが見つからない場合はnull。
 */
export function parseXPostUrl(input: string): ParsedXPostUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(FIRST_URL_RE);
  const candidate = m ? m[0] : trimmed;
  const match = candidate.match(XPOST_URL_RE);
  if (!match) return null;
  const [, segment, id] = match;
  if (!id) return null;
  return { kind: segment === "cases" ? "case" : "tech", id };
}

// ── X加重文字数（CJK=2・その他=1・URL=23。X_POST_RESEARCH.md A1） ────────

const URL_RE_G = /https?:\/\/\S+/g;

/** CJK統合漢字・かな・全角記号等を2、それ以外を1として数える（絵文字等の細かい例外は扱わない=設計の近似に合わせる）。 */
function isWideChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x3000 && code <= 0x30ff) || // 全角記号・ひらがな・カタカナ
    (code >= 0x3400 && code <= 0x4dbf) || // CJK拡張A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK統合漢字
    (code >= 0xf900 && code <= 0xfaff) || // CJK互換漢字
    (code >= 0xff00 && code <= 0xffef) || // 全角形
    (code >= 0x20000 && code <= 0x2ffff) // CJK拡張B以降
  );
}

function weightedPlainLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += isWideChar(ch) ? 2 : 1;
  }
  return n;
}

/** X仕様の加重文字数（URLは実際の長さに関わらず23固定）。 */
export function xWeightedLength(text: string): number {
  let total = 0;
  let lastIndex = 0;
  for (const m of text.matchAll(URL_RE_G)) {
    const idx = m.index ?? 0;
    total += weightedPlainLength(text.slice(lastIndex, idx));
    total += 23;
    lastIndex = idx + m[0].length;
  }
  total += weightedPlainLength(text.slice(lastIndex));
  return total;
}

// ── LLM生成JSONの検証 ────────────────────────────────────────────────

export interface XPostDraft {
  postA: string;
  postB: string;
}

/** 1件の引用根拠（LLM出力のclaims配列の要素）。 */
export interface XPostClaim {
  /** 引用元フィールド名（entryFieldsのキーと一致させる。例: "summary","overview","execution"）。 */
  sourceField: string;
  /** 引用元フィールドから逐語引用した部分文字列（改行・空白の差異は正規化して比較する）。 */
  quote: string;
}

export type XPostValidationResult = { ok: true; value: XPostDraft } | { ok: false; error: string };

const URL_IN_BODY_RE = /https?:\/\//;
const MAX_WEIGHTED_LENGTH = 280;
/** レビュー指摘（2026-09-27）: フック行/本文/締めを改行で区切ること（最低2箇所の改行）。 */
const MIN_LINE_BREAKS = 2;

/** 引用照合のための緩い正規化（連続する空白・改行を単一の半角スペースに畳み、前後を除去）。 */
function normalizeForQuoteCheck(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * 1件分（postA/postB片方）の {text, claims} を検証する。
 * - textが非空文字列であること
 * - 本文にURLを含まないこと（X_POST_RESEARCH.md A3/C5: リンクはセルフリプライに置く）
 * - X加重文字数が280以下であること
 * - 改行が最低2箇所あること（レビュー指摘: フック行/本文/締めの3ブロック構成を強制する）
 * - claimsが1件以上あり、各claimのsourceFieldがentryFieldsに存在し、quoteが
 *   （空白正規化のうえ）そのフィールドの逐語部分文字列であること
 *   （レビュー指摘: 事実歪曲防止の機械的ガード。データに無い事実の追加を防ぐ）
 */
function validateSinglePost(label: string, raw: unknown, entryFields: Record<string, string>): { ok: true; text: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: `${label}がオブジェクトではありませんでした` };
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text) return { ok: false, error: `${label}.textが生成されませんでした` };
  if (URL_IN_BODY_RE.test(text)) return { ok: false, error: `${label}の本文にURLが含まれています` };
  const len = xWeightedLength(text);
  if (len > MAX_WEIGHTED_LENGTH) return { ok: false, error: `${label}が加重${len}文字で${MAX_WEIGHTED_LENGTH}文字を超えています` };
  const lineBreaks = (text.match(/\n/g) ?? []).length;
  if (lineBreaks < MIN_LINE_BREAKS) {
    return { ok: false, error: `${label}の改行が${lineBreaks}箇所しかありません（フック行/本文/締めを改行で区切ってください。最低${MIN_LINE_BREAKS}箇所必要）` };
  }

  const claims = Array.isArray(r.claims) ? r.claims : null;
  if (!claims || claims.length === 0) {
    return { ok: false, error: `${label}.claimsが空です（根拠となる引用を最低1件含めてください）` };
  }
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") return { ok: false, error: `${label}.claimsの要素が不正です` };
    const c = claim as Record<string, unknown>;
    const sourceField = typeof c.sourceField === "string" ? c.sourceField : "";
    const quote = typeof c.quote === "string" ? c.quote.trim() : "";
    if (!sourceField || !quote) return { ok: false, error: `${label}.claimsにsourceField/quoteが不足しています` };
    const fieldText = entryFields[sourceField];
    if (fieldText === undefined) return { ok: false, error: `${label}.claimsのsourceField「${sourceField}」は事実データに存在しません` };
    if (!normalizeForQuoteCheck(fieldText).includes(normalizeForQuoteCheck(quote))) {
      return { ok: false, error: `${label}.claimsの引用「${quote}」がsourceField「${sourceField}」の原文に見つかりません（事実歪曲・捏造の疑い）` };
    }
  }

  return { ok: true, text };
}

/**
 * Claude応答から抽出したJSONオブジェクトを検証する。期待する形は
 * {"postA": {"text": "...", "claims": [{"sourceField": "...", "quote": "..."}]}, "postB": {...}}。
 * entryFieldsはプロンプトに渡した事実データのフィールド名→原文のマップで、claimsの引用が
 * 実在するかの照合に使う（レビュー指摘の機械的ガード）。
 */
export function validateXPostDraft(obj: unknown, entryFields: Record<string, string>): XPostValidationResult {
  if (!obj || typeof obj !== "object") return { ok: false, error: "生成結果がJSONオブジェクトではありませんでした" };
  const o = obj as Record<string, unknown>;

  const a = validateSinglePost("postA", o.postA, entryFields);
  if (!a.ok) return a;
  const b = validateSinglePost("postB", o.postB, entryFields);
  if (!b.ok) return b;

  return { ok: true, value: { postA: a.text, postB: b.text } };
}

// ── 吹き出し組み立て ─────────────────────────────────────────────────

export type LineMessage = { type: "text"; text: string } | { type: "image"; originalContentUrl: string; previewImageUrl: string };

export interface XPostSourceInfo {
  /** RM側の事例/技術ページURL。 */
  rmUrl: string;
  /** 一次ソースURL（cases.json/tech.jsonのlink等）。無ければ省略。 */
  sourceUrl?: string;
  /** 事例のYouTube動画 / 技術のvideoリンクがある場合のURL。 */
  videoUrl?: string;
  /** サムネイル画像URL（本番200確認済みの場合のみ渡す想定。呼び出し側の責務）。 */
  thumbnailUrl?: string;
}

/** 画像吹き出しを省略した場合にセルフリプライへ追記する注記（レビュー追加分・2026-09-27）。 */
export const IMAGE_OMITTED_NOTE =
  "※サムネイル画像を取得できなかったため画像は省略しました（RMページの画像を手動で保存してください）";

/** 動画の再利用ガイダンス（メモ吹き出しに入れる。本文には含めない）。 */
const VIDEO_REUSE_GUIDANCE = "動画は公式のものです。ダウンロード・再アップロードはせず、リンク・引用でご紹介ください。";

/**
 * 吹き出し③（セルフリプライ用テキスト）。Xにそのまま貼り付けられる体裁のみを含む
 * （案内文・注記は一切含めない。レビュー指摘: セルフリプライはpaste-readyであること）。
 * フォーマット:
 *   詳しくはこちら
 *   {RM URL}
 *   （動画があれば）公式動画
 *   {video URL}
 *   （動画が無く一次ソースがあれば）出典
 *   {source URL}
 * 動画がある場合は一次ソースの表示を省略する（優先順位: video > source。同一URLの重複表示を
 * 避けるための単純化）。
 */
export function buildSelfReplyBubbleText(info: XPostSourceInfo): string {
  const lines = ["詳しくはこちら", info.rmUrl];
  if (info.videoUrl) {
    lines.push("公式動画", info.videoUrl);
  } else if (info.sourceUrl) {
    lines.push("出典", info.sourceUrl);
  }
  return lines.join("\n");
}

/**
 * 吹き出し最終（メモ。「📝メモ（投稿には含めない）」プレフィックス）。
 * 動画の転載禁止ガイダンス・画像省略の注記など、Xへの投稿には含めるべきでない運用メモを
 * まとめる（レビュー指摘: セルフリプライ本文から分離する）。何も無ければnullを返す
 * （＝メモ吹き出し自体を作らない）。
 */
export function buildMetaBubbleText(info: XPostSourceInfo, imageOmitted: boolean): string | null {
  const notes: string[] = [];
  if (info.videoUrl) notes.push(VIDEO_REUSE_GUIDANCE);
  if (imageOmitted) notes.push(IMAGE_OMITTED_NOTE);
  if (notes.length === 0) return null;
  return ["📝メモ（投稿には含めない）", ...notes].join("\n");
}

/**
 * 吹き出しを組み立てる（最大5件）: ①投稿文案A ②投稿文案B ③セルフリプライ（paste-ready）
 * ④画像（あれば） ⑤メモ（動画転載禁止ガイダンス・画像省略注記があれば、常に最後）。
 * includeImage=falseまたはthumbnailUrl未指定（空文字・空白のみを含む）なら画像吹き出しを
 * 省略し、メモ吹き出し側に省略した旨の注記を追記する。
 */
export function buildXPostBubbles(draft: XPostDraft, info: XPostSourceInfo, includeImage: boolean): LineMessage[] {
  const hasThumbnail = !!info.thumbnailUrl && info.thumbnailUrl.trim() !== "";
  const showImage = includeImage && hasThumbnail;
  const messages: LineMessage[] = [
    { type: "text", text: draft.postA },
    { type: "text", text: draft.postB },
    { type: "text", text: buildSelfReplyBubbleText(info) },
  ];
  if (showImage) {
    messages.push({ type: "image", originalContentUrl: info.thumbnailUrl!, previewImageUrl: info.thumbnailUrl! });
  }
  const metaText = buildMetaBubbleText(info, !showImage);
  if (metaText) messages.push({ type: "text", text: metaText });
  return messages.slice(0, 5);
}
