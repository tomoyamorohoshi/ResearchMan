/**
 * add-case パイプライン用プロンプト組み立て（純粋関数・文字列生成のみ）。
 * prompts.ts と役割分担は同じ（サブエージェント自身の人格・規則は .claude/agents/case-adder.md
 * 側に譲り、ここでは「今回のタスク入力」と「機械可読なJSON出力形式」の指定に徹する）。
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
      "タイトル・キーワードでWebSearchし、同じ事例を報じる一次ソース（公式サイト・プレスリリース・報道記事）を探して" +
      "代わりに使ってください。"
    : "";
  return `LINEで送られた以下のURLから、クリエイティブ事例の情報を抽出してください。

## URL
${url}${xNote}${contextNote}

## 出力形式（JSONオブジェクトのみ、説明文なし）
{
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

事実確認できなかった場合は必ず以下の形式のみを返してください（見切り発車で埋めない）:
{ "found": false, "reason": "確認できなかった理由（日本語1行）" }

## 厳守事項
- linkは実際にWebFetch/WebSearchで確認できた実在URLのみ。記憶からの組み立て禁止
- yearは記事内に明記された年のみ採用する。確認できなければ推測せず found:false にする
- JSONオブジェクト以外の文字列（説明文・マークダウンのコードフェンス等）は出力しない`;
}
