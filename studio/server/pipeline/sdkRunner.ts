/**
 * Claude Agent SDK の query() を1回呼び、指定したサブエージェント定義をメインスレッド
 * エージェントとして実行して最終テキストを返す薄いラッパー。
 *
 * - 認証: ローカルのClaude Codeログインをそのまま使う（ANTHROPIC_API_KEYはコードに置かない。
 *   SDKはデフォルトでCLIの保存済み認証を使う）。
 * - settingSources: [] にしてCLAUDE.md/プロジェクト設定を読み込ませない（サブエージェントの
 *   人格プロンプトはagents optionで明示的に渡すため、無関係な設定の混入を避ける）。
 * - permissionMode: "bypassPermissions" — デイリーパイプライン（Claude CLIの
 *   --dangerously-skip-permissions）と同じ、ヘッドレス自動実行の作法。
 * - エージェント定義自体は agentLoader.ts が .claude/agents/*.md から読み込んだものを渡す
 *   （定義の二重管理を避ける）。
 *
 * ネットワーク・実際のAgent呼び出しを伴うため自動テスト対象外
 * （既存のauto-research-cc.mjs等、Claude CLI呼び出し部分も同様に無テスト）。
 */
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { CANCELLED_MESSAGE, currentJobAbortController, isCancelledInContext } from "../jobCancel.js";
import type { LoadedAgentDefinition } from "./agentLoader.js";

/** テストでquery()を差し替えるための薄い間接層（本番では常にSDKのqueryを使う）。 */
export const sdkDeps = { query };

export interface AgentRunResult {
  ok: boolean;
  text: string;
  costUsd: number;
  error?: string;
}

function cancelledResult(costUsd: number): AgentRunResult {
  return { ok: false, text: "", costUsd, error: CANCELLED_MESSAGE };
}

export async function runAgentQuery(
  cwd: string,
  agentName: string,
  def: LoadedAgentDefinition,
  prompt: string,
  maxTurns = 40,
): Promise<AgentRunResult> {
  const agentDef: AgentDefinition = {
    description: def.description,
    prompt: def.prompt,
    tools: def.tools.length ? def.tools : undefined,
    model: def.model,
  };

  let text = "";
  let costUsd = 0;

  // LINE「停止」（jobCancel.ts）: キャンセル済みジョブはSDKを呼ばず即失敗（sticky）。
  if (isCancelledInContext()) return cancelledResult(costUsd);

  try {
    for await (const message of sdkDeps.query({
      prompt,
      options: {
        abortController: currentJobAbortController(),
        cwd,
        settingSources: [],
        agent: agentName,
        agents: { [agentName]: agentDef },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns,
      },
    })) {
      if (message.type === "result") {
        costUsd = message.total_cost_usd ?? 0;
        if (message.subtype === "success") {
          text = message.result;
        } else {
          if (isCancelledInContext()) return cancelledResult(costUsd);
          const detail = message.errors.join("; ");
          return { ok: false, text: "", costUsd, error: detail || message.subtype };
        }
      }
    }
  } catch (err) {
    if (isCancelledInContext()) return cancelledResult(costUsd);
    return { ok: false, text: "", costUsd, error: err instanceof Error ? err.message : String(err) };
  }
  if (isCancelledInContext()) return cancelledResult(costUsd);

  if (!text) {
    return { ok: false, text: "", costUsd, error: "エージェントから結果テキストが得られませんでした" };
  }
  return { ok: true, text, costUsd };
}

/**
 * ツールを使わせない軽量なテキスト生成呼び出し（例: オーダータグ命名）。
 * settingSources/agentsは使わず、model指定のみのプレーンなquery。
 *
 * opts.effort: LINE依頼の構造化解釈（line/structure.ts）のように「型がなく失敗コストが
 * 小さい軽い解釈タスク」向けに reasoning effort を下げたい呼び出し元向け（省略時は
 * SDKの既定effortのまま。既存呼び出し元の挙動は変えない）。
 */
export async function runPlainQuery(
  prompt: string,
  model: string = "haiku",
  opts: { effort?: "low" | "medium" | "high" | "xhigh" | "max" } = {},
): Promise<AgentRunResult> {
  let text = "";
  let costUsd = 0;
  if (isCancelledInContext()) return cancelledResult(costUsd);
  try {
    for await (const message of sdkDeps.query({
      prompt,
      options: {
        abortController: currentJobAbortController(),
        settingSources: [],
        tools: [],
        model,
        effort: opts.effort,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 2,
      },
    })) {
      if (message.type === "result") {
        costUsd = message.total_cost_usd ?? 0;
        if (message.subtype === "success") {
          text = message.result;
        } else {
          if (isCancelledInContext()) return cancelledResult(costUsd);
          const detail = message.errors.join("; ");
          return { ok: false, text: "", costUsd, error: detail || message.subtype };
        }
      }
    }
  } catch (err) {
    if (isCancelledInContext()) return cancelledResult(costUsd);
    return { ok: false, text: "", costUsd, error: err instanceof Error ? err.message : String(err) };
  }
  if (isCancelledInContext()) return cancelledResult(costUsd);
  return { ok: !!text, text, costUsd, error: text ? undefined : "結果テキストが得られませんでした" };
}
