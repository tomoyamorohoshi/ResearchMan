/**
 * Technology サムネイルの「キービジュアル優先」取得ヘルパー（共有モジュール）。
 *
 * GitHubのopengraphカード（リポジトリ名+スター数のテキスト画像）はサムネとして
 * 技術内容が伝わらない、というユーザーフィードバック（2026-07-03）を受けた設計:
 *   優先順: 明示指定 > プロジェクトページog:image > GitHub READMEの先頭画像
 *          > 動画サムネイル > GitHub OGPカード（最終手段）
 * build-tech-from-research.mjs / refresh-tech-thumbnails.mjs / set-tech-thumbnail.mjs が共用。
 */
import { fetchImage, fetchOgImage } from "./save-thumbnail.mjs";

export const MIN_THUMB_BYTES = 5000;

/** GitHub OGPカード（1200x600 PNG）かどうか */
export function isGithubCard(buf) {
  if (!buf || buf.length < 24) return false;
  const isPng = buf[0] === 0x89 && buf.slice(1, 4).toString() === "PNG";
  return isPng && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 600;
}

/** URLから画像バッファを取得（ページならog:image経由）。小さすぎる画像はnull */
export async function fetchThumbBuf(sourceUrl) {
  const isDirectImage =
    /\.(jpg|jpeg|png|webp)(\?|$)/i.test(sourceUrl) ||
    /^https:\/\/(opengraph\.githubassets\.com|pbs\.twimg\.com|avatars\.githubusercontent\.com|raw\.githubusercontent\.com|i\.ytimg\.com|camo\.githubusercontent\.com|github\.com\/user-attachments)\//.test(sourceUrl);
  let imgUrl = sourceUrl;
  if (!isDirectImage) {
    imgUrl = await fetchOgImage(sourceUrl);
    if (!imgUrl) return null;
  }
  const buf = await fetchImage(imgUrl);
  return buf && buf.length >= MIN_THUMB_BYTES ? buf : null;
}

function parseGithubRepo(url) {
  const m = (url || "").match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

/** GitHub READMEの先頭コンテンツ画像URLを返す（バッジ・ロゴ・SVGは除外） */
export async function fetchReadmeFirstImage(githubUrl) {
  const gh = parseGithubRepo(githubUrl);
  if (!gh) return null;
  let md;
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/HEAD/README.md`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    md = await res.text();
  } catch {
    return null;
  }
  // Markdown画像 と <img src> を出現順に収集
  const urls = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) urls.push(m[1]);
  for (const m of md.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.push(m[1]);
  for (let u of urls) {
    // バッジ・アイコン・SVGは飛ばす（キービジュアルにならない）
    if (/shields\.io|badge|badgen|logo|icon|\.svg(\?|$)/i.test(u)) continue;
    // 相対パス・blob URLを raw に解決
    if (u.startsWith("./")) u = u.slice(2);
    if (/^https?:\/\//.test(u)) {
      u = u.replace(/github\.com\/([^/]+)\/([^/]+)\/blob\//, "raw.githubusercontent.com/$1/$2/");
    } else {
      u = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/HEAD/${u.replace(/^\//, "")}`;
    }
    return u;
  }
  return null;
}

/** YouTube URLからサムネイルURL（maxres→hq）を返す */
export function youtubeThumbUrls(videoUrl) {
  const m = (videoUrl || "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return [];
  return [
    `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`,
  ];
}

/**
 * キービジュアル候補のソースURLを優先順で列挙する。
 * @param links   [{kind, url}] 事例のソースリンク
 * @param primary 明示指定のthumbnailSource（GitHub OGPカードなら最後に回す）
 */
export async function keyVisualSources(links = [], primary = null) {
  const sources = [];
  const isCardUrl = (u) => /^https:\/\/opengraph\.githubassets\.com\//.test(u || "");
  if (primary && !isCardUrl(primary)) sources.push(primary);

  // プロジェクト/プロダクトページ（og:imageがデモ画像であることが多い）
  for (const l of links) {
    if (["project", "product"].includes(l.kind) && !parseGithubRepo(l.url)) sources.push(l.url);
  }
  // GitHub READMEの先頭画像
  const github = links.find((l) => l.kind === "github") || links.find((l) => parseGithubRepo(l.url));
  if (github) {
    const img = await fetchReadmeFirstImage(github.url);
    if (img) sources.push(img);
  }
  // 動画サムネイル
  for (const l of links) {
    if (l.kind === "video" || /youtube\.com|youtu\.be/.test(l.url)) sources.push(...youtubeThumbUrls(l.url));
  }
  // 最終手段: GitHub OGPカード
  if (primary && isCardUrl(primary)) sources.push(primary);
  else if (github) {
    const gh = parseGithubRepo(github.url);
    if (gh) sources.push(`https://opengraph.githubassets.com/1/${gh.owner}/${gh.repo}`);
  }
  return [...new Set(sources)];
}

/**
 * キービジュアル優先でサムネイル画像を取得する。
 * GitHub OGPカード画像は、他の全候補が失敗した場合のみ受け入れる。
 * @returns {Buffer|null}
 */
export async function fetchKeyVisual(links, primary) {
  const sources = await keyVisualSources(links, primary);
  let cardFallback = null;
  for (const src of sources) {
    const buf = await fetchThumbBuf(src);
    if (!buf) continue;
    if (isGithubCard(buf)) {
      cardFallback = cardFallback || { src, buf };
      continue; // カードは保留し、より良い候補を探し続ける
    }
    return { src, buf };
  }
  return cardFallback;
}
