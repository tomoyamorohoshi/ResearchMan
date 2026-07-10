/**
 * idea パイプラインの各フェーズでAgent SDKに渡すプロンプト組み立て（純粋関数・文字列生成のみ）。
 * prompts.ts（Research系）と同じ役割分担: ここでは「今回のタスク入力」と「機械可読な出力形式」
 * の指定のみ行う。
 */
import { formatCaseLine, formatTechLine, type CaseRecord, type TechRecord } from "./ideaPure.js";
import type { IdeaAngle } from "./ideaAngles.js";

export function buildKeywordExtractionPrompt(theme: string, constraint: string): string {
  const constraintNote = constraint ? `\n縛り・文脈: ${constraint}` : "";
  return `次のお題から、事例データベースを検索するための日本語キーワードを3〜6個抽出してください。

お題: ${theme}${constraintNote}

- 固有名詞よりも、検索に使える一般名詞・技術名・表現手法の語を優先する
- お題の言い換えではなく、事例の説明文に実際に出現しそうな単語にする

出力はJSON配列のみ（前置き・後書きなし）: ["キーワード1", "キーワード2", ...]`;
}

export interface AngleWithExemplars {
  angle: IdeaAngle;
  exemplars: CaseRecord[];
}

export interface IdeaWriterPromptInput {
  theme: string;
  constraint: string;
  angles: AngleWithExemplars[];
  caseCandidates: CaseRecord[];
  techCandidates: TechRecord[];
}

/**
 * angles は生成すべきアイデアと1:1対応する（angles[i] を使ってi番目のアイデアを作る）。
 * 各アイデアの pattern は必ずそのアイデアに割り当てられた切り口の label と一致させる。
 */
export function buildIdeaWriterPrompt({ theme, constraint, angles, caseCandidates, techCandidates }: IdeaWriterPromptInput): string {
  const constraintNote = constraint ? `\n縛り・文脈: ${constraint}` : "";
  const angleBlocks = angles
    .map((a, i) => {
      const exemplarLines = a.exemplars.map(formatCaseLine).join("\n") || "（参考事例なし）";
      return `### アイデア${i + 1}の切り口: ${a.angle.label}
説明: ${a.angle.description}
この切り口を体現する参考事例:
${exemplarLines}`;
    })
    .join("\n\n");
  const caseLines = caseCandidates.map(formatCaseLine).join("\n") || "（該当なし）";
  const techLines = techCandidates.map(formatTechLine).join("\n") || "（該当なし）";

  return `あなたは広告会社のクリエイティブディレクターの壁打ち相手です。以下のお題に対して、
Case Studyデータベースから学んだ「発想の型（切り口）」をお題に適用し、アイデアを${angles.length}個作ってください。

# お題
${theme}${constraintNote}

# 各アイデアに割り当てる切り口（必ずこの順番・この切り口通りに1案ずつ作ること）
${angleBlocks}

# お題に関連する具体的な事例・技術（触発材料。参照する場合はrefsのidにそのまま使う）
## Case
${caseLines}
## Technology
${techLines}

# ルール
- 各アイデアは「切り口の発想パターンをお題に適用したら何ができるか」の仮説。汎用的な提案ではなく、
  お題（${theme}）に具体的に効くアイデアにすること
- seed は日本語1〜2文・80〜140字。**必ず「〜かも。」で終える（例外なし）**
- title は10〜18字・体言止め推奨・記号や絵文字なし
- pattern は割り当てられた切り口のlabelをそのまま転記する（改変禁止）
- refs は、そのアイデアが参照した事例・技術を列挙する（0件も可）。id は上記の「参考事例」
  「触発材料」に載っているidのみ使用可（それ以外のidを創作しない）。type は "case" か "tech"
- desc は参照した事例/技術が何なのか高校生でもわかる言葉で1文（40〜70字）

# 出力
JSON配列のみ（前置き・後書きなし、${angles.length}個ちょうど）:
[{"title": "...", "pattern": "...", "seed": "...かも。", "refs": [{"type": "case", "id": "...", "desc": "..."}]}]`;
}
