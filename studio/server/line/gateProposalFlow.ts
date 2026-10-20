/**
 * 基準の変更案（data/case-gate.json の criteria A〜D）への LINE 返信「承認/却下/修正」の処理
 * （docs/CASE_RESEARCH_V3_SPEC.md §6）。
 *
 * 台帳・適用・失効などの純ロジックは scripts/lib/gate-proposals.mjs に置き（週次見直しと共有）、
 * ここは副作用（監査・git commit/push・Claude CLI・system-alerts）を依存性注入で束ねる薄い層。
 * webhook.ts がこの関数を呼ぶ。実 git / 実 Claude / 実 LINE はテストでは注入（モック）する。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { appendSystemAlert } from "../../../scripts/lib/system-alerts.mjs";
import { buildClaudeArgs, resolveClaudeBin } from "../../../scripts/lib/claude-cli.mjs";
import { CASE_GATE_PATH, loadCaseGate } from "../../../scripts/lib/case-gate-criteria.mjs";
import {
  GATE_PROPOSALS_PATH,
  addFeedback,
  applyProposal,
  buildProposalMessage,
  buildRevisionPrompt,
  completeRevision,
  formatGateId,
  getProposal,
  markApproved,
  parseRevisionOutput,
  rejectProposal,
  restoreGate,
} from "../../../scripts/lib/gate-proposals.mjs";
import { run } from "../pipeline/audit.js";
import { DEFAULT_LOCK_PATH, tryAcquireLock } from "../pipeline/lock.js";
import type { GateCommand } from "./classify.js";

export interface GateFlowDeps {
  /** 台帳(gate-proposals.json)のパス。テストでは一時ファイル。 */
  file: string;
  /** case-gate.json のパス。テストでは一時ファイル。 */
  gatePath: string;
  now: () => Date;
  /** 適用後の case-gate.json の監査（validateCaseGate＋関連テスト相当）。 */
  audit: () => Promise<{ ok: boolean; detail: string }>;
  /** data/case-gate.json だけを commit→push する（main 以外は中止・git ロック取得）。失敗時は git 側も元に戻す。 */
  commitPush: (message: string) => Promise<{ ok: boolean; error?: string }>;
  /** Claude CLI にプロンプトを渡して生の出力テキストを得る。 */
  generateRevision: (prompt: string) => Promise<string>;
  /** system-alerts（logs/system-alerts.jsonl）への記録。 */
  recordAlert: (title: string, body: string) => void;
}

export interface GateCommandResult {
  /** 即時返信。 */
  reply: string;
  /** 「修正」の再生成など、返信後に非同期で行う処理。戻り値は push で追送するメッセージ。 */
  background?: () => Promise<string[]>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下済み",
  expired: "期限切れ",
  superseded: "修正済み（新しい案に置き換え）",
};

interface Failure {
  ok: false;
  code: string;
  message: string;
  proposal: { id: string; status: string; supersededBy?: string } | null;
}

function failureReply(id: number, f: Failure): string {
  const gid = formatGateId(id);
  switch (f.code) {
    case "not-found":
      return `${gid} という変更案はありません。`;
    case "not-pending": {
      const status = f.proposal?.status ?? "";
      const next = f.proposal?.supersededBy ? `（新しい案: ${f.proposal.supersededBy}）` : "";
      return `${gid} は処理済みです（状態: ${STATUS_LABEL[status] ?? status}）${next}。`;
    }
    case "expired":
      return `${gid} は期限切れです。次の週次見直しで再検討されます。`;
    case "conflict":
      return `${gid} は適用できませんでした: ${f.message}`;
    default:
      return `${gid} の処理に失敗しました: ${f.message}`;
  }
}

const inflightRevisions = new Set<string>();

export async function handleGateCommand(cmd: GateCommand, deps: GateFlowDeps): Promise<GateCommandResult> {
  const opts = { file: deps.file, gatePath: deps.gatePath, now: deps.now() };
  const gid = formatGateId(cmd.id);

  if (cmd.action === "reject") {
    const r = rejectProposal(cmd.id, opts) as { ok: true } | Failure;
    return { reply: r.ok ? `${gid} を却下しました。` : failureReply(cmd.id, r) };
  }

  if (cmd.action === "approve") return { reply: await approve(cmd.id, deps, opts) };

  // revise
  if (!cmd.feedback) return { reply: `フィードバックが空です。「修正 ${gid} ＜どう直したいか＞」の形で送ってください。` };
  if (inflightRevisions.has(gid)) return { reply: `${gid} の修正案はすでに作成中です。` };
  const fb = addFeedback(cmd.id, cmd.feedback, opts) as { ok: true } | Failure;
  if (!fb.ok) return { reply: failureReply(cmd.id, fb) };
  inflightRevisions.add(gid);
  return {
    reply: `${gid} の修正案を作成中です。できたら届きます。`,
    background: async () => {
      try {
        return [await revise(cmd.id, deps, opts)];
      } finally {
        inflightRevisions.delete(gid);
      }
    },
  };
}

async function approve(id: number, deps: GateFlowDeps, opts: { file: string; gatePath: string; now: Date }): Promise<string> {
  const gid = formatGateId(id);
  const applied = applyProposal(id, opts) as { ok: true; backup: string } | Failure;
  if (!applied.ok) return failureReply(id, applied);

  const rollback = (title: string, detail: string): string => {
    restoreGate(applied.backup, opts.gatePath);
    deps.recordAlert(title, `${gid}: ${detail}`);
    return `${gid} の反映に失敗したため元に戻しました（${detail}）。案は承認待ちのままです。`;
  };

  let audit: { ok: boolean; detail: string };
  try {
    audit = await deps.audit();
  } catch (err) {
    audit = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  if (!audit.ok) return rollback("基準変更の監査に失敗", `監査失敗: ${audit.detail.slice(0, 300)}`);

  let pushed: { ok: boolean; error?: string };
  try {
    pushed = await deps.commitPush(`chore(case-gate): 基準${(getProposal(id, opts) as { criterionId: string }).criterionId}の文面を変更 (${gid} 承認)`);
  } catch (err) {
    pushed = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!pushed.ok) return rollback("基準変更の commit/push に失敗", `commit/push 失敗: ${pushed.error ?? "原因不明"}`);

  markApproved(id, opts);
  return `${gid} を反映しました（case-gate.json を commit・push 済み）。`;
}

async function revise(id: number, deps: GateFlowDeps, opts: { file: string; gatePath: string; now: Date }): Promise<string> {
  const gid = formatGateId(id);
  try {
    const p = getProposal(id, opts);
    const gate = loadCaseGate(opts.gatePath);
    const out = await deps.generateRevision(buildRevisionPrompt(p, gate));
    const parsed = parseRevisionOutput(out);
    if (!parsed) throw new Error("修正案の出力を読み取れませんでした");
    const done = completeRevision(id, parsed, opts) as { ok: true; proposal: unknown } | Failure;
    if (!done.ok) throw new Error(done.message);
    return buildProposalMessage(done.proposal);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.recordAlert("基準変更案の修正に失敗", `${gid}: ${detail}`);
    return `${gid} の修正案の作成に失敗しました（${detail}）。元の案は承認待ちのままです。もう一度「修正 ${gid} …」を送れます。`;
  }
}

// ── 本番用の依存（実 git / 実 Claude CLI を伴うため自動テスト対象外。audit.ts・structure.ts と同じ方針） ──

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", ".."); // studio/server/line -> repo root
const GATE_REL = "data/case-gate.json";
const REVISION_TIMEOUT_MS = 5 * 60_000;

async function auditCaseGate(): Promise<{ ok: boolean; detail: string }> {
  try {
    loadCaseGate(CASE_GATE_PATH); // validateCaseGate（不正なら例外）
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  const t = await run("node", ["--test", "scripts/lib/case-gate-criteria.test.mjs", "scripts/lib/case-gate-data.test.mjs"], ROOT, 120_000);
  return t.ok ? { ok: true, detail: "" } : { ok: false, detail: (t.stderr || t.stdout).slice(-400) };
}

/** main ブランチ確認→git ロック→ case-gate.json だけを add/commit/push。失敗時は git 側（commit）も元に戻す。 */
async function commitPushCaseGate(message: string): Promise<{ ok: boolean; error?: string }> {
  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], ROOT, 10_000);
  if (!branch.ok || branch.stdout.trim() !== "main") return { ok: false, error: `main ブランチではないため中止（現在: ${branch.stdout.trim() || "不明"}）` };
  const lock = tryAcquireLock(DEFAULT_LOCK_PATH, "studio:gate-proposal");
  if (!lock) return { ok: false, error: "他のジョブが git を使用中です（後でもう一度承認してください）" };
  try {
    const head = await run("git", ["rev-parse", "HEAD"], ROOT, 10_000);
    const add = await run("git", ["add", "--", GATE_REL], ROOT, 30_000);
    if (!add.ok) return { ok: false, error: `git add 失敗: ${add.stderr.slice(0, 200)}` };
    // パス指定 commit: 他にステージ済みの変更があっても case-gate.json だけを commit する
    const commit = await run("git", ["commit", "-m", message, "--", GATE_REL], ROOT, 60_000);
    if (!commit.ok) {
      await run("git", ["restore", "--staged", "--", GATE_REL], ROOT, 30_000);
      return { ok: false, error: `git commit 失敗: ${(commit.stderr || commit.stdout).slice(0, 200)}` };
    }
    const push = await run("git", ["push"], ROOT, 120_000);
    if (!push.ok) {
      // push 失敗: 作った commit を取り消し、ファイルも HEAD に戻す
      if (head.ok) await run("git", ["reset", "--soft", head.stdout.trim()], ROOT, 30_000);
      await run("git", ["restore", "--staged", "--worktree", "--source=HEAD", "--", GATE_REL], ROOT, 30_000);
      return { ok: false, error: `git push 失敗: ${(push.stderr || push.stdout).slice(0, 200)}` };
    }
    return { ok: true };
  } finally {
    lock.release();
  }
}

/** Claude CLI（サブスク認証。プロンプトは stdin 渡しで ENAMETOOLONG を避ける。claude-cli.mjs と同じ引数）を非同期実行する。 */
function runClaudeAsync(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const args: string[] = buildClaudeArgs({ model: "sonnet", allowedTools: undefined, extraDisallowedTools: "Bash" });
    const child = spawn(resolveClaudeBin(), args, { env, stdio: ["pipe", "pipe", "pipe"], timeout: REVISION_TIMEOUT_MS, cwd: tmpdir() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => reject(new Error(`Claude CLI エラー: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`Claude CLI 終了コード ${code}: ${(stderr || stdout).slice(0, 300)}`))));
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
  });
}

export function createDefaultGateFlowDeps(): GateFlowDeps {
  return {
    file: GATE_PROPOSALS_PATH,
    gatePath: CASE_GATE_PATH,
    now: () => new Date(),
    audit: auditCaseGate,
    commitPush: commitPushCaseGate,
    generateRevision: runClaudeAsync,
    recordAlert: (title, body) => {
      try {
        appendSystemAlert({ source: "studio/gate-proposal", level: "error", title, body });
      } catch (err) {
        console.error("[studio][line] system-alerts への記録に失敗しました", err);
      }
    },
  };
}
