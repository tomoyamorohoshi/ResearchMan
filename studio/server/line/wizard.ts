/**
 * LINE対話ウィザードの状態遷移（純粋関数のみ。I/O・Claude呼び出しはwebhook.tsが行う）。
 *
 * 状態機械（pending===null は「idle」を表す。永続化される状態はpending.stateのWizardState）:
 *
 *   idle ──(番号/種別名)───────────────────────────────────────────► await_theme
 *   idle ──(「調べて」等のショートカット)──► [needsStructure: Claude解釈] ─► final_confirm
 *   idle ──(その他任意テキスト)───────────────────────────────────────► menu
 *   menu ──(番号/種別名)──────────────────────────────────────────────► await_theme
 *   menu ──(それ以外)────────────────────────────────────────────────► menu（再掲）
 *   await_theme ──(任意テキスト)─────────────────────────────────────► confirm_theme
 *   confirm_theme ──(y)── research ──► await_viewpoint / ──(y)── idea ──► await_refs
 *   confirm_theme ──(n)──────────────────────────────────────────────► await_theme
 *   await_viewpoint ──(任意/「なし」)────────────────────────────────► confirm_viewpoint
 *   confirm_viewpoint ──(y)──────────────────────────────────────────► await_refs
 *   confirm_viewpoint ──(n)──────────────────────────────────────────► await_viewpoint
 *   await_refs ──(任意/「なし」。research中はURL抽出)──────────────────► confirm_refs
 *   confirm_refs ──(y)───────────────────────────────────────────────► final_confirm
 *   confirm_refs ──(n)───────────────────────────────────────────────► await_refs
 *   final_confirm ──(y)──────────────────────────────────────────────► [execute: createJob]
 *   final_confirm ──(n)──────────────────────────────────────────────► select_edit_field
 *   final_confirm ──(「件数 3」「テーマ ◯◯」等のインライン編集)────────► final_confirm（再掲）
 *   select_edit_field ──(テーマ/観点/参考)───────────────────────────► 対応するawait_*
 *   select_edit_field ──(件数)───────────────────────────────────────► await_count_edit
 *   await_count_edit ──(数字)────────────────────────────────────────► final_confirm
 *
 *   キャンセルは全状態で有効（webhook.ts側でstepWizardより前に判定。isCancelText参照）。
 *   期限切れの検知もwebhook.ts側（isPendingExpired）。この関数は「有効なpendingかnull」を
 *   前提に呼ばれる。
 *
 *   AWARDS専用ルート（kind==="awards"。final_confirmを挟まない別ルート）:
 *   idle/menu ──(3/AWARDS/アワード)──► await_award_name ──(任意テキスト)──►
 *   await_award_categories ──(任意テキスト)──► [needsAwardStructure: Claude構造化→即createJob]
 */
import { validateIdeaRequest, type ValidatedIdeaRequest } from "../pipeline/ideaPure.js";
import { validateResearchRequest, type ValidatedResearchRequest } from "../pipeline/pure.js";
import type { Tab } from "../jobs.js";
import {
  classifyRequestText,
  extractAddCaseRequest,
  isAffirmativeText,
  isNegativeText,
  matchMenuSelection,
  normalizeDigits,
  type LineRequestKind,
} from "./classify.js";
import {
  buildAwardCategoriesQuestionText,
  buildAwardNameQuestionText,
  buildCountEditInvalidText,
  buildCountEditPromptText,
  buildEditFieldPromptText,
  buildFinalConfirmText,
  buildMenuText,
  buildRefsConfirmText,
  buildRefsQuestionText,
  buildStructureFailedText,
  buildThemeConfirmText,
  buildThemeQuestionText,
  buildViewpointConfirmText,
  buildViewpointQuestionText,
} from "./messages.js";
import { expiryFrom, type LinePending, type WizardState } from "./pending.js";

export type WizardStepOutcome =
  | { kind: "reply"; pending: LinePending | null; reply: string }
  | { kind: "execute"; tab: Tab; request: Record<string, unknown> }
  | { kind: "needsStructure"; requestKind: LineRequestKind; freeText: string }
  | { kind: "addCase"; url: string; context: string }
  // AWARDS専用（要件A.2）: Q1/Q2の2問を集めたら、webhook.ts が structureAwardViaClaude を
  // 呼んでcreateJobまで直行する（final_confirmを挟まない）。
  | { kind: "needsAwardStructure"; q1: string; q2: string };

// ── pending構築ヘルパー ──────────────────────────────────────────

function freshPending(userId: string, state: WizardState, now: Date, patch: Partial<LinePending> = {}): LinePending {
  return { userId, state, expiresAt: expiryFrom(now), ...patch };
}

function withState(pending: LinePending, patch: Partial<LinePending>, now: Date): LinePending {
  return { ...pending, ...patch, expiresAt: expiryFrom(now) };
}

/** 期限切れ検知時にmenu状態へ差し戻すためのpending（webhook.ts専用の公開ヘルパー）。 */
export function buildMenuPending(userId: string, now: Date): LinePending {
  return freshPending(userId, "menu", now);
}

// ── バリデーション連携（pure.ts/ideaPure.tsの既定値・エラー文言を単一の真実にする） ──

function toValidationRequest(p: LinePending): Record<string, unknown> {
  if (p.kind === "idea") {
    return { theme: p.theme ?? "", constraint: p.refs ?? "", count: p.count };
  }
  return { kind: p.kind, theme: p.theme ?? "", viewpoint: p.viewpoint ?? "", refUrl: p.refs ?? "", count: p.count };
}

type ValidatedPending =
  | { ok: true; tab: Tab; value: ValidatedResearchRequest | ValidatedIdeaRequest }
  | { ok: false; error: string };

function validatePending(p: LinePending): ValidatedPending {
  const req = toValidationRequest(p);
  if (p.kind === "idea") {
    const r = validateIdeaRequest(req);
    return r.ok ? { ok: true, tab: "idea", value: r.value } : { ok: false, error: r.error };
  }
  const r = validateResearchRequest(req);
  return r.ok ? { ok: true, tab: "research", value: r.value } : { ok: false, error: r.error };
}

/** final_confirm状態の表示文を組み立てる（pending→検証値→表示文）。 */
export function renderFinalConfirm(p: LinePending): string {
  const validated = validatePending(p);
  // await_themeでtheme必須を担保済みのため理論上到達しないが、フェイルセーフとして表示する。
  if (!validated.ok) return buildStructureFailedText(validated.error);
  return buildFinalConfirmText(validated.tab, validated.value);
}

/** Claude構造化（needsStructure）の結果からfinal_confirmのpendingを組み立てる。 */
export function pendingFromStructured(
  userId: string,
  tab: Tab,
  value: ValidatedResearchRequest | ValidatedIdeaRequest,
  now: Date,
): LinePending {
  if (tab === "idea") {
    const v = value as ValidatedIdeaRequest;
    return freshPending(userId, "final_confirm", now, { kind: "idea", theme: v.theme, refs: v.constraint, count: v.count });
  }
  const v = value as ValidatedResearchRequest;
  return freshPending(userId, "final_confirm", now, {
    kind: v.kind,
    theme: v.theme,
    viewpoint: v.viewpoint,
    refs: v.refUrl,
    count: v.count,
  });
}

// ── 「なし」等のスキップ語 ───────────────────────────────────────

const SKIP_WORDS = new Set(["なし", "ない", "スキップ"]);

const URL_RE = /https?:\/\/\S+/g;

/** research中はURLのみ抽出（複数可。空白区切りで結合）。無ければ本文をそのまま参考情報として使う。 */
function extractRefs(text: string, kind: LineRequestKind | undefined): string {
  const trimmed = text.trim();
  if (kind === "idea") return trimmed; // ideaは「縛り・文脈」なのでURL抽出しない
  const urls = trimmed.match(URL_RE);
  return urls && urls.length > 0 ? urls.join(" ") : trimmed;
}

// ── final_confirmのインライン編集コマンド／select_edit_fieldの項目名判定 ──────

type FieldEditTarget = "theme" | "viewpoint" | "refs" | "count";

const FIELD_EDIT_PREFIXES: Array<{ prefix: string; field: FieldEditTarget }> = [
  { prefix: "件数", field: "count" },
  { prefix: "テーマ", field: "theme" },
  { prefix: "観点", field: "viewpoint" },
  { prefix: "参考", field: "refs" },
  { prefix: "縛り", field: "refs" }, // ideaの表記ゆれ
];

function matchEditFieldName(text: string): FieldEditTarget | null {
  const trimmed = text.trim();
  for (const { prefix, field } of FIELD_EDIT_PREFIXES) {
    if (trimmed.startsWith(prefix)) return field;
  }
  return null;
}

interface FieldEditCommand {
  field: FieldEditTarget;
  rawValue: string;
}

/** 「件数 3」「テーマ ◯◯」のようなインライン編集コマンドを判定する（値部分が無ければコマンドとみなさない）。 */
function parseFieldEditCommand(text: string): FieldEditCommand | null {
  const trimmed = text.trim();
  for (const { prefix, field } of FIELD_EDIT_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).replace(/^[\s:：]+/, "");
      if (rest) return { field, rawValue: rest };
    }
  }
  return null;
}

function parseCountValue(raw: string): number | null {
  const normalized = normalizeDigits(raw.trim());
  const m = normalized.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function applyFieldEdit(pending: LinePending, edit: FieldEditCommand): Partial<LinePending> {
  switch (edit.field) {
    case "theme":
      return { theme: edit.rawValue.trim() };
    case "viewpoint":
      return { viewpoint: edit.rawValue.trim() };
    case "refs":
      return { refs: extractRefs(edit.rawValue, pending.kind) };
    case "count": {
      const n = parseCountValue(edit.rawValue);
      return n !== null ? { count: n } : {};
    }
  }
}

// ── 各状態のハンドラ ─────────────────────────────────────────────

/** kind選択直後に遷移すべき状態と、その最初の質問文（awardsだけresearch/ideaと別ルート）。 */
function firstStepFor(kind: LineRequestKind): { state: WizardState; reply: string } {
  if (kind === "awards") return { state: "await_award_name", reply: buildAwardNameQuestionText() };
  return { state: "await_theme", reply: buildThemeQuestionText() };
}

function stepIdle(text: string, userId: string, now: Date): WizardStepOutcome {
  const kindSel = matchMenuSelection(text);
  if (kindSel) {
    const { state, reply } = firstStepFor(kindSel);
    return { kind: "reply", pending: freshPending(userId, state, now, { kind: kindSel }), reply };
  }
  const classified = classifyRequestText(text);
  if (classified) {
    return { kind: "needsStructure", requestKind: classified.kind, freeText: classified.rest };
  }
  // 事例追加（LINEでURLを送ると事例が追加される機能）: 既存キーワードに一致しない
  // URL入りテキストのみ対象。確認ステップを挟まず即ジョブ投入するため、pendingは作らない
  // （wizard状態機械の外側で webhook.ts が直接 createJob する）。
  const addCase = extractAddCaseRequest(text);
  if (addCase) {
    return { kind: "addCase", url: addCase.url, context: addCase.context };
  }
  return { kind: "reply", pending: freshPending(userId, "menu", now), reply: buildMenuText() };
}

function stepMenu(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const kindSel = matchMenuSelection(text);
  if (!kindSel) {
    return { kind: "reply", pending: withState(pending, {}, now), reply: buildMenuText() };
  }
  const { state, reply } = firstStepFor(kindSel);
  return { kind: "reply", pending: withState(pending, { state, kind: kindSel }, now), reply };
}

function stepAwaitTheme(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const theme = text.trim();
  if (!theme) {
    return { kind: "reply", pending: withState(pending, {}, now), reply: buildThemeQuestionText() };
  }
  return { kind: "reply", pending: withState(pending, { state: "confirm_theme", theme }, now), reply: buildThemeConfirmText(theme) };
}

function stepConfirmTheme(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  if (isAffirmativeText(text)) {
    if (pending.kind === "idea") {
      return { kind: "reply", pending: withState(pending, { state: "await_refs" }, now), reply: buildRefsQuestionText(pending.kind) };
    }
    return { kind: "reply", pending: withState(pending, { state: "await_viewpoint" }, now), reply: buildViewpointQuestionText() };
  }
  if (isNegativeText(text)) {
    return { kind: "reply", pending: withState(pending, { state: "await_theme" }, now), reply: buildThemeQuestionText() };
  }
  return { kind: "reply", pending: withState(pending, {}, now), reply: buildThemeConfirmText(pending.theme ?? "") };
}

function stepAwaitViewpoint(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const trimmed = text.trim();
  // 「なし」は確認を挟まず次の質問へ直行する。空値の「（指定なし）でよいですか? (y/n)」は
  // 「n=無い」と誤読されて質問ループに陥る実害があった（2026-07-12 実使用フィードバック）
  if (SKIP_WORDS.has(trimmed)) {
    return {
      kind: "reply",
      pending: withState(pending, { state: "await_refs", viewpoint: "" }, now),
      reply: buildRefsQuestionText(pending.kind),
    };
  }
  return {
    kind: "reply",
    pending: withState(pending, { state: "confirm_viewpoint", viewpoint: trimmed }, now),
    reply: buildViewpointConfirmText(trimmed),
  };
}

function stepConfirmViewpoint(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  if (isAffirmativeText(text)) {
    return { kind: "reply", pending: withState(pending, { state: "await_refs" }, now), reply: buildRefsQuestionText(pending.kind) };
  }
  if (isNegativeText(text)) {
    return { kind: "reply", pending: withState(pending, { state: "await_viewpoint" }, now), reply: buildViewpointQuestionText() };
  }
  return { kind: "reply", pending: withState(pending, {}, now), reply: buildViewpointConfirmText(pending.viewpoint ?? "") };
}

function stepAwaitRefs(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const trimmed = text.trim();
  // 「なし」は確認を挟まず全体確認へ直行（stepAwaitViewpointと同じ理由）
  if (SKIP_WORDS.has(trimmed)) {
    const next = withState(pending, { state: "final_confirm", refs: "" }, now);
    return { kind: "reply", pending: next, reply: renderFinalConfirm(next) };
  }
  const refs = extractRefs(text, pending.kind);
  return {
    kind: "reply",
    pending: withState(pending, { state: "confirm_refs", refs }, now),
    reply: buildRefsConfirmText(pending.kind, refs),
  };
}

function stepConfirmRefs(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  if (isAffirmativeText(text)) {
    const next = withState(pending, { state: "final_confirm" }, now);
    return { kind: "reply", pending: next, reply: renderFinalConfirm(next) };
  }
  if (isNegativeText(text)) {
    return { kind: "reply", pending: withState(pending, { state: "await_refs" }, now), reply: buildRefsQuestionText(pending.kind) };
  }
  return { kind: "reply", pending: withState(pending, {}, now), reply: buildRefsConfirmText(pending.kind, pending.refs ?? "") };
}

function stepFinalConfirm(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  if (isAffirmativeText(text)) {
    const validated = validatePending(pending);
    if (!validated.ok) {
      // フェイルセーフ（理論上到達しない）: menuへ差し戻す。
      return { kind: "reply", pending: freshPending(pending.userId, "menu", now), reply: buildStructureFailedText(validated.error) };
    }
    return { kind: "execute", tab: validated.tab, request: validated.value as unknown as Record<string, unknown> };
  }
  if (isNegativeText(text)) {
    return {
      kind: "reply",
      pending: withState(pending, { state: "select_edit_field" }, now),
      reply: buildEditFieldPromptText(pending.kind),
    };
  }
  const edit = parseFieldEditCommand(text);
  if (edit) {
    const patch = applyFieldEdit(pending, edit);
    const next = withState(pending, patch, now);
    return { kind: "reply", pending: next, reply: renderFinalConfirm(next) };
  }
  return { kind: "reply", pending: withState(pending, {}, now), reply: renderFinalConfirm(pending) };
}

function stepSelectEditField(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const field = matchEditFieldName(text);
  if (!field || (field === "viewpoint" && pending.kind === "idea")) {
    return { kind: "reply", pending: withState(pending, {}, now), reply: buildEditFieldPromptText(pending.kind) };
  }
  if (field === "count") {
    return { kind: "reply", pending: withState(pending, { state: "await_count_edit" }, now), reply: buildCountEditPromptText() };
  }
  const targetState: WizardState = field === "theme" ? "await_theme" : field === "viewpoint" ? "await_viewpoint" : "await_refs";
  const reply =
    field === "theme" ? buildThemeQuestionText() : field === "viewpoint" ? buildViewpointQuestionText() : buildRefsQuestionText(pending.kind);
  return { kind: "reply", pending: withState(pending, { state: targetState }, now), reply };
}

function stepAwaitCountEdit(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const n = parseCountValue(text);
  if (n === null) {
    return { kind: "reply", pending: withState(pending, {}, now), reply: buildCountEditInvalidText() };
  }
  const next = withState(pending, { state: "final_confirm", count: n }, now);
  return { kind: "reply", pending: next, reply: renderFinalConfirm(next) };
}

// ── AWARDS専用（要件A.2: Q1「アワード名は?」→Q2「部門は?」→受付・即実行） ─────

function stepAwaitAwardName(pending: LinePending, text: string, now: Date): WizardStepOutcome {
  const awardNameRaw = text.trim();
  if (!awardNameRaw) {
    return { kind: "reply", pending: withState(pending, {}, now), reply: buildAwardNameQuestionText() };
  }
  return {
    kind: "reply",
    pending: withState(pending, { state: "await_award_categories", awardNameRaw }, now),
    reply: buildAwardCategoriesQuestionText(),
  };
}

function stepAwaitAwardCategories(pending: LinePending, text: string): WizardStepOutcome {
  const categoriesRaw = text.trim();
  // final_confirmを挟まないため、ここで即座にneedsAwardStructureへ進む（webhook.ts側が
  // pendingをクリアしてstructureAwardViaClaude→createJobまで直行する）。空文字でも
  // 「全部門」相当としてClaude構造化に委ねる（parseCategoriesTextの既定値と同じ考え方）。
  return { kind: "needsAwardStructure", q1: pending.awardNameRaw ?? "", q2: categoriesRaw };
}

// ── エントリポイント ─────────────────────────────────────────────

/**
 * 1メッセージ分の状態遷移（純粋）。呼び出し側（webhook.ts）はキャンセル判定・期限切れ判定を
 * この関数の外側で済ませ、有効なpending（またはidle=null）だけを渡す。
 */
export function stepWizard(pending: LinePending | null, text: string, now: Date, userId: string): WizardStepOutcome {
  if (!pending) return stepIdle(text, userId, now);
  switch (pending.state) {
    case "menu":
      return stepMenu(pending, text, now);
    case "await_theme":
      return stepAwaitTheme(pending, text, now);
    case "confirm_theme":
      return stepConfirmTheme(pending, text, now);
    case "await_viewpoint":
      return stepAwaitViewpoint(pending, text, now);
    case "confirm_viewpoint":
      return stepConfirmViewpoint(pending, text, now);
    case "await_refs":
      return stepAwaitRefs(pending, text, now);
    case "confirm_refs":
      return stepConfirmRefs(pending, text, now);
    case "final_confirm":
      return stepFinalConfirm(pending, text, now);
    case "select_edit_field":
      return stepSelectEditField(pending, text, now);
    case "await_count_edit":
      return stepAwaitCountEdit(pending, text, now);
    case "await_award_name":
      return stepAwaitAwardName(pending, text, now);
    case "await_award_categories":
      return stepAwaitAwardCategories(pending, text);
  }
}
