/**
 * server/jobs.ts の型をフロント側に転記したもの。
 *
 * studio/server と studio/web は別々の tsconfig（bundler向け実行環境が
 * 異なる）のTSプロジェクトなので、P0では型を共有せず重複定義している。
 * 共有パッケージ化のコストに見合う規模になったら見直す。
 */
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
  /** status="error" の理由がコスト予算超過だった場合にtrue。 */
  budgetExceeded?: boolean;
  resultCards: ResultCard[];
  commit: string | null;
  deployedUrl: string | null;
  cost: number | null;
  /** フェーズ名→所要ミリ秒（P4 #6: 将来のeta.ts実測calibration用。UI表示には未使用）。 */
  phaseDurationsMs?: Record<string, number>;
  at: string;
}
