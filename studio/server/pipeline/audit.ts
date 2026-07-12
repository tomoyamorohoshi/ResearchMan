/**
 * 監査・git操作・デプロイ確認・LINE通知の実行ラッパー（子プロセス呼び出し）。
 * 既存スクリプト（scripts/audit-*.mjs / verify-deploy.mjs / notify-line.mjs）は無改変で
 * そのまま呼ぶ（CLAUDE.md安全制約: デイリースクリプトの挙動を変えない）。
 *
 * 子プロセス・git・ネットワークを伴うため自動テスト対象外
 * （既存の各 .mjs スクリプト自体も無テストという repo の慣習に合わせる）。
 * ただし run() 自体の非ブロッキング性（P4 #1）は audit.test.ts で検証する。
 */
import { spawn } from "node:child_process";
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
// "development" に設定する副作用があり、子プロセスは既定で process.env をそのまま
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

// spawnSyncのmaxBuffer(20MB)相当。子プロセス出力が異常に肥大化した場合の
// メモリ保護（監査ログがこの上限に達することは通常無い想定）。
const MAX_BUFFER = 1024 * 1024 * 20;

// 2026-07-10 P4 #1: 従来は spawnSync を使っており、監査/ビルド/verify-deploy等の
// 子プロセス実行中（数十秒〜数分）Node イベントループ全体が完全にブロックされていた。
// このサーバは Express + Vite(middlewareMode) の常駐プロセス内で動くため、ブロック中は
// ジョブ状況ポーリングAPI（GET /api/jobs/:id）への応答も止まり、UIが偽の通信エラーを
// 出す不具合の根本原因になっていた（ResearchPanel.tsx/IdeaPanel.tsx 参照）。
// spawn()（非同期）+ Promise化に置き換え、イベントループを塞がないようにする。
// timeoutMs超過時はNodeのspawn timeoutオプションが自動killしてくれる（v15.14+）ため、
// 従来のspawnSync timeout契約（ok:false・code:null相当）と同じ挙動になる。
// maxBufferBytes: 省略時は既定20MB（MAX_BUFFER）。テストで小さい値を注入し、実際に
// 20MB書かせずに超過挙動を検証できるようにする（独立レビュー指摘#7）。
export function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxBufferBytes: number = MAX_BUFFER,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let bufferExceeded = false;
    const settle = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Windows対策: npm/npxは実体が.cmd（バッチファイル）のため、shell:false（既定）の
    // spawnではOSがexecutable扱いできずENOENT/EINVALになる（node/gitは.exeなので問題ない。
    // scripts/lib/claude-cli.mjsのclaude.cmd問題と同型）。npm/npxに限り shell:true にする。
    // 安全性: shell:true時はNodeがargsを素朴に連結してシェルに渡すため、スペースや
    // ユーザー入力を含む引数だと壊れる/インジェクションの危険があるが、npm/npx呼び出しの
    // argsは本ファイル内で固定された識別子（"tsc","--noEmit"等）のみで可変・ユーザー入力を
    // 含まないため安全。git（コミットメッセージ等の可変・日本語引数を扱う）には適用しない。
    const useShell = process.platform === "win32" && (cmd === "npm" || cmd === "npx");

    let child;
    try {
      child = spawn(cmd, args, { cwd, env: sanitizedEnv(), timeout: timeoutMs, shell: useShell });
    } catch (err) {
      settle({ ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err), code: null });
      return;
    }

    // 独立レビュー指摘#7: 旧spawnSyncはmaxBuffer超過時に子プロセスをkillしてENOBUFSエラー
    // にし、ok:falseを返していた。超過分を黙って切り捨てて成功扱いにすると、監査ログが
    // 実は途中で切れているのに「問題なし」と誤判定されるリスクがある。子プロセスをkillし、
    // 従来と同じ ok:false 契約にする。
    const killForBufferOverflow = (): void => {
      if (bufferExceeded) return;
      bufferExceeded = true;
      child.kill();
    };

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      if (bufferExceeded) return;
      if (stdout.length + chunk.length > maxBufferBytes) {
        stdout += chunk.slice(0, Math.max(0, maxBufferBytes - stdout.length));
        killForBufferOverflow();
        return;
      }
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (bufferExceeded) return;
      if (stderr.length + chunk.length > maxBufferBytes) {
        stderr += chunk.slice(0, Math.max(0, maxBufferBytes - stderr.length));
        killForBufferOverflow();
        return;
      }
      stderr += chunk;
    });
    child.on("error", (err) => {
      settle({ ok: false, stdout, stderr: stderr || err.message, code: null });
    });
    child.on("close", (code) => {
      if (bufferExceeded) {
        settle({
          ok: false,
          stdout,
          stderr: `${stderr}\n[studio] maxBuffer(${maxBufferBytes}バイト)を超過したため子プロセスをkillしました`,
          code,
        });
        return;
      }
      settle({ ok: code === 0, stdout, stderr, code });
    });
  });
}

// ── 品質監査（DESIGN.md §5・§7: テーマ系はaudit-thumbnails/audit-integrity + tsc/lint/build。
//    audit-cannesは対象外） ──────────────────────────────────────
export const runAuditThumbnails = (cwd: string): Promise<CommandResult> =>
  run("node", ["scripts/audit-thumbnails.mjs"], cwd, 60_000);

export const runAuditIntegrity = (cwd: string): Promise<CommandResult> =>
  run("node", ["scripts/audit-integrity.mjs"], cwd, 5 * 60_000);

// Technology用（DESIGN.md §5: テーマ系はTechの場合 audit-tech + tsc/lint/build）
export const runAuditTech = (cwd: string): Promise<CommandResult> => run("node", ["scripts/audit-tech.mjs"], cwd, 60_000);

export const runTypeCheck = (cwd: string): Promise<CommandResult> => run("npx", ["tsc", "--noEmit"], cwd, 3 * 60_000);

export const runLint = (cwd: string): Promise<CommandResult> => run("npm", ["run", "lint"], cwd, 3 * 60_000);

export const runBuild = (cwd: string): Promise<CommandResult> => run("npm", ["run", "build"], cwd, 10 * 60_000);

// ── git ──────────────────────────────────────────────────────────
export const gitAdd = (cwd: string, paths: string[]): Promise<CommandResult> =>
  run("git", ["add", "--", ...paths], cwd, 30_000);

export const gitCommit = (cwd: string, message: string): Promise<CommandResult> =>
  run("git", ["commit", "-m", message], cwd, 30_000);

export const gitPush = (cwd: string): Promise<CommandResult> => run("git", ["push"], cwd, 120_000);

// adversarial-reviewer指摘#1: `git restore -- <paths>` は既定でINDEXをソースにするため、
// 既に `git add` 済み（staged）の内容に対しては実質no-op（addされた新内容がindex/working
// tree双方に残ってしまう）。add前でもadd後でも確実にHEADへ戻すため、ソースを明示的に
// HEADにし、staged/working tree両方を対象にする。
export const gitRestorePaths = (cwd: string, paths: string[]): Promise<CommandResult> =>
  paths.length
    ? run("git", ["restore", "--staged", "--worktree", "--source=HEAD", "--", ...paths], cwd, 30_000)
    : Promise.resolve({ ok: true, stdout: "", stderr: "", code: 0 });

export async function gitRevParseHead(cwd: string): Promise<string | null> {
  const r = await run("git", ["rev-parse", "HEAD"], cwd, 10_000);
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
  await gitRestorePaths(cwd, trackedPaths);
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
// os.tmpdir()/researchman-last-add.json＝Case Study用サマリーを読んで新規ページを検証するため、
// ideaの反映確認でそれを読むと誤検証になる。Technology日次パイプラインと同じ回避策）。
export const runVerifyDeploy = (cwd: string, thumbPaths: string[], extraArgs: string[] = []): Promise<CommandResult> =>
  run("node", ["scripts/verify-deploy.mjs", ...extraArgs, ...thumbPaths], cwd, 7 * 60_000);

export const runNotifyLine = (cwd: string, args: string[]): Promise<CommandResult> =>
  run("node", ["scripts/notify-line.mjs", ...args], cwd, 30_000);

// Technology日次パイプラインと同じ「/technology/<id> が実際に200を返すか」の確認
// （verify-deploy.mjsは--skip-pages指定時にページ検証をしないため別途必要。
// scripts/verify-tech-pages.mjs は os.tmpdir()/researchman-tech-last-add.json を読むので、
// 呼び出し側がその要約ファイルを事前に書いておくこと）。
export const runVerifyTechPages = (cwd: string): Promise<CommandResult> =>
  run("node", ["scripts/verify-tech-pages.mjs"], cwd, 7 * 60_000);

// 独立レビュー指摘#1: scripts/lib/run-idea-layouts-precompute.mjs
// （generate-idea-seeds.mjs/backfill-idea-seeds.mjs共用のデイリーヘルパー・無改変）は内部で
// spawnSync を使っており、studioからそのままimportして呼ぶとイベントループを実測約7.5分
// ブロックしていた（P4の非ブロッキング化が骨抜きになる）。デイリー側ヘルパーは変更せず、
// studio側だけ同じコマンド（npx tsx scripts/precompute-idea-layouts.mjs）を
// run()（非同期spawn）経由で起動する形に置き換える。
export const runIdeaLayoutsPrecompute = (cwd: string): Promise<CommandResult> =>
  run("npx", ["tsx", "scripts/precompute-idea-layouts.mjs"], cwd, 10 * 60_000);
