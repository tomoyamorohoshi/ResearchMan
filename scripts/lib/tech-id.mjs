/**
 * Technology エントリの id 生成。build-tech-from-research.mjs から切り出し（テストから import 可能にするため）。
 * 括弧内を除去した結果が空（例 "π⁴ (Pi4)"）なら、括弧を除去しない版で slug 化する。それでも空なら "" を返す。
 */
function slug(name, stripParens) {
  let s = name.toLowerCase();
  if (stripParens) s = s.replace(/[（(].*?[）)]/g, "");
  return s
    .replace(/[:：].*$/, "")
    .replace(/[^a-z0-9぀-ヿ一-龯]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function toId(name) {
  return slug(name, true) || slug(name, false);
}
