/**
 * Research(Technology) の収集エージェントに渡すプロンプト組み立て（純粋関数）。
 * prompts.ts（Case Study）と同じ役割分担: サブエージェント人格はコード内で定義
 * （.claude/agents/*.md は使わない。techResearch.ts参照）、ここでは「今回のタスク入力」と
 * 出力形式の指定に徹する。
 *
 * クライテリア・文体ルールの文言は scripts/auto-research-tech.mjs::buildPrompt（デイリー版）を
 * テーマ駆動用に踏襲する（TECHNOLOGY_SPEC.md準拠。デイリースクリプト自体は無改変）。
 */

export interface TechCollectorPromptInput {
  theme: string;
  viewpoint: string;
  refUrl: string;
  targetCount: number;
  /** 既存tech.jsonのタイトル等、重複収集を避けたい候補（任意）。 */
  excludeTitles?: string[];
}

export function buildTechCollectorPrompt({
  theme,
  viewpoint,
  refUrl,
  targetCount,
  excludeTitles,
}: TechCollectorPromptInput): string {
  const viewpointNote = viewpoint ? `\n\n## 観点（何を「アイデアの種になる」と見るか）\n${viewpoint}` : "";
  const refNote = refUrl
    ? `\n\n## 参照例（「これ系」の具体例。近い粒度・切り口の技術を探すこと）\n${refUrl}`
    : "";
  const excludeNote = excludeTitles?.length
    ? `\n\n重複禁止（既掲載・除外済み）: ${excludeTitles.join(" / ")}`
    : "";

  return `ResearchMan Studio からのオンデマンドリサーチ依頼です。「Technology」タブ（TECHNOLOGY_SPEC.md準拠）に
追加する技術を探します。

## テーマ
${theme}${viewpointNote}${refNote}

## 目標件数
このリクエストで${targetCount}件、クライテリア適合の技術候補を検証済みJSON配列で返してください。
該当が少なければ無理に埋めず、少ない件数で返してください。${excludeNote}

## クライテリア（厳守・TECHNOLOGY_SPEC.md準拠）
- Research = GitHub等でコードが実際に公開されているもののみ（README-onlyプレースホルダ不可。リポジトリの中身を確認）
- Tool = クリエイターが実際に使える実物（OSS or 有償で独自性。配布ページ実在確認）
- Prototype = 動くデモが映像で確認できる実験作。HCI/ハードウェア研究は査読付き発表+公式デモ映像があればコード無しでも可
- 除外: 論文のみ・コード未公開、製品ニュース、バージョン告知のみ、既存APIの薄いラッパー、商用キャンペーン事例
- 全リンクは実際にアクセスして生存確認。推測URL禁止

## 執筆前の必須手順
summaryJa/pointJa/detailJa を書く前に、一次ソース（GitHub README・プロジェクトページ・論文）を
**WebFetch で実際に開いて読む**こと。検索結果のスニペットだけで書くことは禁止。
リンク先がWebFetchで読めない場合は https://r.jina.ai/<元URL> 経由で読んでよい。ただし出力JSONの
url には必ず**元URL**を書くこと（r.jina.ai・t.co を含むURLは出力禁止）。
それでも読めなかった（アクセス不能・内容が薄すぎる）技術は候補から外す。

## 文体ルール（重要）
- 技術者でなくてもわかるように。専門用語には言い換えか身近な例えを添える。端的すぎるより丁寧に
- pointJa: 「何がすごいか」→「広告・体験づくりで何が作れそうか」の順で1段落350〜500字
- detailJa: 2〜3段落450〜700字。①仕組みの具体的説明（たとえ話OK） ②従来と何が違うか ③使うには何が必要か（機材・費用・スキル・入手方法）

## 出力形式（JSON配列のみ、説明文なし）
[{
  "techName": "正式名", "org": "開発元",
  "type": "Research|Prototype|Tool",
  "domains": ["Spatial/3D","Motion/Body","GenVideo","CreatorTools","AI/Agents","HCI/MediaArt","Audio/Music"から1-3個],
  "date": "YYYY-MM",
  "links": [{"kind":"github|project|paper|post|product|video","url":"..."}],
  "license": {"spdx":"...or null","commercial":"ok|conditional|research-only|paid|none","note":"..."},
  "summaryJa": "概要1-2行", "pointJa": "...", "detailJa": "...",
  "relatedWorks": [{"title":"...","description":"1行","url":"..."} 2-3件],
  "thumbnailSource": "技術のデモ・キービジュアルが写る画像URL or そのog:imageを持つページURL（プロジェクトページやREADMEのヒーロー画像を優先。GitHubのopengraphカードはテキスト画像なので不可＝最終フォールバックは自動で入る）",
  "verdict": "adopt", "verdictReason": "..."
}]

## 厳守事項
- テーマ「${theme}」に合致しないものは含めない。
- JSON配列以外の文字列（説明文・マークダウンのコードフェンス等）は出力しない。`;
}
