/**
 * 監査・git操作・デプロイ確認・LINE通知の実行ラッパー（子プロセス呼び出し）。
 * 既存スクリプト（scripts/audit-*.mjs / verify-deploy.mjs / notify-line.mjs）は無改変で
 * そのまま呼ぶ（CLAUDE.md安全制約: デイリースクリプトの挙動を変えない）。
 *
 * 子プロセス・git・ネットワークを伴うため自動テスト対象外
 * （既存の各 .mjs スクリプト自体も無テストという repo の慣習に合わせる）。
 */
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

// 2026-07-10 root-cause: このパイプラインは Vite dev server(middlewareMode) を抱えた
// 常駐プロセス内で動く。Vite の createServer() は起動時に process.env.NODE_ENV を
// "development" に設定する副作用があり、spawnSync は既定で process.env をそのまま
// 継承するため、`next build` の子プロセスにも NODE_ENV=development が渡っていた。
// Next.js は明示済みの NODE_ENV を尊重して上書きしない実装のため、production
// ビルドのはずが development 相当の扱いになり、SSG中に
// 「Next.js build worker exited with code: 1」で確定的にクラッシュしていた
// （シェルから直接 `npm run build` した場合はNODE_ENV未設定のため再現しない）。
// 対策: 監査・ビルド系の子プロセスには NODE_ENV を継承させず、各コマンド自身の
// 既定値（next buildならproduction）に委ねる。
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_ENV;
  return env;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): CommandResult {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 20,
    env: sanitizedEnv(),
  });
  return { ok: r.status === 0 && !r.error, stdout: r.stdout || "", stderr: r.stderr || "", code: r.status };
}

// ── 品質監査（DESIGN.md §5・§7: テーマ系はaudit-thumbnails/audit-integrity + tsc/lint/build。
//    audit-cannesは対象外） ──────────────────────────────────────
export const runAuditThumbnails = (cwd: string): CommandResult =>
  run("node", ["scripts/audit-thumbnails.mjs"], cwd, 60_000);

export const runAuditIntegrity = (cwd: string): CommandResult =>
  run("node", ["scripts/audit-integrity.mjs"], cwd, 5 * 60_000);

export const runTypeCheck = (cwd: string): CommandResult => run("npx", ["tsc", "--noEmit"], cwd, 3 * 60_000);

export const runLint = (cwd: string): CommandResult => run("npm", ["run", "lint"], cwd, 3 * 60_000);

export const runBuild = (cwd: string): CommandResult => run("npm", ["run", "build"], cwd, 10 * 60_000);

// ── git ──────────────────────────────────────────────────────────
export const gitAdd = (cwd: string, paths: string[]): CommandResult => run("git", ["add", "--", ...paths], cwd, 30_000);

export const gitCommit = (cwd: string, message: string): CommandResult =>
  run("git", ["commit", "-m", message], cwd, 30_000);

export const gitPush = (cwd: string): CommandResult => run("git", ["push"], cwd, 120_000);

// adversarial-reviewer指摘#1: `git restore -- <paths>` は既定でINDEXをソースにするため、
// 既に `git add` 済み（staged）の内容に対しては実質no-op（addされた新内容がindex/working
// tree双方に残ってしまう）。add前でもadd後でも確実にHEADへ戻すため、ソースを明示的に
// HEADにし、staged/working tree両方を対象にする。
export const gitRestorePaths = (cwd: string, paths: string[]): CommandResult =>
  paths.length
    ? run("git", ["restore", "--staged", "--worktree", "--source=HEAD", "--", ...paths], cwd, 30_000)
    : { ok: true, stdout: "", stderr: "", code: 0 };

export function gitRevParseHead(cwd: string): string | null {
  const r = run("git", ["rev-parse", "HEAD"], cwd, 10_000);
  return r.ok ? r.stdout.trim() : null;
}

/**
 * commit前に失敗した場合の後始末。既存追跡ファイル（cases.json等）は git restore で
 * 直前の状態に戻し、今回新規生成したファイル（サムネイル等）は削除する。
 * DESIGN.md §5: 「失敗時は commit 前に停止・作業ツリーを戻し」。
 */
export async function rollbackTouchedFiles(
  cwd: string,
  trackedPaths: string[],
  newUntrackedPaths: string[],
): Promise<void> {
  gitRestorePaths(cwd, trackedPaths);
  await Promise.all(
    newUntrackedPaths.map(async (p) => {
      try {
        await rm(path.join(cwd, p), { force: true });
      } catch {
        // 削除失敗は握りつぶす（ロールバックの主目的=commitしないことは既に達成済み）
      }
    }),
  );
}

// ── デプロイ確認・通知（既存スクリプトをそのまま呼ぶ） ─────────────
// extraArgs: idea パイプラインは --skip-pages を渡す（verify-deploy.mjsの既定は
// /tmp/researchman-last-add.json＝Case Study用サマリーを読んで新規ページを検証するため、
// ideaの反映確認でそれを読むと誤検証になる。Technology日次パイプラインと同じ回避策）。
export const runVerifyDeploy = (cwd: string, thumbPaths: string[], extraArgs: string[] = []): CommandResult =>
  run("node", ["scripts/verify-deploy.mjs", ...extraArgs, ...thumbPaths], cwd, 7 * 60_000);

export const runNotifyLine = (cwd: string, args: string[]): CommandResult =>
  run("node", ["scripts/notify-line.mjs", ...args], cwd, 30_000);
