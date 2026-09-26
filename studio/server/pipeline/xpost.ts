/**
 * LINE「X投稿」タブの実パイプライン（データ読み込み・Claude生成・検証・吹き出し組み立て）。
 * 設計: docs/X_POST_DRAFTS_DESIGN.md（v2）/ 生成仕様: docs/X_POST_RESEARCH.md セクションC。
 *
 * - Claude呼び出しはsdkRunner.ts::runPlainQueryを再利用する（ローカルClaude Code認証。
 *   従量課金APIキーは使わない。structure.tsと同じ流儀）。
 * - 入力はcases.json/tech.jsonの該当エントリのみ（DESIGN合意: エントリに無い事実・数字を
 *   足さない=ハルシネーション禁止をプロンプトで明示する）。
 * - 出力JSON（postA/postB）はxpostPure.ts::validateXPostDraftで検証する。超過・URL混入等で
 *   失敗したら1回だけ再生成し、それでも失敗すればエラーとして返す（切り詰めはしない。
 *   DESIGN合意: 「切り詰めで意味を壊さない」）。
 * - セルフリプライ用テキスト（吹き出し③）はLLMではなくコード側で組み立てる（RMページURL・
 *   一次ソースURL・動画注記は事実そのものであり、生成に委ねる理由が無いため）。
 * - サムネイル画像URLの本番200確認は軽量なHEADリクエストで行う（失敗時は画像吹き出しを
 *   省略する。DESIGN合意）。
 *
 * ネットワーク・実際のClaude呼び出しを伴うため自動テスト対象外（structure.ts::structureViaClaude
 * と同じ方針。純粋部分はxpostPure.tsに切り出し済み）。
 */
import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWithinBudget } from "./budget.js";
import { extractJsonObject } from "../line/structure.js";
import { runPlainQuery } from "./sdkRunner.js";
import {
  buildXPostBubbles,
  validateXPostDraft,
  type LineMessage,
  type XPostDraft,
  type XPostEntryKind,
  type XPostSourceInfo,
} from "../line/xpostPure.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/pipeline -> repo root
const CASES_PATH = path.join(ROOT, "data", "cases.json");
const TECH_PATH = path.join(ROOT, "data", "tech.json");
const SITE = "https://research-man.vercel.app";

const XPOST_MODEL = "sonnet";
const XPOST_EFFORT = "high" as const;
const XPOST_TIMEOUT_MS = 90_000;
/** 生成1回分の小さな予算上限（structure.ts::STRUCTURE_BUDGET_USDと同じ考え方）。 */
const XPOST_BUDGET_USD = 0.5;

export type XPostGenerationResult = { ok: true; messages: LineMessage[] } | { ok: false; error: string };

interface CaseRecordSlim {
  id: string;
  title: string;
  summary: string;
  client: string;
  agency: string;
  award: string;
  year: string;
  link: string;
  thumbnail: string;
  videoId?: string;
  overview: string;
  execution: string;
  evaluationImpact: string;
}

interface TechRecordSlim {
  id: string;
  title: string;
  org: string;
  year: string;
  summary: string;
  point: string;
  detail?: string;
  thumbnail: string;
  links: Array<{ kind: string; url: string }>;
}

async function loadJson<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T[];
}

async function findCase(id: string): Promise<CaseRecordSlim | null> {
  const cases = await loadJson<CaseRecordSlim>(CASES_PATH);
  return cases.find((c) => c.id === id) ?? null;
}

async function findTech(id: string): Promise<TechRecordSlim | null> {
  const techItems = await loadJson<TechRecordSlim>(TECH_PATH);
  return techItems.find((t) => t.id === id) ?? null;
}

// ── プロンプト（X_POST_RESEARCH.md セクションCを要約して組み込む） ────────────

const SHARED_INSTRUCTIONS = `あなたはX（旧Twitter）向けの事例紹介投稿の文案を作るアシスタントです。
以下の事実データだけを根拠にしてください。データに無い事実・数字・固有名詞を絶対に足さないでください（ハルシネーション禁止）。

構成ルール（X_POST_RESEARCH.md セクションCより）:
- 1行目で結論＋固有名詞（データにあれば数字も）を言い切る。フック型（数字インパクト/意外性/人称化/逆説対比/断定ラベル）のいずれかを使う
- 改行で3〜5ブロックに区切る（壁テキストにしない）
- 締めは問いかけ or 断定的評価で読者の返信を誘発する（煽り・釣りは禁止）
- 絵文字は0〜1個まで。ハッシュタグは使わない
- 本文にURLを一切含めない（出典・リンクは本文とは別に扱うため）
- 日本語の目安は実質70〜140字程度（X加重文字数=CJK2・その他1で計算して280字以下に必ず収める。余裕を持って140字前後を狙う）
- postA と postB は異なるフック・構成にすること（同じ切り口の言い換えにしない）

出力はJSONオブジェクトのみ（前置き・後書き・コードブロック記法なし）:
{"postA": "...", "postB": "..."}`;

function buildCasePrompt(entry: CaseRecordSlim): string {
  const facts = [
    `タイトル: ${entry.title}`,
    entry.client ? `クライアント: ${entry.client}` : null,
    entry.agency ? `制作: ${entry.agency}` : null,
    entry.award ? `受賞: ${entry.award}` : null,
    entry.year ? `年: ${entry.year}` : null,
    entry.summary ? `概要: ${entry.summary}` : null,
    entry.overview ? `背景・企画意図: ${entry.overview}` : null,
    entry.execution ? `施策・実行内容: ${entry.execution}` : null,
    entry.evaluationImpact ? `評価・反響: ${entry.evaluationImpact}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${SHARED_INSTRUCTIONS}\n\n## 事実データ（クリエイティブ事例）\n${facts}`;
}

function buildTechPrompt(entry: TechRecordSlim): string {
  const facts = [
    `ツール/技術名: ${entry.title}`,
    entry.org ? `開発元: ${entry.org}` : null,
    entry.year ? `発表時期: ${entry.year}` : null,
    entry.summary ? `概要: ${entry.summary}` : null,
    entry.point ? `何がすごいか・使い所: ${entry.point}` : null,
    entry.detail ? `詳細: ${entry.detail}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${SHARED_INSTRUCTIONS}\n\n## 事実データ（クリエイティブテック/ツール）\n${facts}\n\nテンプレC（技術ツール紹介）を意識してください: ツール名＋一言でできること→使い所→入手性の一言。`;
}

// ── 一次ソース/動画URLの抽出 ─────────────────────────────────────────

function techVideoUrl(entry: TechRecordSlim): string | undefined {
  return entry.links.find((l) => l.kind === "video")?.url;
}

function techSourceUrl(entry: TechRecordSlim): string | undefined {
  return entry.links[0]?.url;
}

// ── サムネイル200確認（HEADリクエスト。失敗時は画像吹き出しを省略） ──────────

function headOk(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const req = https.request(url, { method: "HEAD" }, (res) => {
        settle((res.statusCode ?? 0) === 200);
      });
      req.on("error", () => settle(false));
      req.setTimeout(timeoutMs, () => {
        settle(false);
        req.destroy();
      });
      req.end();
    } catch {
      settle(false);
    }
  });
}

// ── タイムアウト（structure.tsと同じパターン） ──────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`生成がタイムアウトしました（${ms / 1000}秒）`)), ms);
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

async function generateDraftOnce(prompt: string): Promise<{ ok: true; draft: XPostDraft } | { ok: false; error: string }> {
  const result = await withTimeout(runPlainQuery(prompt, XPOST_MODEL, { effort: XPOST_EFFORT }), XPOST_TIMEOUT_MS);
  if (!result.ok) return { ok: false, error: result.error ?? "生成に失敗しました" };
  assertWithinBudget(result.costUsd, XPOST_BUDGET_USD);
  const validated = validateXPostDraft(extractJsonObject(result.text));
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, draft: validated.value };
}

/**
 * 検証失敗時に1回だけ再生成する（DESIGN合意: 「超過なら1回だけ再生成依頼、それでも超過なら
 * エラー扱いで案を落とす（切り詰めで意味を壊さない）」）。
 */
async function generateDraftWithRetry(prompt: string): Promise<{ ok: true; draft: XPostDraft } | { ok: false; error: string }> {
  const first = await generateDraftOnce(prompt);
  if (first.ok) return first;
  const retryPrompt = `${prompt}\n\n【再生成】前回の出力は条件を満たしませんでした（理由: ${first.error}）。この条件を満たすよう作り直してください。`;
  const second = await generateDraftOnce(retryPrompt);
  if (second.ok) return second;
  return { ok: false, error: `生成した投稿文が条件を満たせませんでした（再生成後も失敗）: ${second.error}` };
}

// ── エントリポイント ─────────────────────────────────────────────────

export async function generateXPost(entryKind: XPostEntryKind, entryId: string): Promise<XPostGenerationResult> {
  try {
    if (entryKind === "case") {
      const entry = await findCase(entryId);
      if (!entry) return { ok: false, error: `事例 ${entryId} が見つかりませんでした` };

      const drafted = await generateDraftWithRetry(buildCasePrompt(entry));
      if (!drafted.ok) return { ok: false, error: drafted.error };

      const thumbnailUrl = `${SITE}${entry.thumbnail}`;
      const includeImage = await headOk(thumbnailUrl);
      const sourceInfo: XPostSourceInfo = {
        rmUrl: `${SITE}/cases/${entryId}`,
        sourceUrl: entry.link || undefined,
        videoUrl: entry.videoId ? `https://www.youtube.com/watch?v=${entry.videoId}` : undefined,
        thumbnailUrl,
      };
      return { ok: true, messages: buildXPostBubbles(drafted.draft, sourceInfo, includeImage) };
    }

    const entry = await findTech(entryId);
    if (!entry) return { ok: false, error: `技術 ${entryId} が見つかりませんでした` };

    const drafted = await generateDraftWithRetry(buildTechPrompt(entry));
    if (!drafted.ok) return { ok: false, error: drafted.error };

    const thumbnailUrl = `${SITE}${entry.thumbnail}`;
    const includeImage = await headOk(thumbnailUrl);
    const sourceInfo: XPostSourceInfo = {
      rmUrl: `${SITE}/technology/${entryId}`,
      sourceUrl: techSourceUrl(entry),
      videoUrl: techVideoUrl(entry),
      thumbnailUrl,
    };
    return { ok: true, messages: buildXPostBubbles(drafted.draft, sourceInfo, includeImage) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
