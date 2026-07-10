/**
 * Research(両方) 実パイプライン（DESIGN.md §6・§10 P2）。
 *
 * lockを1回だけ取得し、Case Study パイプライン → Technology パイプラインへ同じlockを
 * 渡して1ジョブ内で直列実行する（進捗も直列表示。DESIGN.md: 「commitは各パイプラインの
 * 流儀のまま2つで良い」）。lockを一度解放してから再取得する設計だとCase→Tech間に
 * デイリージョブがlockを奪える競合窓ができてしまうため、combinedResearch.ts が
 * 単一のlockを保持したまま両フェーズへ externalLock として渡す
 * （adversarial-reviewer指摘#2。lock.ts::resolveLock参照）。
 * commit/push・notify-line・監査・ロールバックは各パイプラインが独立に完結させる。
 * このファイルは lock 管理・フェーズ間のジョブリセット・完了後の2フェーズ結果マージを担う。
 *
 * 重要: 各フェーズの実行関数はジョブを自身の最終状態（done/error）で確定させるため、
 * Techフェーズ開始前に status を running へ戻すだけでなく、resultCards/commit/cost/
 * deployedUrl も明示的にクリアする（TECH_PHASE_RESET_PATCH）。でなければTech側の失敗パスが
 * これらのフィールドを上書きしなかった場合にCase側の値をそのまま引き継いでしまい、
 * カード二重化・コスト誤算・commit誤表記の原因になる（adversarial-reviewer指摘#1）。
 */
import { getJob, updateJob, type Job, type JobStatus, type ResultCard } from "../jobs.js";
import { runCaseResearchPipeline } from "./caseResearch.js";
import { runTechResearchPipeline } from "./techResearch.js";
import { tryAcquireLock } from "./lock.js";
import type { ValidatedResearchRequest } from "./pure.js";

export interface PhaseResult {
  label: "Case" | "Tech";
  status: JobStatus;
  resultCards: ResultCard[];
  commit: string | null;
  cost: number | null;
  warning?: string;
  error?: string;
  phaseDurationsMs?: Record<string, number>;
}

export interface MergedResult {
  status: "done" | "error";
  resultCards: ResultCard[];
  commit: string | null;
  cost: number;
  warning?: string;
  error?: string;
  phaseDurationsMs: Record<string, number>;
}

/** Techフェーズ開始前にジョブへ適用するリセットパッチ（単体テスト対象・実運用コード共用）。
 * status/progressをrunningへ戻すだけでなく、resultCards/commit/cost/deployedUrlも
 * 明示的にクリアする（adversarial-reviewer指摘#1: クリアしないとCase側の値をTechフェーズが
 * 引き継いでしまう）。 */
export const TECH_PHASE_RESET_PATCH: Partial<Job> = {
  status: "running",
  progress: "技術収集を開始しています…",
  error: undefined,
  warning: undefined,
  resultCards: [],
  commit: null,
  cost: null,
  deployedUrl: null,
};

export function phaseFromJob(label: "Case" | "Tech", job: Job | null): PhaseResult {
  if (!job) {
    return { label, status: "error", resultCards: [], commit: null, cost: 0, error: "ジョブ状態を読み込めませんでした" };
  }
  // P4 adversarial-review指摘#1: SSE導入により、各パイプラインが自身の終端で書く
  // status:"done"/"error" は、combined実行中はownsLock=falseのぶんstatus:"running"に
  // 据え置くよう変更した（caseResearch.ts/techResearch.ts参照。理由: SSEはjob.statusの
  // 変化を同期的に配送するため、Caseフェーズ完了時点のstatus:"done"を購読側が
  // 「ジョブ全体の終了」と誤認し、Techフェーズの結果が届く前にストリームを閉じてしまう
  // 回帰があった）。そのため、フェーズの成否は status ではなく error フィールドの有無で
  // 判定する（全終端パスで「失敗時のみerrorを設定・成功時はerrorを設定しない」不変を維持）。
  return {
    label,
    status: job.error ? "error" : "done",
    resultCards: job.resultCards,
    commit: job.commit,
    cost: job.cost,
    warning: job.warning,
    error: job.error,
    phaseDurationsMs: job.phaseDurationsMs,
  };
}

/**
 * Case/Techそれぞれのフェーズ結果を1つのJobパッチへ統合する（純粋関数・単体テスト対象）。
 * 方針（タスク指示）: 「途中失敗時はCaseは反映済み・Techは失敗を正確に伝える」。
 * どちらか一方でもcommit済み（status="done"）であれば全体は成功（=UIにエラー画面を出さず、
 * 反映済みの結果を見せる）。両方失敗したときのみ全体をerrorにする。
 */
export function mergeCombinedPhases(casePhase: PhaseResult, techPhase: PhaseResult): MergedResult {
  const resultCards = [...casePhase.resultCards, ...techPhase.resultCards];
  const cost = (casePhase.cost ?? 0) + (techPhase.cost ?? 0);

  // P4 #6: フェーズ計測(progressTiming.ts)はjobId単位でCase→Techが直列に上書きし合うため
  // （Tech開始時にCaseの計測状態は破棄される。progressTiming.ts::finishJob参照）、最終的な
  // job JSONへは両フェーズ分をラベル付きキーで合成して保存する（データ欠落防止）。
  const phaseDurationsMs: Record<string, number> = {};
  for (const [k, v] of Object.entries(casePhase.phaseDurationsMs ?? {})) phaseDurationsMs[`Case: ${k}`] = v;
  for (const [k, v] of Object.entries(techPhase.phaseDurationsMs ?? {})) phaseDurationsMs[`Tech: ${k}`] = v;

  const commitParts = [
    casePhase.commit ? `Case ${casePhase.commit}` : null,
    techPhase.commit ? `Tech ${techPhase.commit}` : null,
  ].filter((v): v is string => !!v);
  const commit = commitParts.length ? commitParts.join(" / ") : null;

  const bothFailed = casePhase.status === "error" && techPhase.status === "error";
  if (bothFailed) {
    return {
      status: "error",
      resultCards,
      commit,
      cost,
      error: `Case: ${casePhase.error ?? "不明なエラー"} / Tech: ${techPhase.error ?? "不明なエラー"}`,
      phaseDurationsMs,
    };
  }

  const warnings: string[] = [];
  for (const phase of [casePhase, techPhase]) {
    if (phase.status === "error") {
      warnings.push(`${phase.label}は失敗しました: ${phase.error ?? "不明なエラー"}`);
    } else if (phase.status === "done" && phase.commit) {
      // 成功フェーズは「反映済み」であることを明示する（相手フェーズが失敗した場合の
      // 文脈を補うため。両方成功時は冗長になるので相手が失敗したときのみ意味を持つ）。
      if (casePhase.status === "error" || techPhase.status === "error") {
        warnings.push(`${phase.label}は反映済みです`);
      }
      if (phase.warning) warnings.push(phase.warning);
    } else if (phase.warning) {
      warnings.push(phase.warning);
    }
  }

  return {
    status: "done",
    resultCards,
    commit,
    cost,
    warning: warnings.length ? warnings.join(" / ") : undefined,
    phaseDurationsMs,
  };
}

export async function runCombinedResearchPipeline(jobId: string, req: ValidatedResearchRequest): Promise<void> {
  // lockはここで1回だけ取得し、Case→Tech両方へ渡す（adversarial-reviewer指摘#2:
  // 個々のパイプラインに自前取得させると解放→再取得の間に競合窓ができるため）。
  const lock = tryAcquireLock();
  if (!lock) {
    await updateJob(jobId, {
      status: "error",
      progress: undefined,
      error: "デイリージョブ実行中です。しばらく後に再実行してください。",
    });
    return;
  }

  try {
    await runCaseResearchPipeline(jobId, req, lock);
    const casePhase = phaseFromJob("Case", await getJob(jobId));

    // Techフェーズ開始前にジョブを running へ戻し、Case側の結果フィールドも明示的に
    // クリアする（TECH_PHASE_RESET_PATCH。adversarial-reviewer指摘#1）。
    await updateJob(jobId, TECH_PHASE_RESET_PATCH);

    await runTechResearchPipeline(jobId, req, lock);
    const techPhase = phaseFromJob("Tech", await getJob(jobId));

    const merged = mergeCombinedPhases(casePhase, techPhase);
    await updateJob(jobId, {
      status: merged.status,
      progress: undefined,
      resultCards: merged.resultCards,
      commit: merged.commit,
      cost: merged.cost,
      warning: merged.warning,
      error: merged.error,
      phaseDurationsMs: merged.phaseDurationsMs,
      deployedUrl: casePhase.status === "done" || techPhase.status === "done" ? "https://research-man.vercel.app" : null,
    });
  } finally {
    lock.release();
  }
}
