/**
 * 切り口ライブラリ（data/idea-angles.json）の読み込み・検証・初版生成。
 * DESIGN.md §6 idea: 「全Case Studyから繰り返し現れる創造メカニズムを蒸留した15〜25語彙」。
 *
 * 初版は本ファイルの generateIdeaAngles() を Agent SDK 1パスで実行して作る
 * （実行は studio/server/pipeline/generateIdeaAnglesCli.ts から。このファイル自体は
 * どこからもmain()を即実行しない — jst-date.mjsと同じ「importするだけで本番処理が走る
 * 事故の防止」の方針）。
 *
 * 隔週チューンアップによる維持は将来接続（今回はファイル新設のみ。既存スクリプトは無改変）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CaseRecord } from "./ideaPure.js";
import { formatCaseLine } from "./ideaPure.js";
import { runPlainQuery } from "./sdkRunner.js";

export interface IdeaAngle {
  id: string;
  label: string;
  description: string;
  exemplarCaseIds: string[];
}

const MIN_ANGLES = 15;
const MAX_ANGLES = 25;

export function ideaAnglesPath(root: string): string {
  return path.join(root, "data", "idea-angles.json");
}

/** data/idea-angles.json を読み込む（実行時パイプラインが使う。形式不正はthrow）。 */
export function loadIdeaAngles(root: string): IdeaAngle[] {
  const raw = JSON.parse(readFileSync(ideaAnglesPath(root), "utf-8"));
  if (!Array.isArray(raw)) throw new Error("data/idea-angles.json が配列ではありません");
  return raw as IdeaAngle[];
}

// ── 生成プロンプト（純粋関数・単体テスト対象） ────────────────────────

const EXAMPLE_VOCAB = "見立て / 媒体の物理特性 / 機能の転用 / 参加型 / 引き算・不在 / データを素材化 / 制約を武器に";

export function buildIdeaAnglesPrompt(caseLines: string): string {
  return `あなたはクリエイティブ事例のアーキビストです。以下は ResearchMan（クリエイティブ事例データベース）に
登録されている Case Study の一覧です。この全体から、作品を横断して繰り返し現れる
「発想の型（切り口・創造メカニズム）」を蒸留してください。

# 事例一覧（各行の先頭 [id] は参照用）
${caseLines}

# 切り口とは
個別の事例の内容ではなく、事例が使っている「発想の構造」です。例（参考。この語彙に縛られず
実データから帰納してよい）: ${EXAMPLE_VOCAB}

# ルール
- 15〜25個の切り口を出す。互いに明確に区別できること（意味が重なるものは1つにまとめる）
- 各切り口は実際に複数の事例に共通して見られるものに限る（1事例だけの特徴は不可）
- id は英数字とハイフンのみの短いスラッグ（例: "mitate", "medium-physicality"）
- label は日本語の短い名詞句（4〜10字程度）
- description は「その切り口が何をする発想か」を1文（30〜60字、日本語）で説明する
- exemplarCaseIds には、その切り口を体現している事例の [id] を2〜6個、上の一覧から正確に転記する
  （創作・改変禁止。実在しないidを書かない）

# 出力
JSON配列のみ（前置き・後書きなし）:
[{"id": "...", "label": "...", "description": "...", "exemplarCaseIds": ["...", "..."]}]`;
}

// ── 生成結果の機械検証（純粋関数・単体テスト対象） ────────────────────

export type IdeaAnglesValidation =
  | { ok: true; angles: IdeaAngle[] }
  | { ok: false; error: string };

/**
 * 生成結果を検証・浄化する: JSON形状チェック→exemplarCaseIdsを実在idのみに絞り込み→
 * exemplarが0件になった切り口は破棄→id重複は先勝ち→最終件数が15〜25でなければ失敗
 * （25件超は先頭25件に丸める。多すぎること自体は害が小さいため丸めで救済する）。
 */
export function validateIdeaAngles(raw: unknown, validCaseIds: Set<string>): IdeaAnglesValidation {
  if (!Array.isArray(raw)) return { ok: false, error: "JSON配列ではありません" };

  const seenIds = new Set<string>();
  const cleaned: IdeaAngle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    const description = typeof rec.description === "string" ? rec.description.trim() : "";
    if (!id || !label || !description) continue;
    if (seenIds.has(id)) continue;
    const exemplarCaseIds = Array.isArray(rec.exemplarCaseIds)
      ? (rec.exemplarCaseIds as unknown[]).filter(
          (x): x is string => typeof x === "string" && validCaseIds.has(x),
        )
      : [];
    if (exemplarCaseIds.length === 0) continue;
    seenIds.add(id);
    cleaned.push({ id, label, description, exemplarCaseIds });
  }

  if (cleaned.length < MIN_ANGLES) {
    return { ok: false, error: `有効な切り口が${cleaned.length}個しかありません（最低${MIN_ANGLES}個必要）` };
  }
  return { ok: true, angles: cleaned.slice(0, MAX_ANGLES) };
}

// ── 生成オーケストレーション（Agent SDK呼び出しを伴うためテスト対象外。
//    caseResearch.tsの各Agent呼び出しと同じ位置づけ） ────────────────

/**
 * data/cases.json 全件からプロンプトを組み立て、Agent SDK 1パスで切り口ライブラリを生成する。
 * 不正なJSON・検証失敗時は最大3回まで再試行する（generate-idea-seeds.mjsのgenerateOnceと
 * 同じ再試行方針）。
 */
export async function generateIdeaAngles(cases: CaseRecord[]): Promise<IdeaAngle[]> {
  const caseLines = cases.map(formatCaseLine).join("\n");
  const prompt = buildIdeaAnglesPrompt(caseLines);
  const validCaseIds = new Set(cases.map((c) => c.id));

  const MAX_ATTEMPTS = 3;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runPlainQuery(prompt, "sonnet");
    if (!result.ok) {
      lastError = result.error || "生成呼び出しに失敗しました";
      continue;
    }
    const start = result.text.indexOf("[");
    const end = result.text.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) {
      lastError = "JSON配列が見つかりませんでした";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text.slice(start, end + 1));
    } catch (e) {
      lastError = `JSON解析エラー: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
    const validation = validateIdeaAngles(parsed, validCaseIds);
    if (validation.ok) return validation.angles;
    lastError = validation.error;
  }
  throw new Error(`切り口ライブラリの生成に${MAX_ATTEMPTS}回失敗しました: ${lastError}`);
}
