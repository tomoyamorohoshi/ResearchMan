/**
 * Research(両方) 実パイプライン（DESIGN.md §6・§10 P2）。
 *
 * Case Study パイプライン → Technology パイプラインを1ジョブ内で直列実行する
 * （進捗も直列表示。DESIGN.md: 「commitは各パイプラインの流儀のまま2つで良い」）。
 * それぞれ runCaseResearchPipeline / runTechResearchPipeline が lock取得・ロールバック・
 * commit/push・notify-line を独立に完結させる（このファイルはそれらを呼び出し、
 * 完了後に2フェーズの結果を1つのJobへマージするだけ）。
 *
 * 重要: 各フェーズの実行関数はジョブを自身の最終状態（done/error）で確定させるため、
 * Techフェーズ開始前に status を running へ戻す（でなければ結果ポーリング中のUIが
 * Caseフェーズ完了時点で誤って結果画面へ遷移してしまう）。
 */
import { getJob, updateJob, type Job, type JobStatus, type ResultCard } from "../jobs.js";
import { runCaseResearchPipeline } from "./caseResearch.js";
import { runTechResearchPipeline } from "./techResearch.js";
import type { ValidatedResearchRequest } from "./pure.js";

export interface PhaseResult {
  label: "Case" | "Tech";
  status: JobStatus;
  resultCards: ResultCard[];
  commit: string | null;
  cost: number | null;
  warning?: string;
  error?: string;
}

export interface MergedResult {
  status: "done" | "error";
  resultCards: ResultCard[];
  commit: string | null;
  cost: number;
  warning?: string;
  error?: string;
}

function phaseFromJob(label: "Case" | "Tech", job: Job | null): PhaseResult {
  if (!job) {
    return { label, status: "error", resultCards: [], commit: null, cost: 0, error: "ジョブ状態を読み込めませんでした" };
  }
  return {
    label,
    status: job.status === "error" ? "error" : "done",
    resultCards: job.resultCards,
    commit: job.commit,
    cost: job.cost,
    warning: job.warning,
    error: job.error,
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
  };
}

export async function runCombinedResearchPipeline(jobId: string, req: ValidatedResearchRequest): Promise<void> {
  await runCaseResearchPipeline(jobId, req);
  const casePhase = phaseFromJob("Case", await getJob(jobId));

  // Techフェーズ開始前にジョブを running へ戻す（Caseフェーズが done/error で確定させて
  // いるため、そのままだとポーリング中のUIが結果画面へ遷移してしまう）。
  await updateJob(jobId, {
    status: "running",
    progress: "技術収集を開始しています…",
    error: undefined,
    warning: undefined,
  });

  await runTechResearchPipeline(jobId, req);
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
    deployedUrl: casePhase.status === "done" || techPhase.status === "done" ? "https://research-man.vercel.app" : null,
  });
}
