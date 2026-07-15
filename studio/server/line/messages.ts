/**
 * LINEへ送るテキストの組み立て（純粋関数のみ。実送信は push.ts）。
 * 対話ウィザードの各状態の質問文・確認文をここに集約する（既存流儀を踏襲）。
 */
import type { ValidatedIdeaRequest } from "../pipeline/ideaPure.js";
import type { ValidatedResearchRequest } from "../pipeline/pure.js";
import type { Tab } from "../jobs.js";
import type { LineRequestKind } from "./classify.js";

/** 最終確認（final_confirm）の内容表示＋y/n・件数変更の案内。 */
export function buildFinalConfirmText(tab: Tab, value: ValidatedResearchRequest | ValidatedIdeaRequest): string {
  const lines: string[] = [];
  if (tab === "research") {
    const v = value as ValidatedResearchRequest;
    lines.push(`【${v.kind}】`);
    lines.push(`テーマ: ${v.theme}`);
    lines.push(`観点: ${v.viewpoint || "（指定なし）"}`);
    lines.push(`参照URL: ${v.refUrl || "（指定なし）"}`);
    lines.push(`件数: ${v.count}件`);
  } else {
    const v = value as ValidatedIdeaRequest;
    lines.push("【アイデア】");
    lines.push(`お題: ${v.theme}`);
    lines.push(`縛り・文脈: ${v.constraint || "（指定なし）"}`);
    lines.push(`件数: ${v.count}件`);
  }
  lines.push("");
  lines.push("この内容で実行しますか? (y/n)");
  lines.push("件数を変えるには「件数 3」のように返信してください。");
  return lines.join("\n");
}

export function buildMenuText(): string {
  return [
    "何をしますか?",
    "1️⃣ 事例調査",
    "2️⃣ 技術調査",
    "3️⃣ AWARDS",
    "4️⃣ アイデア出し",
    "",
    "番号で返信してください。やめるときは「キャンセル」と返信してください。",
  ].join("\n");
}

export function buildExpiredAndMenuText(): string {
  return ["前回の依頼は期限切れです。", "", buildMenuText()].join("\n");
}

export function buildThemeQuestionText(): string {
  return "テーマ（お題）を教えてください。";
}

export function buildThemeConfirmText(theme: string): string {
  return `テーマ: ${theme} でよいですか? (y/n)`;
}

export function buildViewpointQuestionText(): string {
  return "観点・優先したい切り口はありますか?（なければ「なし」）";
}

export function buildViewpointConfirmText(viewpoint: string): string {
  return `観点: ${viewpoint || "（指定なし）"} でよいですか? (y/n)`;
}

/** researchは「参考にしたい事例やURL」、ideaは「縛り・文脈」に読み替える（DESIGN合意）。 */
export function buildRefsQuestionText(kind: LineRequestKind | undefined): string {
  return kind === "idea" ? "縛り・文脈はありますか?（なければ「なし」）" : "参考にしたい事例やURLはありますか?（なければ「なし」）";
}

export function buildRefsConfirmText(kind: LineRequestKind | undefined, refs: string): string {
  const label = kind === "idea" ? "縛り・文脈" : "参照URL";
  return `${label}: ${refs || "（指定なし）"} でよいですか? (y/n)`;
}

/** final_confirmで「n」と答えたあとの「どこを直しますか?」。ideaには観点の項目が無いため選択肢から外す。 */
export function buildEditFieldPromptText(kind: LineRequestKind | undefined): string {
  const options = kind === "idea" ? "テーマ/縛り/件数" : "テーマ/観点/参考/件数";
  return `どこを直しますか?（${options}、またはキャンセル）`;
}

export function buildCountEditPromptText(): string {
  return "新しい件数を教えてください（数字で）。";
}

export function buildCountEditInvalidText(): string {
  return "数字で入力してください（例: 3）。";
}

export function buildUnconfiguredAllowedUserText(userId: string): string {
  return `あなたのuserIdは ${userId} です。~/.researchman-line.json に "allowedUserId" として設定してください。`;
}

export function buildNoPendingText(): string {
  return "キャンセルする依頼はありません。";
}

export function buildCancelledText(): string {
  return "依頼をキャンセルしました。";
}

export function buildExecStartedText(): string {
  return "実行開始（完了時にまた通知します）";
}

export function buildJobCreateFailedText(reason: string): string {
  return `依頼の実行開始に失敗しました: ${reason}`;
}

export function buildStructureFailedText(reason: string): string {
  return `依頼の解釈に失敗しました: ${reason}\n\nもう一度、具体的なテーマを添えて送ってください。`;
}

// ── 事例追加（LINEでURLを送ると事例が cases.json に追加される機能） ─────────
// 確認ステップなしで即ジョブ投入するため、受付・完了(成功/失敗)の3文言のみ。

export function buildAddCaseAcceptedText(): string {
  return "受け付けました（完了時にまた通知します）";
}

/**
 * 追加成功のLINE通知文言。kindでCase/Technologyの区別を明記する（要件3: どちらに追加されたか
 * 判別できるようにする）。techは反映先がTechnologyタブであることも案内する（case/tech共通の
 * cases.json/tech.jsonという実装詳細ではなく、ユーザーが見る場所で案内する）。
 */
export function buildAddCaseSuccessText(kind: "case" | "tech", title: string, url: string): string {
  const kindLabel = kind === "tech" ? "Technology" : "Case";
  const lines = [`${kindLabel} として追加しました: ${title}`, url];
  if (kind === "tech") lines.push("サイトのTechnologyタブで見られます。");
  return lines.join("\n");
}

export function buildAddCaseFailedText(reason: string): string {
  return `事例の追加に失敗しました: ${reason}`;
}

/** 重複検知時の案内文（指摘3: 失敗ではなく案内のため、buildAddCaseFailedTextで二重ラップしない）。 */
export function buildAddCaseDuplicateText(title: string): string {
  return `既に登録済み: ${title}`;
}

// ── AWARDS（要件A: LINE入口・低優先・一時停止/再開） ────────────────────────
// research/ideaと異なりfinal_confirmを挟まず、Q1/Q2の2問だけで受付・即実行する
// （事例追加と同じ「確認ステップなし」の考え方）。

export function buildAwardNameQuestionText(): string {
  return "アワード名は?（例: D&AD 2026）";
}

export function buildAwardCategoriesQuestionText(): string {
  return "部門は?（例: 全部門(ブロンズ以上)）";
}

/** 受付時の返信。事例/技術リサーチが実行中の場合は低優先で一時停止しうることも案内する。 */
export function buildAwardAcceptedText(): string {
  return "受け付けました（進捗・完了はまた通知します。事例/技術リサーチの実行中は一時停止することがあります）";
}

/** 「再開」キーワードで再開できるAWARDSジョブ（予算超過で一時停止中）が無い場合。 */
export function buildAwardResumeNotFoundText(): string {
  return "再開できるAWARDSの依頼はありません。";
}

/** 「再開」キーワードで予算超過中のAWARDSジョブの再開を受け付けた直後の返信。 */
export function buildAwardResumeAcceptedText(): string {
  return "AWARDSを再開します（新しい予算枠で続行します）。";
}

/**
 * tech候補がCase Study（cases.json）と同一タイトルで却下された場合の専用案内文
 * （レビュー指摘2: 単なる「既に登録済み」だとどちら側に既存登録があるか分からないため、
 * 既存登録の種別を明示する）。
 */
export function buildAddCaseDuplicateAsCaseText(title: string): string {
  return `既に登録済み（Case Studyとして）: ${title}`;
}
