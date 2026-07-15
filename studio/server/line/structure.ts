/**
 * LINE本文の自由文部分（classify.tsがキーワードを剥がした残り）を、
 * Studio UIのフォーム入力と同じ形（theme/viewpoint/count/refUrl または theme/constraint/count）へ
 * 構造化する。
 *
 * - Claude呼び出しは studio/server/pipeline/sdkRunner.ts::runPlainQuery を再利用する
 *   （デイリー/Studio既存パイプラインと同じ認証・呼び出し流儀）。
 * - 「型がなく失敗コストが小さい」軽い解釈タスクのため、安いモデル（sonnet系）・
 *   低effort・タイムアウト60秒・ジョブ本体とは別の小さな予算上限、という構成にする
 *   （タスク指示どおり）。
 * - 構造化結果は必ず pure.ts::validateResearchRequest / ideaPure.ts::validateIdeaRequest を
 *   通す。これにより「件数など未指定時の既定値」はここで独自実装せず、Studio UIからの
 *   依頼と完全に同じバリデーション・デフォルト適用ロジックに乗る
 *   （jobs.ts::createJob が実行時に呼ぶ検証と同一関数を先出しで使うだけなので、
 *   pending保存時点とOK実行時点で解釈がぶれる心配もない）。
 */
import { assertWithinBudget } from "../pipeline/budget.js";
import { validateAwardRequest, type ValidatedAwardRequest } from "../pipeline/awardPure.js";
import { validateIdeaRequest, type ValidatedIdeaRequest } from "../pipeline/ideaPure.js";
import { validateResearchRequest, type ValidatedResearchRequest } from "../pipeline/pure.js";
import { runPlainQuery } from "../pipeline/sdkRunner.js";
import type { Tab } from "../jobs.js";
import type { LineRequestKind } from "./classify.js";

const STRUCTURE_MODEL = "sonnet";
const STRUCTURE_EFFORT = "low" as const;
const STRUCTURE_TIMEOUT_MS = 60_000;
/** ジョブ本体のコスト予算（budget.ts::DEFAULT_JOB_BUDGET_USD=$5）とは別枠の、解釈1回分の小さな上限。 */
const STRUCTURE_BUDGET_USD = 0.2;

export type StructureResult =
  | { ok: true; tab: Tab; value: ValidatedResearchRequest | ValidatedIdeaRequest }
  | { ok: false; error: string };

// ── プロンプト ──────────────────────────────────────────────────

function buildResearchStructurePrompt(freeText: string): string {
  return `次のLINEメッセージ本文から、リサーチ依頼のパラメータを抽出してください。

本文: ${freeText}

抽出する項目:
- theme: 調べる対象のテーマ（本文の主題をそのまま使う。読み取れなければ空文字）
- viewpoint: 観点・切り口の指定があれば文字列、無ければ null
- refUrl: 参照してほしいURLの指定があれば文字列、無ければ null
- count: 件数の指定があれば数値、無ければ null（「◯件」「◯個」等の表現を数値化する）

出力はJSONオブジェクトのみ（前置き・後書き・コードブロック記法なし）:
{"theme": "...", "viewpoint": "..."または null, "refUrl": "..."または null, "count": 数値または null}`;
}

function buildIdeaStructurePrompt(freeText: string): string {
  return `次のLINEメッセージ本文から、アイデア出し依頼のパラメータを抽出してください。

本文: ${freeText}

抽出する項目:
- theme: お題（本文の主題をそのまま使う。読み取れなければ空文字）
- constraint: 縛り・制約・文脈の指定があれば文字列、無ければ null
- count: 件数の指定があれば数値、無ければ null（「◯案」「◯個」等の表現を数値化する）

出力はJSONオブジェクトのみ（前置き・後書き・コードブロック記法なし）:
{"theme": "...", "constraint": "..."または null, "count": 数値または null}`;
}

// ── Claude応答のJSON抽出・パース（純粋・テスト対象） ────────────────

/** テキスト中の最初の `{` 〜 最後の `}` をJSONオブジェクトとしてパースする（pure.ts::extractJsonArrayの兄弟）。 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * count: null（Claudeが「未指定」の意図で返す）を、そのまま request.count に渡すと
 * jobs.ts::clampCount が Number(null)===0（finite）と判定してしまい、未指定のはずが
 * 「1件」に丸められてしまう（Number(undefined)はNaNでfallbackされるが、Number(null)は0）。
 * このズレを吸収するため、null/undefined はどちらも「未指定」としてundefinedへ正規化する。
 */
function normalizeCount(raw: unknown): number | undefined {
  return raw === null || raw === undefined ? undefined : (raw as number);
}

function normalizeStr(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Claude応答テキスト → StructureResult（純粋。ネットワークに触れない部分だけを切り出してテストする）。 */
export function parseStructuredResponse(kind: LineRequestKind, text: string): StructureResult {
  const obj = extractJsonObject(text);
  if (!obj) return { ok: false, error: "解釈結果の読み取りに失敗しました（Claude応答がJSONではありませんでした）" };

  if (kind === "idea") {
    const request: Record<string, unknown> = {
      theme: normalizeStr(obj.theme),
      constraint: normalizeStr(obj.constraint),
      count: normalizeCount(obj.count),
    };
    const validated = validateIdeaRequest(request);
    if (!validated.ok) return { ok: false, error: validated.error };
    return { ok: true, tab: "idea", value: validated.value };
  }

  const request: Record<string, unknown> = {
    kind,
    theme: normalizeStr(obj.theme),
    viewpoint: normalizeStr(obj.viewpoint),
    refUrl: normalizeStr(obj.refUrl),
    count: normalizeCount(obj.count),
  };
  const validated = validateResearchRequest(request);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, tab: "research", value: validated.value };
}

// ── AWARDS（Q1: アワード名は? / Q2: 部門は?）の構造化 ───────────────────
// research/ideaと異なりfinal_confirmを挟まないため、pure.ts/ideaPure.tsのような既存の
// フォーム入力からの検証入口ではなく、この2問のみで完結する専用の構造化を行う。
// 正規化・語彙チェック自体はawardPure.ts::validateAwardRequestに一本化する
// （LINE入口・API入口・structure.ts経由のいずれでも同じ検証ロジックに乗せるため）。

export type AwardStructureResult =
  | { ok: true; value: ValidatedAwardRequest }
  | { ok: false; error: string };

function buildAwardStructurePrompt(q1: string, q2: string): string {
  return `次の2つのLINE回答から、アワードリサーチ依頼のパラメータを抽出してください。

Q1「アワード名は?」への回答: ${q1}
Q2「部門は?」への回答: ${q2}

抽出する項目:
- awardName: アワード名（年を除いた名称。例: "D&AD 2026" なら "D&AD"）
- year: 開催年（4桁の文字列。例: "2026"）。Q1に無ければ空文字
- categories: 部門指定。「全部門」等なら文字列 "all"、個別指定なら部門名の配列
- minLevel: レベル下限。"Grand Prix"|"Titanium"|"Gold"|"Silver"|"Bronze"|"Shortlist" のいずれか
  （「ブロンズ以上」→"Bronze"、「全レベル」→"Shortlist"、指定が無ければ"Bronze"）

出力はJSONオブジェクトのみ（前置き・後書き・コードブロック記法なし）:
{"awardName": "...", "year": "...", "categories": "all またはこの配列", "minLevel": "..."}`;
}

/** Claude応答テキスト → AwardStructureResult（純粋。ネットワークに触れない部分だけを切り出してテストする）。 */
export function parseAwardStructuredResponse(text: string): AwardStructureResult {
  const obj = extractJsonObject(text);
  if (!obj) return { ok: false, error: "解釈結果の読み取りに失敗しました（Claude応答がJSONではありませんでした）" };
  const request: Record<string, unknown> = {
    awardName: normalizeStr(obj.awardName),
    year: normalizeStr(obj.year),
    categories: obj.categories,
    minLevel: normalizeStr(obj.minLevel),
  };
  const validated = validateAwardRequest(request);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, value: validated.value };
}

export async function structureAwardViaClaude(q1: string, q2: string): Promise<AwardStructureResult> {
  const prompt = buildAwardStructurePrompt(q1, q2);
  try {
    const result = await withTimeout(runPlainQuery(prompt, STRUCTURE_MODEL, { effort: STRUCTURE_EFFORT }), STRUCTURE_TIMEOUT_MS);
    if (!result.ok) return { ok: false, error: result.error ?? "解釈に失敗しました" };
    assertWithinBudget(result.costUsd, STRUCTURE_BUDGET_USD);
    return parseAwardStructuredResponse(result.text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── タイムアウト ────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`解釈がタイムアウトしました（${ms / 1000}秒）`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// ── エントリポイント（ネットワークを伴うため自動テスト対象外。sdkRunner.ts runAgentQuery/
//    runPlainQuery と同じ既存の方針） ──────────────────────────────

export async function structureViaClaude(kind: LineRequestKind, freeText: string): Promise<StructureResult> {
  const prompt = kind === "idea" ? buildIdeaStructurePrompt(freeText) : buildResearchStructurePrompt(freeText);
  try {
    const result = await withTimeout(runPlainQuery(prompt, STRUCTURE_MODEL, { effort: STRUCTURE_EFFORT }), STRUCTURE_TIMEOUT_MS);
    if (!result.ok) return { ok: false, error: result.error ?? "解釈に失敗しました" };
    assertWithinBudget(result.costUsd, STRUCTURE_BUDGET_USD);
    return parseStructuredResponse(kind, result.text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
