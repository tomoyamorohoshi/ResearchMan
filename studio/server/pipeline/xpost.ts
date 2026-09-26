/**
 * LINE「X投稿」タブの実パイプライン（データ読み込み・Claude生成・検証・吹き出し組み立て）。
 * 設計: docs/X_POST_DRAFTS_DESIGN.md（v2）/ 生成仕様: docs/X_POST_RESEARCH.md セクションC。
 *
 * - Claude呼び出しはsdkRunner.ts::runPlainQueryを再利用する（ローカルClaude Code認証。
 *   従量課金APIキーは使わない。structure.tsと同じ流儀）。
 * - 入力はcases.json/tech.jsonの該当エントリのみ（DESIGN合意: エントリに無い事実・数字を
 *   足さない=ハルシネーション禁止をプロンプトで明示する）。
 * - 出力JSON（{postA:{text,claims}, postB:{text,claims}}）はxpostPure.ts::validateXPostDraftで
 *   検証する。文字数超過・URL混入・改行不足・claims不備（事実データに実在しない引用＝
 *   事実歪曲の疑い）等で失敗したら1回だけ再生成し、それでも失敗すればエラーとして返す
 *   （切り詰めはしない。DESIGN合意: 「切り詰めで意味を壊さない」）。
 * - セルフリプライ用テキスト（吹き出し③）はLLMではなくコード側で組み立てる（RMページURL・
 *   一次ソースURL/動画URLは事実そのものであり、生成に委ねる理由が無いため）。paste-ready
 *   （Xへそのまま貼れる体裁）を維持するため案内文は含めない。動画転載禁止ガイダンス・
 *   画像省略の注記は別のメモ吹き出し（最後・「📝メモ（投稿には含めない）」）に分離する
 *   （レビュー指摘2026-09-27）。
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
import { assertWithinBudget, BudgetExceededError } from "./budget.js";
import { extractJsonObject } from "../line/structure.js";
import { runPlainQuery, type AgentRunResult } from "./sdkRunner.js";
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
// レビュー指摘（2026-09-27・オーナー確認分）: 生成された投稿文に「有料フェスをやめて無料化
// した（実際は元々無料開催）」「即興開催（データに無い形容）」等の事実歪曲・誇張が混入した。
// プロンプトでの注意喚起だけでは防げないため、出力JSONにclaims（引用元フィールド名＋逐語引用）
// を必須化し、xpostPure.ts::validateXPostDraftで機械的に照合する（存在しない引用は却下）。

const SHARED_INSTRUCTIONS = `あなたはX（旧Twitter）向けの事例紹介投稿の文案を作るアシスタントです。
以下の事実データだけを根拠にしてください。データに無い事実・数字・固有名詞を絶対に足さないでください（ハルシネーション禁止）。

厳守事項（事実歪曲防止。過去に違反例あり）:
- データに「〜から〜へ変更した」「切り替えた」等の記述が無い限り、変化・ビフォーアフター・方針転換を勝手に示唆しない
  （例: 単に「無料開催」としか書かれていないものを「有料をやめて無料化した」と書かない）
- データに無い意図・速度・規模の形容語を足さない（例: 即興、世界初、話題沸騰、衝撃、伝説的、など）
- 紹介対象を見下す・軽視するような否定的・冷笑的な表現をしない（例: 「〜止まり」「〜にすぎない」等）
- 事実として書く内容は、必ず後述のclaims（引用）で裏付けられるものだけにする

構成ルール（X_POST_RESEARCH.md セクションCより）:
- 1行目で結論＋固有名詞（データにあれば数字も）を言い切る（フック行）。フック型（数字インパクト/意外性/人称化/逆説対比/断定ラベル）のいずれかを使う
- フック行→（改行して空行）→本文→（改行して空行）→締め、の3ブロック構成にする（最低2箇所の改行が必須）。壁テキストにしない
- 締めは中立的な問いかけ、またはその企画・技術の価値/使いどころについての断定的評価にする（煽り・釣り・見下し・冷笑は禁止）
- 絵文字は0〜1個まで。ハッシュタグは使わない
- 本文にURLを一切含めない（出典・リンクは本文とは別に扱うため）
- 日本語の目安は実質70〜140字程度（X加重文字数=CJK2・その他1で計算して280字以下に必ず収める。余裕を持って140字前後を狙う）
- postA と postB は異なるフック・構成にすること（同じ切り口の言い換えにしない）

claims（引用による裏付け。必須・最低1件）:
- 本文中に書いた事実の根拠となる、事実データの原文からの逐語引用を1件以上示すこと
- sourceFieldには、事実データに示された英語キー（例: "summary","overview","execution","evaluationImpact","point","detail"等）をそのまま使うこと
- quoteは、そのsourceFieldの原文に実在する部分文字列そのままにすること（要約・言い換え・翻訳は不可。改行や前後の空白の差異は許容される）

出力はJSONオブジェクトのみ（前置き・後書き・コードブロック記法なし）:
{"postA": {"text": "...", "claims": [{"sourceField": "...", "quote": "..."}]}, "postB": {"text": "...", "claims": [{"sourceField": "...", "quote": "..."}]}}`;

const CASE_FIELD_LABELS: Record<string, string> = {
  title: "タイトル",
  client: "クライアント",
  agency: "制作",
  award: "受賞",
  year: "年",
  summary: "概要",
  overview: "背景・企画意図",
  execution: "施策・実行内容",
  evaluationImpact: "評価・反響",
};

const TECH_FIELD_LABELS: Record<string, string> = {
  title: "ツール/技術名",
  org: "開発元",
  year: "発表時期",
  summary: "概要",
  point: "何がすごいか・使い所",
  detail: "詳細",
};

/** entry内の非空フィールドだけを {sourceFieldキー: 原文} として抽出する（プロンプトのfacts表示とclaims照合の両方で同じマップを使い、ズレを防ぐ）。 */
function buildEntryFields(entry: Record<string, unknown>, labels: Record<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(labels)) {
    const value = entry[key];
    if (typeof value === "string" && value.trim() !== "") fields[key] = value;
  }
  return fields;
}

function buildFactsSection(fields: Record<string, string>, labels: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${labels[key]} (sourceField: "${key}"): ${value}`)
    .join("\n");
}

function buildCasePrompt(entry: CaseRecordSlim): { prompt: string; fields: Record<string, string> } {
  const fields = buildEntryFields(entry as unknown as Record<string, unknown>, CASE_FIELD_LABELS);
  const facts = buildFactsSection(fields, CASE_FIELD_LABELS);
  const prompt = `${SHARED_INSTRUCTIONS}\n\n## 事実データ（クリエイティブ事例）\n${facts}`;
  return { prompt, fields };
}

function buildTechPrompt(entry: TechRecordSlim): { prompt: string; fields: Record<string, string> } {
  const fields = buildEntryFields(entry as unknown as Record<string, unknown>, TECH_FIELD_LABELS);
  const facts = buildFactsSection(fields, TECH_FIELD_LABELS);
  const prompt = `${SHARED_INSTRUCTIONS}\n\n## 事実データ（クリエイティブテック/ツール）\n${facts}\n\nテンプレC（技術ツール紹介）を意識してください: ツール名＋一言でできること→使い所→入手性の一言。`;
  return { prompt, fields };
}

// ── 一次ソース/動画URLの抽出 ─────────────────────────────────────────

function techVideoUrl(entry: TechRecordSlim): string | undefined {
  return entry.links.find((l) => l.kind === "video")?.url;
}

function techSourceUrl(entry: TechRecordSlim): string | undefined {
  return entry.links[0]?.url;
}

// ── サムネイル200確認（HEADリクエスト。失敗時は画像吹き出しを省略） ──────────

/**
 * サムネイルURLが実在する画像かどうかをHEADリクエストで確認する。
 * - 200以外は不可
 * - Content-Typeが image/* でなければ不可（レビュー指摘: 200だけでは静的ファイルの
 *   フォールバックページ等を誤って画像として送りかねない）
 * URLが空・空白のみの場合はリクエスト自体を送らずfalseを返す（レビュー指摘:
 * data/cases.json・tech.jsonのthumbnailが空文字のエントリでサイトルート`${SITE}`への
 * HEADになってしまうのを防ぐ。呼び出し側=findThumbnailUrlForで既にガードしているが、
 * この関数単体でも安全側に倒す）。
 */
function headOk(url: string, timeoutMs = 8000): Promise<boolean> {
  if (!url || !url.trim()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const req = https.request(url, { method: "HEAD" }, (res) => {
        const contentType = res.headers["content-type"] ?? "";
        settle((res.statusCode ?? 0) === 200 && contentType.startsWith("image/"));
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

/** thumbnailフィールドが空・空白のみならサムネイルURL自体を組み立てない（headOkのガードと二重化）。 */
function resolveThumbnailUrl(thumbnailField: string | undefined): string | undefined {
  if (!thumbnailField || !thumbnailField.trim()) return undefined;
  return `${SITE}${thumbnailField}`;
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

export type XPostQueryFn = (prompt: string) => Promise<AgentRunResult>;

/** 既定のClaude呼び出し（sdkRunner.ts::runPlainQuery）。テスト時はフェイクに差し替える。 */
const defaultQueryFn: XPostQueryFn = (prompt) => runPlainQuery(prompt, XPOST_MODEL, { effort: XPOST_EFFORT });

type DraftAttemptResult = { ok: true; draft: XPostDraft } | { ok: false; error: string };

async function generateDraftOnce(prompt: string, entryFields: Record<string, string>, queryFn: XPostQueryFn): Promise<DraftAttemptResult> {
  const result = await withTimeout(queryFn(prompt), XPOST_TIMEOUT_MS);
  if (!result.ok) return { ok: false, error: result.error ?? "生成に失敗しました" };
  assertWithinBudget(result.costUsd, XPOST_BUDGET_USD);
  const validated = validateXPostDraft(extractJsonObject(result.text), entryFields);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, draft: validated.value };
}

/**
 * generateDraftOnceを実行し、例外を投げた場合は失敗結果に正規化する。
 * ただしBudgetExceededErrorだけは再スローする（レビュー指摘: 予算超過は再生成せず即座に
 * 停止する。budget.ts::assertWithinBudgetのポリシーと矛盾させないため）。
 */
async function attemptDraft(prompt: string, entryFields: Record<string, string>, queryFn: XPostQueryFn): Promise<DraftAttemptResult> {
  try {
    return await generateDraftOnce(prompt, entryFields, queryFn);
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 検証失敗時・タイムアウト等の例外発生時に1回だけ再生成する（DESIGN合意: 「超過なら1回だけ
 * 再生成依頼、それでも超過ならエラー扱いで案を落とす（切り詰めで意味を壊さない）」。
 * レビュー指摘: 検証失敗だけでなく、runPlainQuery自体がタイムアウト等で例外を投げた場合も
 * 同様に1回だけ再試行する。BudgetExceededErrorだけは再試行せず呼び出し元へ伝播させる
 * （合計最大2回の試行）。事実歪曲・claims不備での却下（xpostPure.ts::validateXPostDraft）も
 * 同じ再試行ロジックに乗る（レビュー指摘: 「Existing retry-once logic applies to these
 * rejections too」）。
 */
export async function generateDraftWithRetry(
  prompt: string,
  entryFields: Record<string, string>,
  queryFn: XPostQueryFn = defaultQueryFn,
): Promise<DraftAttemptResult> {
  const first = await attemptDraft(prompt, entryFields, queryFn);
  if (first.ok) return first;
  const retryPrompt = `${prompt}\n\n【再生成】前回の出力は条件を満たしませんでした（理由: ${first.error}）。この条件を満たすよう作り直してください。`;
  const second = await attemptDraft(retryPrompt, entryFields, queryFn);
  if (second.ok) return second;
  return { ok: false, error: `生成した投稿文が条件を満たせませんでした（再生成後も失敗）: ${second.error}` };
}

// ── エントリポイント ─────────────────────────────────────────────────

export async function generateXPost(entryKind: XPostEntryKind, entryId: string): Promise<XPostGenerationResult> {
  try {
    if (entryKind === "case") {
      const entry = await findCase(entryId);
      if (!entry) return { ok: false, error: `事例 ${entryId} が見つかりませんでした` };

      const { prompt: casePrompt, fields: caseFields } = buildCasePrompt(entry);
      const drafted = await generateDraftWithRetry(casePrompt, caseFields);
      if (!drafted.ok) return { ok: false, error: drafted.error };

      const thumbnailUrl = resolveThumbnailUrl(entry.thumbnail);
      const includeImage = thumbnailUrl ? await headOk(thumbnailUrl) : false;
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

    const { prompt: techPrompt, fields: techFields } = buildTechPrompt(entry);
    const drafted = await generateDraftWithRetry(techPrompt, techFields);
    if (!drafted.ok) return { ok: false, error: drafted.error };

    const thumbnailUrl = resolveThumbnailUrl(entry.thumbnail);
    const includeImage = thumbnailUrl ? await headOk(thumbnailUrl) : false;
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
