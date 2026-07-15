/**
 * アワードリサーチジョブ（awardResearch.ts）の各フェーズでサブエージェントに渡す
 * プロンプトの組み立て（純粋関数・文字列生成のみ。prompts.ts の役割分担に倣う）。
 * P1/P2はいずれも award-verifier（.claude/agents/award-verifier.md。WebSearch/WebFetch/Read）
 * を使い回す。専用の「ソース発見」エージェントは新設せず、award-verifierの一次ソース優先の
 * 人格・規則をそのまま活かす（docs/AWARD_RESEARCH_SOP.md フェーズ1・2の趣旨）。
 */

/** P1: 公式受賞者一覧のURL構造を特定させる。見つからない場合は found:false + reason を返させる。 */
export function buildAwardSourceDiscoveryPrompt(awardName: string, year: string): string {
  return `「${awardName} ${year}」の公式受賞者一覧ページを特定してください。

## 手順
1. WebSearchで公式サイト（アワード運営団体自身のドメイン）の受賞者一覧・Winners Galleryを探す
2. 見つかったらWebFetchで実在を確認し、部門別にどう構成されているか（1ページに全部門/部門ごとに別ページ等）を把握する
3. トレード記事（Campaign/LBB/adobo等の二次情報）しか見つからない場合、公式ソースとして採用しない

## 出力形式（JSONオブジェクトのみ、説明文なし）
{
  "found": true または false,
  "officialUrl": "公式受賞者一覧のトップURL（foundがtrueなら必須）",
  "structureNote": "部門別ページの構成メモ（foundがtrueなら必須。次フェーズの部門別クロールの手がかりになる粒度で）",
  "reason": "foundがfalseの場合、見つからなかった理由"
}

## 厳守事項
- 公式サイト（運営団体自身のドメイン）以外を officialUrl にしない
- 公式ソースが見つからない場合は絶対に推測で officialUrl を埋めず found:false を返す`;
}

/** 部門指定が「全部門」の場合に、公式ソースから部門名の一覧を列挙させる（P2開始前の下準備）。 */
export function buildAwardCategoryListPrompt(params: {
  awardName: string;
  year: string;
  officialUrl: string;
  structureNote: string;
}): string {
  const { awardName, year, officialUrl, structureNote } = params;
  return `「${awardName} ${year}」の公式受賞者一覧（起点URL: ${officialUrl}）から、部門（カテゴリ）名の一覧を列挙してください。

## 構成メモ
${structureNote || "（特になし）"}

## 出力形式（JSON配列。部門名の文字列のみ、説明文なし）
["部門名A", "部門名B", ...]

## 厳守事項
- 実際に公式サイトで確認できた部門名のみ列挙する（記憶からの組み立て禁止）
- 部門が1つも確認できなければ空配列 [] を返す`;
}

/** P2: 指定部門の受賞者を、指定レベル以上に絞って一次ソース付きで列挙させる（部門並列実行）。 */
export function buildAwardCategoryCollectPrompt(params: {
  awardName: string;
  year: string;
  category: string;
  minLevelLabel: string;
  officialUrl: string;
  structureNote: string;
}): string {
  const { awardName, year, category, minLevelLabel, officialUrl, structureNote } = params;
  return `「${awardName} ${year}」の部門「${category}」の受賞者を、公式ソースで確認しながらリストアップしてください。

## 公式ソース
- 起点URL: ${officialUrl}
- 構成メモ: ${structureNote || "（特になし。起点URLから部門別ページを辿って探すこと）"}

## 対象レベル
"${minLevelLabel}" 以上のレベルの受賞者のみ対象にしてください（それより下のレベルは含めない）。

## 出力形式（JSON配列のみ、説明文なし）
[
  {
    "category": "${category}",
    "subcategory": "小分類（無ければ空文字）",
    "level": "Grand Prix | Titanium | Gold | Silver | Bronze | Shortlist のいずれか",
    "title": "作品タイトル",
    "brand": "ブランド名",
    "agency": "制作会社（不明なら空文字）",
    "sourceUrl": "実際にWebFetchで確認した公式URL"
  }
]

## 厳守事項
- sourceUrlは実際にWebFetchで確認した実在URLのみ（記憶からの組み立て禁止）
- 公式ソースで確認できない受賞者は含めない（トレード記事のみでの確定は禁止）
- 部門「${category}」に該当しない受賞者は含めない
- 該当する受賞者が1件も無ければ空配列 [] を返す`;
}
