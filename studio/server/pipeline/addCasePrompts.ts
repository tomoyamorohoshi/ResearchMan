/**
 * add-case パイプライン用プロンプト組み立て（純粋関数・文字列生成のみ）。
 * prompts.ts と役割分担は同じ（サブエージェント自身の人格・規則は .claude/agents/case-adder.md
 * 側に譲り、ここでは「今回のタスク入力」と「機械可読なJSON出力形式」の指定に徹する）。
 *
 * contentKind（case/tech/neither。要件1）: 事例か技術かを判定させ、tech.jsonの語彙
 * （Domain/Type。data/tech-tag-vocabulary.json）はtechPrompts.ts::buildTechCollectorPromptと
 * 同じ「ハードコードで列挙する」流儀に合わせる（実際の値検証はaddCasePure.ts経由で
 * techPure.ts::filterValidDomains等が担う。ここでの列挙はAgentの出力精度を上げるためのもの）。
 */
export interface CaseAdderPromptInput {
  url: string;
  /** URL以外のユーザーからの補足テキスト（視点・メモ）。空文字なら省略。 */
  context: string;
  /** x.com/twitter.comのURLか。trueなら本文取得困難＋一次ソース検索フォールバックの
   * 指示を追加する（DESIGN要件6）。 */
  isXLink: boolean;
}

export function buildCaseAdderPrompt({ url, context, isXLink }: CaseAdderPromptInput): string {
  const contextNote = context ? `\n\n## ユーザーからの補足（視点・メモ）\n${context}` : "";
  const xNote = isXLink
    ? "\n\n## 注意: このURLはX(旧Twitter)の投稿です\n投稿本文の取得を試みてください。内容が薄い/取得できない場合は、投稿内容や" +
      "タイトル・キーワードでWebSearchし、同じ内容を報じる一次ソース（公式サイト・GitHub・プレスリリース・報道記事）を探して" +
      "代わりに使ってください。"
    : "";
  return `LINEで送られた以下のURLの内容を判定し、情報を抽出してください。

## URL
${url}${xNote}${contextNote}

## 手順
1. URLの内容が次のどれに当たるか判定する（contentKind）:
   - "case": 広告・PR・キャンペーン・ブランド体験などのクリエイティブ事例
   - "tech": クリエイター向けの技術・ソフトウェア（OSS/ツール/研究プロトタイプ等。ResearchMan Technologyタブ相当）
   - "neither": どちらでもない、または内容を確認できない
2. contentKindに応じて、以下の対応する形式のJSONオブジェクトのみを返す（説明文なし）

## contentKind: "case" の出力形式
{
  "contentKind": "case",
  "found": true,
  "title": "事例名（正式名称）",
  "client": "クライアント/ブランド/アーティスト名（不明なら空文字）",
  "agency": "エージェンシー/制作会社（不明なら空文字）",
  "year": "実施年（4桁の文字列）",
  "link": "採用した一次ソースURL（実際にWebFetch/WebSearchで確認できたURL。本文取得できた元のURL、または見つけた代替の一次ソースURL）",
  "award": "受賞情報（自己申告でよい。不明なら空文字）",
  "summary": "どんな事例か1行（日本語）",
  "youtubeId": "公式動画のYouTube ID 11文字（見つかった場合のみ。不明なら空文字）"
}

## contentKind: "tech" の出力形式
{
  "contentKind": "tech",
  "techName": "技術の正式名",
  "org": "開発元",
  "type": "Research|Prototype|Tool",
  "domains": ["Spatial/3D","Motion/Body","GenVideo","CreatorTools","AI/Agents","HCI/MediaArt","Audio/Music"から1-3個],
  "date": "YYYY-MM（公開/発表の年月。日は不要）",
  "links": [{"kind":"github|project|paper|post|product|video","url":"..."}]（github/project/productのいずれかを最低1件。実在確認済みURLのみ）,
  "license": {"spdx":"...またはnull","commercial":"ok|conditional|research-only|paid|none","note":"補足（任意）"},
  "summaryJa": "概要1-2行（技術者でなくてもわかる日本語）",
  "pointJa": "「何がすごいか」→「広告・体験づくりで何が作れそうか」の順で1段落",
  "detailJa": "仕組み・従来との違い・使うには何が必要かを2〜3段落（任意）",
  "relatedWorks": [{"title":"...","description":"1行","url":"..."} 0-3件],
  "thumbnailSource": "デモ・キービジュアルが写る画像URL、またはそのog:imageを持つページURL（GitHubのopengraphカードのようなテキスト画像は不可）"
}

## contentKind: "neither" の出力形式
事実確認できなかった場合、または事例・技術のどちらでもない場合は必ず以下の形式のみを返してください（見切り発車で埋めない）:
{ "contentKind": "neither", "found": false, "reason": "確認できなかった理由（日本語1行）" }

## 厳守事項
- linkやlinks[].urlは実際にWebFetch/WebSearchで確認できた実在URLのみ。記憶からの組み立て禁止
- yearやdateは記事内に明記された情報のみ採用する。確認できなければ推測せず contentKind:"neither" にする
- techの場合、domainsは上記7種の語彙内から選ぶこと（語彙外の値は無効になり却下される）
- JSONオブジェクト以外の文字列（説明文・マークダウンのコードフェンス等）は出力しない`;
}
