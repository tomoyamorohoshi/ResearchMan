/**
 * Claude CLI 呼び出しの共通ヘルパー（auto-research-cc / auto-research-tech /
 * generate-idea-seeds / factcheck-tech が共用）。
 *
 * 従来は各スクリプトに resolveClaudeBin / runClaudeJson がコピーされていたため、
 * 挙動を変えずに1箇所へ集約した。model・allowedTools・marker は呼び出し側で指定する。
 */
import { execFileSync, spawnSync } from "child_process";
import os from "os";
import path from "path";

const CLAUDE_PATHS = ["/Users/tm/.local/bin/claude", "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
// Windows既知パス（`claude.exe`はmacOSと同じ ~/.local/bin/ 配下に入る運用）。
// macOS側のCLAUDE_PATHSとは完全に別配列にし、Mac側の解決順序・挙動は一切変えない。
const WIN_CLAUDE_PATHS = [path.join(os.homedir(), ".local", "bin", "claude.exe")];

/** claude 実行バイナリを解決する（which/where → 既知パス → "claude"） */
export function resolveClaudeBin() {
  const isWin = process.platform === "win32";
  try {
    // Windowsに`which`は無いため`where`を使う。`where`は複数ヒットを改行区切りで返す。
    // npmグローバル由来のシム claude.cmd は Node 20+ の spawnSync(shell:false) で
    // EINVAL になるため .exe のヒットだけを採用し、無ければ既知パス探索へ落とす
    // （2026-07-11 敵対的レビュー指摘#2）
    if (isWin) {
      const hits = execFileSync("where", ["claude"], { encoding: "utf-8" }).trim().split(/\r?\n/).filter(Boolean);
      const exe = hits.find((h) => h.toLowerCase().endsWith(".exe"));
      if (exe) return exe;
      throw new Error("whereに.exeヒットなし（既知パス探索へフォールバック）");
    }
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  } catch {
    for (const p of isWin ? WIN_CLAUDE_PATHS : CLAUDE_PATHS) {
      try {
        execFileSync(p, ["--version"], { encoding: "utf-8" });
        return p;
      } catch {}
    }
  }
  return "claude";
}

function runClaude(claudeBin, prompt, { timeout, model, allowedTools }) {
  const args = ["--print", "--model", model];
  if (allowedTools) args.push(`--allowedTools=${allowedTools}`);
  args.push("--dangerously-skip-permissions", prompt);
  // 従量課金防止ガード: APIキー系の環境変数をCLIに渡さない（常にサブスクのログイン認証で動かす。
  // ユーザー方針 2026-07-13。studio/server/index.ts / scripts/windows/run-job.mjs にも同じガードあり）
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const result = spawnSync(claudeBin, args, {
    encoding: "utf-8",
    timeout,
    maxBuffer: 1024 * 1024 * 20,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  if (result.error) throw new Error(`Claude CLI エラー: ${result.error.message}`);
  if (result.status !== 0) {
    // CLIはエラーをstdout側に出すことがある（usage limit等）ため両方を報告する
    const detail = [result.stderr, result.stdout].filter(Boolean).join(" | ").slice(0, 400);
    throw new Error(`Claude CLI 終了コード ${result.status}: ${detail}`);
  }
  return result.stdout || "";
}

/**
 * Claude CLI を1回呼び、出力から最初のJSONオブジェクトブロックを抽出して返す。
 * @param {object} opts { timeout, marker, model="sonnet", allowedTools="WebSearch" }
 * @returns 抽出したオブジェクト、または見つからなければ null
 */
export function runClaudeJson(claudeBin, prompt, { timeout, marker, model = "sonnet", allowedTools = "WebSearch" }) {
  const output = runClaude(claudeBin, prompt, { timeout, model, allowedTools });
  const re = new RegExp(`\\{[\\s\\S]*${marker}[\\s\\S]*\\}`);
  const m = output.match(re);
  if (!m) {
    console.error(`JSONが見つかりません（marker=${marker}）。出力先頭400字:\n${output.slice(0, 400)}`);
    return null;
  }
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    console.error("JSON解析エラー:", e.message);
    return null;
  }
}

/**
 * Claude CLI を1回呼び、出力から最初のJSON配列を抽出して返す。
 * @param {object} opts { timeout, marker="techName", model="sonnet", allowedTools="WebSearch,WebFetch" }
 * @returns 抽出した配列、または見つからなければ []
 */
export function runClaudeJsonArray(claudeBin, prompt, { timeout, marker = "techName", model = "sonnet", allowedTools = "WebSearch,WebFetch" }) {
  const output = runClaude(claudeBin, prompt, { timeout, model, allowedTools });
  const re = new RegExp(`\\[[\\s\\S]*${marker}[\\s\\S]*\\]`);
  const m = output.match(re);
  if (!m) {
    console.error(`候補JSONが見つかりません。出力先頭400字:\n${output.slice(0, 400)}`);
    return [];
  }
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    console.error("JSON解析エラー:", e.message);
    return [];
  }
}
