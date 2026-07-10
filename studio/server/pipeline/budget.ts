/**
 * ジョブ単位のコスト予算上限（DESIGN.md §8「コスト: ジョブ単位の予算上限（超過で停止・
 * LINE通知）」／§10 P4）。
 *
 * 各パイプラインは costUsd を加算するたびに assertWithinBudget を呼ぶ。超過時は
 * BudgetExceededError を投げ、パイプラインのcatchブロックが「commit前ならロールバック・
 * committed後は停止のみ、いずれもstatus:error＋LINEエラー通知」で安全に停止させる
 * （タスク指示: 予算超過はcommit後でも常にエラー扱いにする。通常のcommit後例外を
 * done+warningにする既存分岐とは意図的に別枠）。
 *
 * 上限発火はここ（budget.test.ts）でのみユニットテストする。既定値$5は通常のジョブ
 * コストより十分大きいため、実ジョブで誤発火することはない。
 */
export const DEFAULT_JOB_BUDGET_USD = 5;

/**
 * STUDIO_JOB_BUDGET_USD 環境変数からジョブ予算上限（USD）を解決する。
 * 未設定・数値化不能・0以下（誤設定とみなす）は既定値にフォールバックする。
 */
export function resolveJobBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STUDIO_JOB_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_JOB_BUDGET_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_JOB_BUDGET_USD;
}

export class BudgetExceededError extends Error {
  readonly costUsd: number;
  readonly budgetUsd: number;

  constructor(costUsd: number, budgetUsd: number) {
    super(
      `ジョブのコストが予算上限を超過しました（$${costUsd.toFixed(2)} > $${budgetUsd.toFixed(2)}）。安全のため処理を停止しました。`,
    );
    this.name = "BudgetExceededError";
    this.costUsd = costUsd;
    this.budgetUsd = budgetUsd;
  }
}

/** costUsd が budgetUsd を超えていれば BudgetExceededError を投げる（超過していなければ何もしない）。 */
export function assertWithinBudget(costUsd: number, budgetUsd: number): void {
  if (costUsd > budgetUsd) {
    throw new BudgetExceededError(costUsd, budgetUsd);
  }
}

/**
 * ジョブ横断で共有する予算トラッカー（独立レビュー指摘#2）。
 *
 * Case/Techが各自 resolveJobBudgetUsd() で独立の予算チェックを行うと、「両方」実行時は
 * 実質2倍の予算を許してしまい、かつCaseフェーズが予算超過で落ちてもTechフェーズは
 * 新品の予算で走ってしまう（DESIGN.md §8「ジョブ単位の予算上限」の趣旨に反する）。
 * combinedResearch.ts が1つのトラッカーを生成し、lock.ts::resolveLockのexternalLockと
 * 同じ注入パターンでCase/Tech両方のパイプラインへ渡すことで、ジョブ全体で予算を共有する。
 * 単独実行時（Case/Tech/idea individually）は各パイプラインが自前で生成する。
 */
export interface JobBudgetTracker {
  readonly limitUsd: number;
  spentUsd: number;
  /** costUsdをspentUsdへ加算し、直後に予算内かを検査する（超過なら例外を投げる）。 */
  add(amountUsd: number): void;
}

export function createJobBudgetTracker(limitUsd: number = resolveJobBudgetUsd()): JobBudgetTracker {
  const tracker: JobBudgetTracker = {
    limitUsd,
    spentUsd: 0,
    add(amountUsd: number) {
      tracker.spentUsd += amountUsd;
      assertWithinBudget(tracker.spentUsd, tracker.limitUsd);
    },
  };
  return tracker;
}
