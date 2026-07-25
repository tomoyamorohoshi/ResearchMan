/**
 * ページ本文の事前取得（curlフォールバック付き）。add-case パイプラインが case-adder /
 * link-checker Agentへ渡す前に、bot対策サイト（dezeen.com等）向けの救済として使う。
 *
 * 背景: case-adder/link-checker Agentは自身のWebFetchツールでURLを取得するが、
 * Cloudflare等のTLSフィンガープリント判定でNode/undici系のfetchにだけ403やチャレンジ
 * ページ（"Just a moment..."）を返すサイトがあり、同一UAでもcurl.exeなら200が取れる
 * ことを実測済み（dezeen.com等。scripts/save-thumbnail.mjsで先行実装・実証済みの手法）。
 * scripts/側は無改変の方針のため、同じ考え方をstudio側のTSとして独立実装する。
 *
 * ここで事前取得できた本文は addCasePrompts.ts / prompts.ts が「機械取得済みの本文」として
 * プロンプトに埋め込み、Agent自身のWebFetch再取得を不要にする（xMedia.ts::fetchTweetMedia
 * をX投稿以外のURLにも一般化した位置づけ。既存のtweetMedia注入パターンと同じく、
 * 取得できなければ何も注入せずAgent自身のWebFetchに完全フォールバックする）。
 *
 * 純粋関数（isChallengeResponse/isHtmlContentType/parseCurlOutput/htmlToText）はここで
 * 単体テストする。実際のネットワークI/O（fetchPageWithFallback等）はthumbnail.ts/xMedia.ts
 * と同じ理由で自動テスト対象外。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const NODE_FETCH_TIMEOUT_MS = 10_000;
const CURL_MAX_TIME_SEC = 15;
const CURL_KILL_TIMEOUT_MS = 20_000;
/** Agentプロンプトに埋め込む本文の上限文字数（コスト・コンテキスト圧迫を避ける）。 */
export const PAGE_TEXT_MAX_CHARS = 8000;
/**
 * curlの `-w` 出力で本文の末尾に埋め込むHTTPステータスコードの区切りマーカー。
 * curl経路（--fail無し）は4xx/5xxでも終了コード0で本文を返すため、Node直接取得と同じく
 * isChallengeResponseでステータス・チャレンジ本文を検証する必要がある（さもないと死リンク
 * ページの本文を「信頼してよい本文」としてAgentに注入し、alive:true誤判定を招く）。
 */
export const CURL_STATUS_MARKER = "\n__RM_CURL_HTTP_STATUS__:";

/**
 * ステータス/本文からCloudflare等のチャレンジページかどうかを判定する（純粋関数）。
 * save-thumbnail.mjs::isChallengeResponseと同じ判定思想。
 */
export function isChallengeResponse(status: number, html: string): boolean {
  if (typeof status === "number" && status >= 400) return true;
  const body = html || "";
  return /just a moment/i.test(body) || /cf-chl|cf_chl|challenge-platform|cf-browser-verification/i.test(body);
}

/**
 * Content-TypeがHTMLとして扱ってよいかを判定する（純粋関数）。PDF・画像等のバイナリを
 * htmlToTextに通してAgentへ誤って埋め込まないための事前検査（Node直接取得経路専用。
 * curl経路はcontent-type取得が複雑になるため対象外＝指摘3は最小対応）。
 * ヘッダ取得不能・空の場合は判定不能として従来通りスキップしない（true）。
 */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  return /text\/html/i.test(contentType);
}

/**
 * curlの `-w` 出力（本文の末尾にHTTPステータスコードを埋め込んだもの）を分離する（純粋関数）。
 * マーカーが見つからない（想定外の出力）場合はnullとし、呼び出し元に信頼させない。
 */
export function parseCurlOutput(stdout: string): { status: number; html: string } | null {
  const body = stdout || "";
  const markerIndex = body.lastIndexOf(CURL_STATUS_MARKER);
  if (markerIndex === -1) return null;
  const html = body.slice(0, markerIndex);
  const status = Number(body.slice(markerIndex + CURL_STATUS_MARKER.length).trim());
  return Number.isFinite(status) ? { status, html } : null;
}

/**
 * HTML本文をAgentプロンプト埋め込み用のプレーンテキストへ変換する（純粋関数）。
 * script/styleの中身を除去し、タグを剥がし、主要HTMLエンティティをデコードし、
 * 空白を圧縮したうえでmaxCharsに切り詰める。
 */
export function htmlToText(html: string, maxChars: number = PAGE_TEXT_MAX_CHARS): string {
  const body = html || "";
  const withoutScripts = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  // タグを改行に置換したうえで行単位にtrim・空行除去する。ナビゲーション周りの
  // 大量の空白行（dezeen.com等で実測: 記事タイトル直後に空白行が数十行続く）が
  // maxChars上限を無駄に消費し、肝心の本文が切り詰められてしまうのを防ぐ
  // （単純な連続空白の圧縮だけでは"改行+スペース+改行"の繰り返しを潰しきれない）。
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, "\n");
  const decoded = withoutTags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  const lines = decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const collapsed = lines.join("\n");
  return collapsed.length > maxChars ? collapsed.slice(0, maxChars) : collapsed;
}

/** Node直接取得（グローバルfetch）。取得不能・タイムアウト時はnull。 */
async function fetchTextNode(url: string): Promise<{ status: number; html: string; contentType: string | null } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NODE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
      const html = await res.text();
      return { status: res.status, html, contentType: res.headers.get("content-type") };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * curlサブプロセスでの取得（フォールバック専用）。取得不能時はnull。
 * `--fail`は使わない（4xx/5xxでも本文自体は取得し、isChallengeResponseで判定させるため。
 * `-w`でHTTPステータスを本文末尾に埋め込み、-Lによるリダイレクト後の最終ステータスを取得する）。
 */
async function fetchTextCurl(url: string): Promise<{ status: number; html: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-L", "--max-time", String(CURL_MAX_TIME_SEC), "-A", UA, "-w", `${CURL_STATUS_MARKER}%{http_code}`, url],
      { encoding: "utf-8", maxBuffer: 1024 * 1024 * 5, timeout: CURL_KILL_TIMEOUT_MS },
    );
    return parseCurlOutput(stdout);
  } catch {
    // curl未インストール・タイムアウト・非0終了はすべて握りつぶし、呼び出し元をフォールバック続行させる
    return null;
  }
}

export interface PrefetchedPage {
  text: string;
  /** Node直接取得ではなくcurlフォールバックで取得できた場合true（デバッグ用途）。 */
  viaCurlFallback: boolean;
}

/**
 * URLの本文をNode直接取得→失敗/非2xx/チャレンジ検知時はcurlフォールバックで取得し、
 * Agentプロンプト埋め込み用のプレーンテキストへ変換して返す。両方失敗した場合はnull
 * （呼び出し側は従来どおりAgent自身のWebFetchに完全フォールバックする）。
 */
export async function fetchPageWithFallback(url: string): Promise<PrefetchedPage | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;

  const direct = await fetchTextNode(url);
  if (direct && isHtmlContentType(direct.contentType) && !isChallengeResponse(direct.status, direct.html)) {
    const text = htmlToText(direct.html);
    if (text) return { text, viaCurlFallback: false };
  }

  const curlResult = await fetchTextCurl(url);
  if (curlResult && !isChallengeResponse(curlResult.status, curlResult.html)) {
    const text = htmlToText(curlResult.html);
    if (text) return { text, viaCurlFallback: true };
  }

  return null;
}
