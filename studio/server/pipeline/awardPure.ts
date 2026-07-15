/**
 * アワードリサーチジョブの純粋関数群（ネットワーク/git/Agent SDK/ファイルI/Oに触れない部分）。
 * docs/AWARD_RESEARCH_SOP.md の5フェーズ（公式ソース確定→参照リスト構築→参照リスト確定→
 * 執筆→監査ゲート）を低優先・一時停止/再開可能なジョブとして実行する awardResearch.ts が
 * このモジュールに依存する（caseResearch.ts/pure.ts と同じ役割分担）。
 *
 * jobs.ts::clampCount と同様、jobs.ts と本ファイルは相互import になる
 * （jobs.ts が validateAwardRequest/isPriorityRunningJob を使い、本ファイルは特に
 * jobs.ts型に依存しない構造的部分型のみを受け取る）。既存 pure.ts⇄jobs.ts の循環import
 * と同型のため、ESMの安全性は既存実績で担保済み。
 */
import { normalizeTitleKey } from "./pure.js";

// ── 受賞レベル語彙（src/lib/awardLevel.ts の6語彙をLINE/構造化入力の正規化に使う） ──

export type AwardLevelName = "Grand Prix" | "Titanium" | "Gold" | "Silver" | "Bronze" | "Shortlist";

/** ランクは小さいほど上位（Grand Prix=0 が最上位、Shortlist=5 が最下位＝全レベル含む）。 */
export const AWARD_LEVEL_ORDER: AwardLevelName[] = ["Grand Prix", "Titanium", "Gold", "Silver", "Bronze", "Shortlist"];

const LEVEL_RANK: Record<AwardLevelName, number> = Object.fromEntries(
  AWARD_LEVEL_ORDER.map((lvl, i) => [lvl, i]),
) as Record<AwardLevelName, number>;

// 日本語表記ゆれ→英語語彙のマップ（LINEの自由文入力向け）。
const JA_LEVEL_MAP: Array<{ ja: string; level: AwardLevelName }> = [
  { ja: "グランプリ", level: "Grand Prix" },
  { ja: "チタニウム", level: "Titanium" },
  { ja: "ゴールド", level: "Gold" },
  { ja: "シルバー", level: "Silver" },
  { ja: "ブロンズ", level: "Bronze" },
  { ja: "ショートリスト", level: "Shortlist" },
];

const ALL_LEVELS_RE = /全レベル|全て|すべて|全部/;

/**
 * 「ブロンズ以上」「Gold以上」「全レベル」等の自由文からレベル下限を判定する。
 * 「全レベル」は最下位ランク(Shortlist)を返すことで「以上」判定が全件を含むようにする。
 * 認識できない場合は安全側の既定値 Bronze にフォールバックする（Shortlistまで下げると
 * 未検証の入賞候補まで拾ってしまい、award-verifierの検証コストが跳ね上がるため）。
 */
export function parseMinLevel(text: string): AwardLevelName {
  const t = (text || "").trim();
  // 明示的なレベル語彙が含まれていればそれを優先する（「全部門(ブロンズ以上)」のように
  // 「全部門」に「全」を含む語と具体レベル語が同居する複合文があるため、"全レベル"的な
  // 判定より先にチェックする）。
  for (const level of AWARD_LEVEL_ORDER) {
    if (t.toLowerCase().includes(level.toLowerCase())) return level;
  }
  for (const { ja, level } of JA_LEVEL_MAP) {
    if (t.includes(ja)) return level;
  }
  if (ALL_LEVELS_RE.test(t)) return "Shortlist";
  return "Bronze";
}

/** level（任意の受賞レベル文字列）が minLevel 以上（同ランクか、より上位）かどうか。 */
export function meetsMinLevel(level: string, minLevel: AwardLevelName): boolean {
  const found = AWARD_LEVEL_ORDER.find((l) => l.toLowerCase() === (level || "").trim().toLowerCase());
  if (!found) return false; // 未知のレベル表記は安全側でfalse（fail-closed）
  return LEVEL_RANK[found] <= LEVEL_RANK[minLevel];
}

// ── 部門テキストのパース ────────────────────────────────────────

const ALL_CATEGORIES_RE = /全部門|全て|すべて|全部/;
const CATEGORY_SPLIT_RE = /[、,，・/／]+/;

/** 「全部門(ブロンズ以上)」等の自由文から部門指定を判定する。個別列挙は配列に分解する。 */
export function parseCategoriesText(text: string): "all" | string[] {
  const t = (text || "").trim();
  if (!t) return "all";
  // レベル語彙・括弧書きを取り除いてから部門名部分だけ判定する
  const withoutParens = t.replace(/[（(].*?[）)]/g, "").trim();
  if (ALL_CATEGORIES_RE.test(withoutParens) || !withoutParens) return "all";
  return withoutParens
    .split(CATEGORY_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── リクエスト検証（jobs.ts::createJob("awards", ...) が呼ぶ唯一の検証入口） ──────

export interface ValidatedAwardRequest {
  awardName: string;
  year: string;
  categories: "all" | string[];
  minLevel: AwardLevelName;
  lineUserId: string;
  dryRun: boolean;
}

export type AwardValidationResult =
  | { ok: true; value: ValidatedAwardRequest }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const MIN_LEVEL_SET = new Set<string>(AWARD_LEVEL_ORDER);

export function validateAwardRequest(request: Record<string, unknown>): AwardValidationResult {
  const awardName = str(request.awardName);
  if (!awardName) {
    return { ok: false, error: "アワード名を入力してください" };
  }
  const year = str(request.year);
  if (!year) {
    return { ok: false, error: "年を入力してください" };
  }
  let categories: "all" | string[] = "all";
  if (Array.isArray(request.categories)) {
    categories = request.categories.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  } else if (typeof request.categories === "string" && request.categories !== "all") {
    categories = parseCategoriesText(request.categories);
  }
  const minLevelRaw = str(request.minLevel) || "Bronze";
  if (!MIN_LEVEL_SET.has(minLevelRaw)) {
    return { ok: false, error: "レベル下限が不正です（Grand Prix/Titanium/Gold/Silver/Bronze/Shortlistのいずれか）" };
  }
  return {
    ok: true,
    value: {
      awardName,
      year,
      categories,
      minLevel: minLevelRaw as AwardLevelName,
      lineUserId: str(request.lineUserId),
      dryRun: request.dryRun === true,
    },
  };
}

// ── コスト予算（アワードは低優先バックグラウンドジョブのため、通常ジョブの予算
//    STUDIO_JOB_BUDGET_USD(既定$5)とは別枠にする。budget.ts::resolveJobBudgetUsdと同じ
//    フォールバック方針）。 ────────────────────────────────────────

export const DEFAULT_AWARD_BUDGET_USD = 30;

export function resolveAwardBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STUDIO_AWARD_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_AWARD_BUDGET_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AWARD_BUDGET_USD;
}

// ── 進捗% ────────────────────────────────────────────────────────

export type AwardPhase = "P1" | "P2" | "P3" | "P4" | "P5";

const PHASE_RANGES: Record<AwardPhase, { from: number; to: number }> = {
  P1: { from: 0, to: 5 },
  P2: { from: 5, to: 40 },
  P3: { from: 40, to: 45 },
  P4: { from: 45, to: 90 },
  P5: { from: 90, to: 100 },
};

/** フェーズ内の (done/total) からジョブ全体の進捗%を計算する。total<=0はフェーズ開始%を返す。 */
export function computePhaseProgress(phase: AwardPhase, done: number, total: number): number {
  const { from, to } = PHASE_RANGES[phase];
  if (total <= 0) return from;
  const frac = Math.min(1, Math.max(0, done / total));
  return from + (to - from) * frac;
}

// ── checkpoint（再開可能性の唯一の情報源。ジョブJSONに自己完結させる） ──────────

export interface AwardCheckpointWinner {
  category: string;
  subcategory: string;
  level: string;
  title: string;
  brand: string;
  agency: string;
  sourceUrl: string;
}

export interface AwardCheckpointWrittenEntry {
  /** cases.json に書き込む予定のエントリ（案。P5でまとめて書き込む）。 */
  entry: Record<string, unknown>;
  /** 取得済みサムネイルのROOT基準相対パス（"public/..."）。 */
  thumbnailPath: string;
}

// 指摘1【重大】再発防止: P5がcommit/push済みかを示すフラグがcheckpointに無いと、
// P5途中またはcommit直後にプロセスが落ちて再開した際、runCoreの再開は
// checkpoint.phase到達済みの各フェーズを常に再実行する構造のため、P5も無条件に
// 再実行されてしまい、cases.jsonに同一エントリが重複prependされ二重コミットされる。
// - "pending": P5未着手、またはロールバック済み（ファイル書き込みからやり直してよい）
// - "files-written": cases.json/winners.jsonを書き込み済み・commit未実施
//   （監査失敗等でロールバックされたら"pending"に戻す）
// - "committed": git commit済み・push未確認（再開時はファイル書き込み/監査/commitを
//   スキップし、push以降の完了処理のみ行う）
export type AwardP5Status = "pending" | "files-written" | "committed";

const P5_STATUS_SET = new Set<string>(["pending", "files-written", "committed"]);

export interface AwardCheckpoint {
  phase: AwardPhase;
  /** P1で確定した公式受賞者一覧のURL。 */
  officialSourceUrl: string;
  /** P1で得た部門別ページの構成メモ（P2の部門別クロールの手がかり。再開時にも使えるよう保持）。 */
  structureNote: string;
  /** categories:"all"指定時に一度だけ解決した具体的な部門名一覧（再開時に再解決しないための
   * キャッシュ。categoriesが配列指定の場合はそのまま同じ内容が入る）。 */
  resolvedCategories: string[];
  /** P2で処理完了（成功・失敗いずれか確定）した部門名（境界の再開判定に使う）。 */
  categoriesDone: string[];
  /** categoriesDoneのうち、award-verifier呼び出し自体が失敗し一次ソース照合できなかった部門
   * （P5完了報告の「未照合部門」内訳に使う）。 */
  categoriesFailed: string[];
  /** P2で収集済みの全winners（部門横断で蓄積）。 */
  collectedWinners: AwardCheckpointWinner[];
  /** P4で執筆済みだがcases.json未書き込みのエントリ（P5でまとめて書く）。 */
  writtenEntries: AwardCheckpointWrittenEntry[];
  /** P4で処理済み（執筆または却下確定）のwork単位キー（normalizeTitleKey）。再開時の重複処理防止。 */
  writtenTitleKeys: string[];
  /** P5の進行状態（冪等な再開判定に使う。上記コメント参照）。 */
  p5: AwardP5Status;
}

export function emptyAwardCheckpoint(): AwardCheckpoint {
  return {
    phase: "P1",
    officialSourceUrl: "",
    structureNote: "",
    resolvedCategories: [],
    categoriesDone: [],
    categoriesFailed: [],
    collectedWinners: [],
    writtenEntries: [],
    writtenTitleKeys: [],
    p5: "pending",
  };
}

const PHASE_SET = new Set<string>(["P1", "P2", "P3", "P4", "P5"]);

/**
 * ジョブJSON（checkpointフィールド。unknown）→ AwardCheckpoint。欠損フィールドは安全な
 * 既定値で補い、null/非オブジェクト/壊れた値はempty checkpointへフォールバックする
 * （pending.ts::loadPendingと同じ「壊れたデータで例外を投げない」方針）。
 */
export function parseAwardCheckpoint(raw: unknown): AwardCheckpoint {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyAwardCheckpoint();
  const r = raw as Partial<AwardCheckpoint>;
  return {
    phase: typeof r.phase === "string" && PHASE_SET.has(r.phase) ? (r.phase as AwardPhase) : "P1",
    officialSourceUrl: typeof r.officialSourceUrl === "string" ? r.officialSourceUrl : "",
    structureNote: typeof r.structureNote === "string" ? r.structureNote : "",
    resolvedCategories: Array.isArray(r.resolvedCategories) ? r.resolvedCategories.filter((c): c is string => typeof c === "string") : [],
    categoriesDone: Array.isArray(r.categoriesDone) ? r.categoriesDone.filter((c): c is string => typeof c === "string") : [],
    categoriesFailed: Array.isArray(r.categoriesFailed) ? r.categoriesFailed.filter((c): c is string => typeof c === "string") : [],
    collectedWinners: Array.isArray(r.collectedWinners) ? (r.collectedWinners as AwardCheckpointWinner[]) : [],
    writtenEntries: Array.isArray(r.writtenEntries) ? (r.writtenEntries as AwardCheckpointWrittenEntry[]) : [],
    writtenTitleKeys: Array.isArray(r.writtenTitleKeys) ? r.writtenTitleKeys.filter((k): k is string => typeof k === "string") : [],
    p5: typeof r.p5 === "string" && P5_STATUS_SET.has(r.p5) ? (r.p5 as AwardP5Status) : "pending",
  };
}

// ── 冪等ガード（指摘1【重大】多重防御その2） ────────────────────────────
// checkpoint.p5による再実行スキップに加え、万一P5の書き込み処理自体が再実行された場合でも
// （例: 手動でcheckpointを弄った・想定外の経路での再呼び出し）cases.jsonへの二重prependを
// 防ぐ最終防波堤。既存id集合に含まれるエントリは新規追加対象から除外する。
export function dedupeNewCaseEntries<T extends { id: string }>(existingIds: Set<string> | string[], newEntries: T[]): T[] {
  const ids = existingIds instanceof Set ? existingIds : new Set(existingIds);
  return newEntries.filter((e) => !ids.has(e.id));
}

// ── 重複連結（複数部門受賞を1エントリの award 文字列にまとめる） ─────────────────

export interface GroupedAwardWork {
  titleKey: string;
  title: string;
  brand: string;
  agency: string;
  records: Array<{ category: string; subcategory: string; level: string; sourceUrl: string }>;
}

/**
 * 正規化タイトル＋正規化ブランドが同じwinnerを1つのworkにまとめる
 * （同一作品の複数部門受賞をまとめるため）。
 * 指摘3【中】再発防止: タイトルのみでグルーピングすると、同名タイトルの別ブランド作品
 * （同名キャンペーンを別ブランドが別市場で展開するケース等）が1エントリに誤統合される。
 * ブランドも正規化キーに含め、タイトルが同じでもブランドが異なれば別workとして扱う。
 */
export function groupWinnersByWork(winners: AwardCheckpointWinner[]): GroupedAwardWork[] {
  const byKey = new Map<string, GroupedAwardWork>();
  for (const w of winners) {
    const key = `${normalizeTitleKey(w.title)}::${normalizeTitleKey(w.brand)}`;
    let group = byKey.get(key);
    if (!group) {
      group = { titleKey: key, title: w.title, brand: w.brand, agency: w.agency, records: [] };
      byKey.set(key, group);
    }
    group.records.push({ category: w.category, subcategory: w.subcategory, level: w.level, sourceUrl: w.sourceUrl });
  }
  return Array.from(byKey.values());
}

/**
 * cases.json の award 欄に書く文字列を組み立てる（既存の実データ規約 — 例:
 * "Cannes Lions 2026 Outdoor Lions Gold / Cannes Lions 2026 Brand Experience & Activation Lions Silver" —
 * に合わせ、`${awardName} ${year} ${category} ${level}` を " / " で連結する）。
 */
export function buildAwardEntryString(
  awardName: string,
  year: string,
  records: Array<{ category: string; level: string }>,
): string {
  return records.map((r) => `${awardName} ${year} ${r.category} ${r.level}`.replace(/\s+/g, " ").trim()).join(" / ");
}

// ── commitメッセージ ────────────────────────────────────────────

export function buildAwardCommitMessage(awardName: string, year: string, count: number): string {
  return `Studio research: ${awardName} ${year} ${count}件追加 (Awards)`;
}

// ── 低優先実行: 他ジョブ（research/add-case）優先判定 ─────────────────────────

export interface JobLike {
  id: string;
  tab: string;
  status: string;
}

/**
 * research/add-caseのrunningジョブは「優先ジョブ」として扱う（idea/awards同士は優先関係なし。
 * jobs.ts::listRunningPriorityJobs がこの判定でlistJobs()結果をフィルタする）。
 */
export function isPriorityRunningJob(job: JobLike, excludeId: string): boolean {
  return job.id !== excludeId && job.status === "running" && (job.tab === "research" || job.tab === "add-case");
}

// ── サーバ起動時の復帰分類 ───────────────────────────────────────

export type StartupAction = "mark-restart-and-resume" | "auto-resume" | "wait-budget" | "ignore";

export interface StartupJobLike {
  tab: string;
  status: string;
  pausedReason?: string;
}

/**
 * サーバ起動時、workdir/jobs 走査結果の各ジョブに対して取るべきアクションを判定する。
 * - status:"running"（プロセス死で孤児化） → まずpausedへ落としてから自動再開
 * - status:"paused" かつ pausedReason が "priority-job"/"restart" → 自動再開
 * - status:"paused" かつ pausedReason が "budget" → ユーザーの「再開」待ち
 * - それ以外（awards以外のtab・done/error） → 無視
 */
export function classifyAwardJobForStartup(job: StartupJobLike): StartupAction {
  if (job.tab !== "awards") return "ignore";
  if (job.status === "running") return "mark-restart-and-resume";
  if (job.status === "paused") {
    if (job.pausedReason === "budget") return "wait-budget";
    if (job.pausedReason === "priority-job" || job.pausedReason === "restart") return "auto-resume";
  }
  return "ignore";
}
