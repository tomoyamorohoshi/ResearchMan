/**
 * X(旧Twitter)投稿の本文・メディア取得（要件1: 本番失敗の修正）。
 *
 * 実際に起きた失敗: LINEで送られたX投稿URL2件が「本文を取得できず、代替の一次ソースも
 * 見つからなかった」で失敗した（動画付き投稿・画像/動画付き日本語投稿）。case-adder Agentの
 * WebFetch単体ではX投稿本文を取得できないことがあるため、機械的に2つの非公式JSONエンドポイント
 * （syndication.twimg.com → 失敗時 fxtwitter.com）を多重化して試行し、取得できた本文・
 * メディアURLをAgentに渡す（addCasePrompts.ts::buildCaseAdderPrompt の tweetMedia）。
 *
 * 実測（2026-07-16）:
 * - `https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=ja` は `{}`（空）を返し使えない。
 *   `token=<react-tweetの公開アルゴリズムによる値>` を付けるとフルデータが返る
 *   （tokenの値自体は検証されていない模様だが、将来の締め付けに備え既知の実装を使う）。
 * - `https://api.fxtwitter.com/status/<id>` は認証不要でフルデータを返す。
 *
 * id抽出・token計算・レスポンスのパースは純粋関数として自動テストする。実際にHTTP GETする
 * fetchTweetMedia、およびメディアのダウンロード downloadTweetMedia はネットワークI/Oのため
 * 自動テスト対象外とする（thumbnail.ts/techThumbnail.ts と同じ既存の慣習）。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const MAX_PHOTOS = 4;
const UA = "researchman-studio";

// ── id抽出（純粋関数） ──────────────────────────────────────────

/**
 * x.com/twitter.com投稿URLからstatus idを抽出する。ホスト判定はaddCasePure.ts::isXLinkが
 * 別途担うため、ここでは"/status/<数字>"パスの有無のみを見る（id抽出という別の関心事）。
 * 抽出できなければnull。
 */
export function extractTweetId(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ── syndication token計算（純粋関数） ────────────────────────────

/**
 * cdn.syndication.twimg.com/tweet-result 用のtoken計算（react-tweetライブラリで使われている
 * 公開アルゴリズム）。値自体は検証されていない模様だが、将来の締め付けに備えて既知の実装を使う。
 */
export function computeSyndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

// ── パース結果の型 ────────────────────────────────────────────────

export interface ParsedTweetMedia {
  source: "syndication" | "fxtwitter";
  text: string;
  author: string;
  createdAt: string;
  /** 写真URL（そのまま画像）。最大4枚にcapする。 */
  photoUrls: string[];
  /** 動画/GIFのポスター静止画URL（動画ファイル自体ではない）。 */
  videoThumbnailUrls: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function formatAuthor(name: string, screenName: string): string {
  if (screenName) return name ? `${name} (@${screenName})` : `@${screenName}`;
  return name;
}

// ── syndication応答のパース（純粋関数） ──────────────────────────

/**
 * cdn.syndication.twimg.com/tweet-result の生JSONを構造化データへ変換する。
 * 想定外の形状（{}含む）はfail-closedでnullを返す。
 */
export function parseSyndicationTweet(raw: unknown): ParsedTweetMedia | null {
  if (!isRecord(raw)) return null;
  const text = typeof raw.text === "string" ? raw.text : null;
  if (text === null) return null;

  const user = isRecord(raw.user) ? raw.user : {};
  const name = typeof user.name === "string" ? user.name : "";
  const screenName = typeof user.screen_name === "string" ? user.screen_name : "";
  const createdAt = typeof raw.created_at === "string" ? raw.created_at : "";

  const mediaDetails = Array.isArray(raw.mediaDetails) ? raw.mediaDetails : [];
  const photoUrls: string[] = [];
  const videoThumbnailUrls: string[] = [];
  for (const m of mediaDetails) {
    if (!isRecord(m)) continue;
    const url = typeof m.media_url_https === "string" ? m.media_url_https : "";
    if (!url) continue;
    if (m.type === "photo") {
      if (photoUrls.length < MAX_PHOTOS) photoUrls.push(url);
    } else if (m.type === "video" || m.type === "animated_gif") {
      videoThumbnailUrls.push(url);
    }
  }

  return {
    source: "syndication",
    text,
    author: formatAuthor(name, screenName),
    createdAt,
    photoUrls,
    videoThumbnailUrls,
  };
}

// ── fxtwitter応答のパース（純粋関数） ────────────────────────────

/**
 * api.fxtwitter.com/status/<id> の生JSONを構造化データへ変換する。
 * `tweet.media.photos`/`tweet.media.videos`（fxtwitter公式仕様のキー）が存在すればそちらを
 * 優先し、無ければ実測で確認できた`tweet.media.all`をtypeで振り分けてフォールバックに使う。
 * 想定外の形状はfail-closedでnullを返す。
 */
export function parseFxTwitterTweet(raw: unknown): ParsedTweetMedia | null {
  if (!isRecord(raw)) return null;
  const tweet = isRecord(raw.tweet) ? raw.tweet : null;
  if (!tweet) return null;
  const text = typeof tweet.text === "string" ? tweet.text : null;
  if (text === null) return null;

  const author = isRecord(tweet.author) ? tweet.author : {};
  const name = typeof author.name === "string" ? author.name : "";
  const screenName = typeof author.screen_name === "string" ? author.screen_name : "";
  const createdAt = typeof tweet.created_at === "string" ? tweet.created_at : "";

  const media = isRecord(tweet.media) ? tweet.media : {};
  const photoUrls: string[] = [];
  const videoThumbnailUrls: string[] = [];

  const photosArr = Array.isArray(media.photos) ? media.photos : null;
  const videosArr = Array.isArray(media.videos) ? media.videos : null;
  if (photosArr || videosArr) {
    for (const p of photosArr ?? []) {
      if (isRecord(p) && typeof p.url === "string" && photoUrls.length < MAX_PHOTOS) {
        photoUrls.push(p.url);
      }
    }
    for (const v of videosArr ?? []) {
      if (isRecord(v) && typeof v.thumbnail_url === "string") {
        videoThumbnailUrls.push(v.thumbnail_url);
      }
    }
  } else {
    const all = Array.isArray(media.all) ? media.all : [];
    for (const m of all) {
      if (!isRecord(m)) continue;
      if (m.type === "photo") {
        if (typeof m.url === "string" && photoUrls.length < MAX_PHOTOS) photoUrls.push(m.url);
      } else if (m.type === "video" || m.type === "gif") {
        if (typeof m.thumbnail_url === "string") videoThumbnailUrls.push(m.thumbnail_url);
      }
    }
  }

  return {
    source: "fxtwitter",
    text,
    author: formatAuthor(name, screenName),
    createdAt,
    photoUrls,
    videoThumbnailUrls,
  };
}

// ── HTTP GET（JSON。settle+timeoutパターン。ideaFavorites.ts::httpGetJson参照） ──

type JsonGetResult = { ok: true; body: unknown } | { ok: false; error: string };

function httpGetJson(url: string): Promise<JsonGetResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: JsonGetResult): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const req = https.get(url, { headers: { "User-Agent": UA } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          settle({ ok: false, error: `HTTP ${res.statusCode}` });
          return;
        }
        const chunks: Buffer[] = [];
        const finish = (): void => {
          try {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            settle({ ok: true, body });
          } catch (e) {
            settle({ ok: false, error: `JSON解析エラー: ${e instanceof Error ? e.message : String(e)}` });
          }
        };
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      });
      req.on("error", (e) => settle({ ok: false, error: e.message }));
      req.setTimeout(15_000, () => {
        settle({ ok: false, error: "timeout" });
        req.destroy();
      });
    } catch (e) {
      settle({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// ── 本文・メディア取得（syndication→fxtwitterの多重化。ネットワークI/Oのため自動テスト対象外） ──

/**
 * X投稿URLから本文・メディアを取得する。syndication→失敗ならfxtwitter→両方失敗/両方空なら
 * nullを返す（呼び出し側addCase.tsはnullの場合tweetMediaを渡さず従来どおりのフローに倒す）。
 */
export async function fetchTweetMedia(url: string): Promise<ParsedTweetMedia | null> {
  const id = extractTweetId(url);
  if (!id) return null;

  const token = computeSyndicationToken(id);
  const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;
  const synRes = await httpGetJson(syndicationUrl);
  if (synRes.ok) {
    const parsed = parseSyndicationTweet(synRes.body);
    if (parsed) return parsed;
  }

  const fxUrl = `https://api.fxtwitter.com/status/${id}`;
  const fxRes = await httpGetJson(fxUrl);
  if (fxRes.ok) {
    const parsed = parseFxTwitterTweet(fxRes.body);
    if (parsed) return parsed;
  }

  return null;
}

// ── 一時ディレクトリ（純粋関数：パス組み立てのみ） ─────────────────

/** メディアダウンロード先の専用ディレクトリパス（ジョブごとに分離。存在有無は問わない）。 */
export function buildXMediaTempDir(jobId: string): string {
  return path.join(os.tmpdir(), `researchman-xmedia-${jobId}`);
}

// ── メディアダウンロード（ネットワークI/Oのため自動テスト対象外） ────────

/** URLから画像をダウンロードしてバッファで返す（scripts/save-thumbnail.mjs::fetchImageと同じ
 *  settle+timeout+リダイレクト追従パターン。scripts/側は改変禁止のためここに複製する）。 */
function fetchImageBuffer(url: string, redirects = 4): Promise<Buffer | null> {
  return new Promise((resolve) => {
    if (!url || !url.startsWith("http")) {
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (v: Buffer | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        fetchImageBuffer(next, redirects - 1).then(settle);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        settle(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => settle(Buffer.concat(chunks)));
      res.on("close", () => settle(null));
      res.on("error", () => settle(null));
    });
    req.on("error", () => settle(null));
    req.setTimeout(15_000, () => {
      settle(null);
      req.destroy();
    });
  });
}

/**
 * 写真URL一覧+動画サムネURL一覧をos.tmpdir()配下の専用ディレクトリにダウンロードし、
 * 保存できたローカルファイルパスの配列を返す（ダウンロード失敗分はスキップ。1件も
 * 保存できなければ空配列）。ディレクトリは呼び出し側がcleanupXMediaDirで掃除する。
 */
export async function downloadTweetMedia(dir: string, photoUrls: string[], videoThumbnailUrls: string[]): Promise<string[]> {
  const all = [
    ...photoUrls.map((url, i) => ({ url, name: `photo-${i}.jpg` })),
    ...videoThumbnailUrls.map((url, i) => ({ url, name: `video-thumb-${i}.jpg` })),
  ];
  if (all.length === 0) return [];

  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const { url, name } of all) {
    const buf = await fetchImageBuffer(url);
    if (!buf || buf.length === 0) continue;
    const localPath = path.join(dir, name);
    await writeFile(localPath, buf);
    paths.push(localPath);
  }
  return paths;
}

// ── クリーンアップ ────────────────────────────────────────────────

/** メディア一時ディレクトリを削除する（存在しなくてもエラーにしない）。 */
export async function cleanupXMediaDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
