/**
 * Claude CLI 呼び出しの共通ヘルパー（auto-research-cc / auto-research-tech /
 * generate-idea-seeds / factcheck-tech が共用）。
 *
 * 従来は各スクリプトに resolveClaudeBin / runClaudeJson がコピーされていたため、
 * 挙動を変えずに1箇所へ集約した。model・allowedTools・marker は呼び出し側で指定する。
 */
import { execFileSync, spawnSync } from "child_process";

const CLAUDE_PATHS = ["/Users/tm/.local/bin/claude", "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];

/** claude 実行バイナリを解決する（which → 既知パス → "claude"） */
export function resolveClaudeBin() {
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  } catch {
    for (const p of CLAUDE_PATHS) {
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
  const result = spawnSync(claudeBin, args, {
    encoding: "utf-8",
    timeout,
    maxBuffer: 1024 * 1024 * 20,
    stdio: ["ignore", "pipe", "pipe"],
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
