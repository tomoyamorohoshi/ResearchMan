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

export type XPostValidationResult = { ok: true; value: XPostDraft } | { ok: false; error: string };

const URL_IN_BODY_RE = /https?:\/\//;
const MAX_WEIGHTED_LENGTH = 280;

/**
 * Claude応答から抽出したJSONオブジェクトを検証する。
 * - postA/postBが非空文字列であること
 * - 本文にURLを含まないこと（X_POST_RESEARCH.md A3/C5: リンクはセルフリプライに置く）
 * - X加重文字数が280以下であること
 */
export function validateXPostDraft(obj: unknown): XPostValidationResult {
  if (!obj || typeof obj !== "object") return { ok: false, error: "生成結果がJSONオブジェクトではありませんでした" };
  const o = obj as Record<string, unknown>;
  const postA = typeof o.postA === "string" ? o.postA.trim() : "";
  const postB = typeof o.postB === "string" ? o.postB.trim() : "";
  if (!postA) return { ok: false, error: "postAが生成されませんでした" };
  if (!postB) return { ok: false, error: "postBが生成されませんでした" };

  for (const [label, text] of [
    ["postA", postA],
    ["postB", postB],
  ] as const) {
    if (URL_IN_BODY_RE.test(text)) return { ok: false, error: `${label}の本文にURLが含まれています` };
    const len = xWeightedLength(text);
    if (len > MAX_WEIGHTED_LENGTH) return { ok: false, error: `${label}が加重${len}文字で${MAX_WEIGHTED_LENGTH}文字を超えています` };
  }

  return { ok: true, value: { postA, postB } };
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

/**
 * URLをゆるく正規化して比較用の文字列にする（末尾スラッシュ・www.の有無を無視し、
 * YouTubeのyoutu.be/youtube.com/watch?v=/embed形式は動画idベースで同一視する）。
 * パース不能な文字列は末尾スラッシュだけ除いてそのまま比較に使う（fail-open。
 * 誤って別URL扱いになっても実害は「重複表示される」だけで安全側）。
 */
function normalizeUrlForCompare(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const pathname = parsed.pathname.replace(/\/+$/, "");

  let videoId: string | null = null;
  if (host === "youtu.be") {
    videoId = pathname.slice(1) || null;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (pathname === "/watch") videoId = parsed.searchParams.get("v");
    else if (pathname.startsWith("/embed/")) videoId = pathname.slice("/embed/".length);
  }
  if (videoId) return `youtube-video:${videoId}`;

  return `${host}${pathname}`;
}

/** 2つのURLが（正規化のうえ）同一の対象を指しているか。どちらか未指定ならfalse。 */
function urlsEquivalent(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeUrlForCompare(a) === normalizeUrlForCompare(b);
}

/**
 * 吹き出し③（セルフリプライ用テキスト）。RMページURL＋一次ソースURL＋（あれば）動画注記。
 * sourceUrlとvideoUrlが（正規化のうえ）同一URLを指す場合は「一次ソース:」行を省略し、
 * 「動画:」行だけを表示する（レビュー指摘: 同じURLを2回貼らない）。
 * imageOmitted=trueなら末尾に画像省略の注記を追記する（レビュー指摘: サムネイルが省略された
 * ことをユーザーに伝える。DESIGN合意「本番で200を確認できない場合は省略し注記」の実装箇所）。
 */
export function buildReplyBubbleText(info: XPostSourceInfo, imageOmitted: boolean): string {
  const lines = [`RMページ: ${info.rmUrl}`];
  const sourceIsSameAsVideo = urlsEquivalent(info.sourceUrl, info.videoUrl);
  if (info.sourceUrl && !sourceIsSameAsVideo) lines.push(`一次ソース: ${info.sourceUrl}`);
  if (info.videoUrl) {
    lines.push(`動画: ${info.videoUrl}（公式動画。Xへは引用・リンクで紹介。ダウンロード転載はしない）`);
  }
  if (imageOmitted) lines.push(IMAGE_OMITTED_NOTE);
  return lines.join("\n");
}

/**
 * 吹き出し①〜④（投稿文案A/案B/セルフリプライ用テキスト/画像）を組み立てる。
 * includeImage=falseまたはthumbnailUrl未指定（空文字・空白のみを含む）なら画像吹き出しを
 * 省略し、セルフリプライ側に省略した旨の注記を追記する（DESIGN合意＋レビュー指摘）。
 * 最大5吹き出しに切り詰める（本関数の出力は4件のため実質no-op。将来の拡張に備えたガード）。
 */
export function buildXPostBubbles(draft: XPostDraft, info: XPostSourceInfo, includeImage: boolean): LineMessage[] {
  const hasThumbnail = !!info.thumbnailUrl && info.thumbnailUrl.trim() !== "";
  const showImage = includeImage && hasThumbnail;
  const messages: LineMessage[] = [
    { type: "text", text: draft.postA },
    { type: "text", text: draft.postB },
    { type: "text", text: buildReplyBubbleText(info, !showImage) },
  ];
  if (showImage) {
    messages.push({ type: "image", originalContentUrl: info.thumbnailUrl!, previewImageUrl: info.thumbnailUrl! });
  }
  return messages.slice(0, 5);
}
