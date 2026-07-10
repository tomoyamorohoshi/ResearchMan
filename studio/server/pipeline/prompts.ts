/**
 * 各フェーズでサブエージェントに渡すプロンプトの組み立て（純粋関数・文字列生成のみ）。
 * サブエージェント自身の人格・規則は .claude/agents/*.md 側（agentLoader経由）に譲り、
 * ここでは「今回のタスク入力」と「機械可読なJSON出力形式」の指定に徹する
 * （auto-research-cc.mjs の buildDiscoveryPrompt/buildArticlePrompt と同じ役割分担）。
 */

export interface CollectorPromptInput {
  theme: string;
  angle: string;
  refUrl: string;
  targetCount: number;
}

export function buildCollectorPrompt({ theme, angle, refUrl, targetCount }: CollectorPromptInput): string {
  const refNote = refUrl
    ? `\n\n## 参照例（「これ系」の具体例。これと近い切り口・粒度の事例を探すこと）\n${refUrl}`
    : "";
  return `ResearchMan Studio からのオンデマンドリサーチ依頼です。

## テーマ・角度
${angle}

## 目標件数
このリクエストで${targetCount}件、候補（未検証でよい）をリストアップしてください。${refNote}

## 出力形式（JSON配列のみ、説明文なし）
[
  {
    "title": "事例名（正式名称）",
    "client": "クライアント/ブランド/アーティスト名",
    "agency": "エージェンシー/制作会社（不明なら空文字）",
    "year": "実施年（4桁の文字列）",
    "link": "あなたが実際に確認した実在のURL",
    "award": "受賞情報（自己申告でよい。不明なら空文字。award-verifierが後で検証する）",
    "summary": "どんな事例か1行（日本語）",
    "youtubeId": "公式動画のYouTube ID 11文字（見つかった場合のみ。不明なら空文字）"
  }
]

## 厳守事項
- linkは実際にWebSearch/WebFetchで確認できた実在URLのみ。記憶からの組み立て禁止。
- テーマ「${theme}」に合致しないものは含めない。
- JSON配列以外の文字列（説明文・マークダウンのコードフェンス等）は出力しない。`;
}

export interface LinkCheckCandidate {
  id: string;
  title: string;
  link: string;
  youtubeId?: string;
}

export function buildLinkCheckerPrompt(candidates: LinkCheckCandidate[]): string {
  const items = candidates
    .map((c) => `- id=${c.id} title="${c.title}" url=${c.link}${c.youtubeId ? ` youtubeId=${c.youtubeId}` : ""}`)
    .join("\n");
  return `以下の候補それぞれについて機械検証してください。

${items}

## 出力形式（JSON配列のみ、説明文なし。各要素は入力のidと必ず対応させること）
[
  { "id": "候補のid", "alive": true, "titleMatch": true, "note": "判定理由（日本語1行）" }
]

- alive: URLが実在し、事例と関係する内容ならtrue
- titleMatch: youtubeIdがある場合のみ、oEmbedタイトルが事例と一致すればtrue。youtubeIdが無い項目は true を返してよい
- 判定に迷ったらfalse側に倒すこと`;
}

export interface AwardVerifyCandidate {
  id: string;
  title: string;
  client: string;
  year: string | number;
  award: string;
}

export function buildAwardVerifierPrompt(candidates: AwardVerifyCandidate[]): string {
  const items = candidates
    .map((c) => `- id=${c.id} title="${c.title}" client="${c.client}" year=${c.year} awardClaim="${c.award}"`)
    .join("\n");
  return `以下の受賞主張それぞれについて一次ソースで検証してください。

${items}

## 出力形式（JSON配列のみ、説明文なし。各要素は入力のidと必ず対応させること）
[
  { "id": "候補のid", "verdict": "confirmed", "correctedAward": "確認できた正確な受賞表記（confirmedなら必須）", "sourceUrl": "一次ソースURL" }
]

- verdict は "confirmed" | "unverified" | "incorrect" のいずれか
- 一次ソースで確認できなければ "unverified"。主張と一次ソースが食い違う場合は "incorrect" とし、
  correctedAward に正しい受賞表記（レベル・部門を含む）を書くこと
- Shortlistを「受賞」として confirmed にしない`;
}

export interface CaseWriterCandidate {
  id: string;
  title: string;
  client: string;
  agency: string;
  year: string | number;
  link: string;
  award: string;
  summary: string;
}

export function buildCaseWriterPrompt(candidates: CaseWriterCandidate[], tagVocabulary: string[]): string {
  const items = candidates
    .map(
      (c) =>
        `### id=${c.id}\nタイトル: ${c.title}\nクライアント: ${c.client || "不明"}\n制作: ${c.agency || "不明"}\n年: ${c.year}\n受賞（検証済み）: ${c.award || "なし"}\n参考URL: ${c.link}\nメモ: ${c.summary || ""}`,
    )
    .join("\n\n");
  return `以下の検証済み事例について、data/cases.json の既存エントリと同じ粒度・文体で
日本語のデータベース記事を書いてください（あなたのRead/Grep/Globツールで既存エントリを
数件参照してよい）。

${items}

## 出力形式（JSON配列のみ、説明文なし。各要素は入力のidと必ず対応させること。id以外は
data/cases.json のフィールド構造に準拠）
[
  {
    "id": "入力のidをそのまま",
    "summary": "1文サマリー（日本語60字前後）",
    "categories": ["コンテンツ革新"],
    "award": "受賞情報（入力の受賞をそのまま転記。なければ空文字）",
    "regions": ["国内"],
    "tags": ["Tech/AI", "Form/Event"],
    "overview": "概要200字（日本語）",
    "background": "背景200字（日本語）",
    "execution": "企画・エグゼキューション200字（日本語）",
    "evaluationImpact": "評価ポイント・世の中的インパクト200字（日本語）",
    "relatedWorks": [{"title": "関連作品名", "description": "説明", "url": "https://..."}]
  }
]

tags候補（この中からのみ2〜5個。Form軸を必ず1つ以上）: ${tagVocabulary.join(" / ")}
- 与えられた検証済み情報の範囲で書く。受賞・数値・クレジットを補完・推測しない`;
}

export function buildOrderTagPrompt(theme: string): string {
  return `ResearchMan というクリエイティブ事例データベースのUIタブ名を決めてください。

リサーチテーマ（日本語）: ${theme}

既存のタブ例: Music / Album Sites / Launch & Reveal / Newspaper
（いずれも英語・Title Case・1〜3単語程度）

上記の例と同じ文体で、このテーマにふさわしい短い英語タブ名を1つだけ、
説明文やクォート無しで出力してください（出力は英語タブ名のみの1行）。`;
}
