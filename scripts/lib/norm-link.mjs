/**
 * 記事URLの重複検出用正規化キー（auto-research-cc.mjs / auto-research-tech.mjs 共用）。
 *
 * 2026-07-13: 同一記事URL（automatonまとめ記事など）から複数のケースカードが
 * 生成される事故があった。新規候補の link/links[].url を既存データの正規化キーと
 * 突き合わせることで、生成時点で同一記事由来の重複を弾く。
 *
 * 正規化方針:
 *   - scheme/host は小文字化（http と https は別キーのまま。仕組み上scheme違いは別記事扱い）
 *   - #fragment は除去（同一記事内アンカーの差異を無視）
 *   - 末尾スラッシュは除去
 *   - path と query はそのまま保持（lovethework等はqueryでページが異なるため、
 *     queryを消すと別記事を同一視してしまう）
 */
export function normLink(url) {
  if (!url) return "";
  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const scheme = u.protocol.toLowerCase();
  const host = u.hostname.toLowerCase();
  const port = u.port ? `:${u.port}` : "";
  let pathname = u.pathname || "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return `${scheme}//${host}${port}${pathname}${u.search}`;
}
