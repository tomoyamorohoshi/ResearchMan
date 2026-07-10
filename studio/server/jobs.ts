/**
 * ジョブストア。
 *
 * research タブは Case Study(P1)/Technology(P2)/両方(P2) が、idea タブは P3 が
 * それぞれ実パイプライン化済み。POST /api/jobs は status="running" のジョブを即座に返し、
 * 実処理（収集/生成〜反映。Claude Agent SDK）はバックグラウンドで進行して
 * studio/workdir/jobs/<id>.json を随時更新する（DESIGN.md §10・非同期ジョブ+ポーリングの
 * アーキテクチャ）。
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCaseResearchPipeline } from "./pipeline/caseResearch.js";
import { runCombinedResearchPipeline } from "./pipeline/combinedResearch.js";
import { runIdeaResearchPipeline } from "./pipeline/ideaResearch.js";
import { runTechResearchPipeline } from "./pipeline/techResearch.js";
import { validateResearchRequest } from "./pipeline/pure.js";
import { validateIdeaRequest } from "./pipeline/ideaPure.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, "..", "workdir", "jobs");

// job id は createJob 内の randomUUID() 由来。getJob に渡された id はこの
// 形式でなければファイルパスに使わずnullを返す（パス・トラバーサル対策）。
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tab = "research" | "idea";

export interface CaseChip {
  label: string;
  jp: boolean;
}

export interface IdeaRefChip {
  type: "case" | "tech";
  label: string;
}

export interface ResultCard {
  kind: "case" | "tech" | "idea";
  id: string;
  url: string;
  title?: string;
  meta?: string;
  chip?: CaseChip;
  angle?: string;
  seed?: string;
  refs?: IdeaRefChip[];
}

export type JobStatus = "running" | "done" | "error";

export interface Job {
  id: string;
  tab: Tab;
  request: Record<string, unknown>;
  status: JobStatus;
  /** 現在のフェーズ（日本語・短文）。running中のみ意味を持つ。 */
  progress?: string;
  /** status="error" の理由（日本語・平易な文）。 */
  error?: string;
  /** status="done" だが反映確認が時間切れ等、注意喚起したい場合の補足。 */
  warning?: string;
  resultCards: ResultCard[];
  commit: string | null;
  deployedUrl: string | null;
  cost: number | null;
  /** フェーズ名→所要ミリ秒（P4 #6: 将来のeta.ts実測calibration用。UI表示には未使用）。 */
  phaseDurationsMs?: Record<string, number>;
  at: string;
}

/** POST /api/jobs のリクエストが不正なときに投げる（index.ts側で400に変換する）。 */
export class ValidationError extends Error {}

async function ensureJobsDir(): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
}

/**
 * 件数入力（フォーム値。文字列/数値どちらの可能性もある）を [min, max] に
 * クランプする。数値化できなければ fallback を返す。
 */
export function clampCount(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function writeJobFile(job: Job): Promise<void> {
  await ensureJobsDir();
  await writeFile(
    path.join(JOBS_DIR, `${job.id}.json`),
    JSON.stringify(job, null, 2),
    "utf-8",
  );
}

// ── SSE進捗のpub/sub（P4 #2） ────────────────────────────────────────
// GET /api/jobs/:id/stream（index.ts）は updateJob() による書き込みをイベントとして
// 購読する。ファイル監視(fs.watch)ではなく、書き込みを行う唯一の入口であるupdateJob()
// 自身がemitする方式にすることで、取りこぼし・重複発火の心配が無いシンプルな実装にする
// （同一プロセス内のジョブ実行とHTTPサーバが同じNodeプロセスで動くため成立する設計。
// jobs.ts::createJob参照）。リスナー数はジョブ同時参照数に依存し得るため上限を外す。
const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(0);

function jobEventName(id: string): string {
  return `job:${id}`;
}

/**
 * 指定ジョブが updateJob() で更新されるたびに listener を呼ぶ。戻り値の関数を呼ぶと購読解除する。
 */
export function subscribeJob(id: string, listener: (job: Job) => void): () => void {
  const eventName = jobEventName(id);
  jobEvents.on(eventName, listener);
  return () => jobEvents.off(eventName, listener);
}

/**
 * 実行中ジョブの一部フィールドを更新する（パイプラインがフェーズ毎に呼ぶ）。
 * ジョブが見つからない場合は何もしない（既に削除された等の異常系を静かに無視）。
 */
export async function updateJob(
  id: string,
  patch: Partial<Job>,
): Promise<Job | null> {
  const current = await getJob(id);
  if (!current) return null;
  const updated: Job = { ...current, ...patch };
  await writeJobFile(updated);
  jobEvents.emit(jobEventName(id), updated);
  return updated;
}

export async function createJob(
  tab: Tab,
  request: Record<string, unknown>,
): Promise<Job> {
  await ensureJobsDir();

  if (tab === "research") {
    const validated = validateResearchRequest(request);
    if (!validated.ok) {
      throw new ValidationError(validated.error);
    }
    const job: Job = {
      id: randomUUID(),
      tab,
      request,
      status: "running",
      // ETAが誤らないよう種別ごとに文言を変える（eta.ts参照。「収集」始まりはCase Study、
      // 「技術収集」始まりはTechnologyのフェーズ目安に対応づく）。
      progress: validated.value.kind === "Technology" ? "技術収集を開始しています…" : "収集を開始しています…",
      resultCards: [],
      commit: null,
      deployedUrl: null,
      cost: null,
      at: new Date().toISOString(),
    };
    await writeJobFile(job);
    // バックグラウンド実行（POSTのレスポンスは待たない）。パイプライン内部で
    // 例外を捕捉してstatus="error"を書くのが基本だが、想定外の同期例外にも
    // 備えて二重に捕捉する。種別ごとにパイプラインを分岐する（DESIGN.md §10 P2:
    // Technology/両方を追加。両方はcombinedResearch.tsがCase→Techを直列実行する）。
    const pipeline =
      validated.value.kind === "Case Study"
        ? runCaseResearchPipeline
        : validated.value.kind === "Technology"
          ? runTechResearchPipeline
          : runCombinedResearchPipeline;
    void pipeline(job.id, validated.value).catch(async (err) => {
      console.error("[studio] research pipeline failed unexpectedly", err);
      await updateJob(job.id, {
        status: "error",
        progress: undefined,
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    });
    return job;
  }

  // idea: テーマ駆動アイディエーション実パイプライン（DESIGN.md §10 P3）
  const validatedIdea = validateIdeaRequest(request);
  if (!validatedIdea.ok) {
    throw new ValidationError(validatedIdea.error);
  }
  const job: Job = {
    id: randomUUID(),
    tab,
    request,
    status: "running",
    progress: "切り口を選定しています…",
    resultCards: [],
    commit: null,
    deployedUrl: null,
    cost: null,
    at: new Date().toISOString(),
  };
  await writeJobFile(job);
  void runIdeaResearchPipeline(job.id, validatedIdea.value).catch(async (err) => {
    console.error("[studio] idea research pipeline failed unexpectedly", err);
    await updateJob(job.id, {
      status: "error",
      progress: undefined,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  });
  return job;
}

export async function listJobs(): Promise<Job[]> {
  await ensureJobsDir();
  const files = (await readdir(JOBS_DIR)).filter((f) => f.endsWith(".json"));
  const jobs = await Promise.all(
    files.map(async (f) => {
      try {
        return JSON.parse(
          await readFile(path.join(JOBS_DIR, f), "utf-8"),
        ) as Job;
      } catch (err) {
        // 壊れたJSONが1件あっても一覧取得全体を失敗させない。該当ファイル
        // はスキップして残りを返す。
        console.warn(`[studio] skipping unreadable job file: ${f}`, err);
        return null;
      }
    }),
  );
  return jobs
    .filter((j): j is Job => j !== null)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function getJob(id: string): Promise<Job | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    const raw = await readFile(path.join(JOBS_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as Job;
  } catch {
    return null;
  }
}
