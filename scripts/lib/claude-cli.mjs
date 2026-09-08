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
  // ファイル書き込み系ツールを明示的に禁止する（2026-08-18・良質な生成結果がstdoutでなく
  // ファイルに保存され article-generation-failed として誤棄却される事故の再発防止）。
  // --dangerously-skip-permissions と併用してもCLIは --disallowedTools を尊重する
  // （`claude --help` で確認済み。両オプションは独立して機能する）。
  args.push("--disallowedTools=Write,Edit,NotebookEdit");
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
 * テキストから openCh/closeCh で対応の取れた（＝括弧の深さがちょうど0に戻る）
 * トップレベルのブロック文字列をすべて抽出する。
 * 文字列リテラル（ダブルクォート、バックスラッシュエスケープ含む）内の括弧は数えない。
 * 貪欲マッチ（旧: `new RegExp("\\{[\\s\\S]*...[\\s\\S]*\\}")`）と違い、
 * 複数ブロックが混在していても・文字列値の中に括弧が含まれていても壊れない。
 * @returns {string[]} 見つかった順のブロック文字列（開始〜終了が対応済みのもののみ）
 */
export function extractBalancedBlocks(text, openCh, closeCh) {
  const blocks = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] !== openCh) {
      i++;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let j = i;
    let closedAt = -1;
    for (; j < n; j++) {
      const c = text[j];
      if (inStr) {
        if (escaped) {
          escaped = false;
        } else if (c === "\\") {
          escaped = true;
        } else if (c === '"') {
          inStr = false;
        }
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === openCh) {
        depth++;
      } else if (c === closeCh) {
        depth--;
        if (depth === 0) {
          closedAt = j;
          break;
        }
      }
    }
    if (closedAt >= 0) {
      blocks.push(text.slice(i, closedAt + 1));
      i = closedAt + 1;
    } else {
      // 対応する閉じ括弧が見つからない（出力の途中で切れている等）→ この開始位置は諦めて次へ
      i++;
    }
  }
  return blocks;
}

/**
 * CLI出力から、marker を含む・openCh/closeCh で対応の取れたブロックを候補として集め、
 * 先頭から順にJSON.parseを試みて最初に成功した値を返す。
 * ```json コードフェンスは特別扱い不要（括弧走査がフェンス文字を単なる無視対象として素通りする）。
 * @returns {{ value: any, blockCount: number, lastError: Error|null }}
 */
export function extractFirstParsableJson(output, { marker, openCh, closeCh }) {
  const blocks = extractBalancedBlocks(output, openCh, closeCh);
  const candidates = marker ? blocks.filter((b) => b.includes(marker)) : blocks;
  let lastError = null;
  for (const block of candidates) {
    try {
      return { value: JSON.parse(block), blockCount: candidates.length, lastError: null };
    } catch (e) {
      lastError = e;
    }
  }
  return { value: undefined, blockCount: candidates.length, lastError };
}

/**
 * Claude CLI を1回呼び、出力からJSONオブジェクトブロックを抽出して返す。
 * 候補ブロックが複数ある場合は marker を含む最初のパース可能なブロックを採用する
 * （1つ目のパースに失敗したら次の候補を試す。2026-08-18: 貪欲正規表現の1発マッチから変更）。
 * @param {object} opts { timeout, marker, model="sonnet", allowedTools="WebSearch" }
 * @returns 抽出したオブジェクト、または見つからなければ null
 */
export function runClaudeJson(claudeBin, prompt, { timeout, marker, model = "sonnet", allowedTools = "WebSearch" }) {
  const output = runClaude(claudeBin, prompt, { timeout, model, allowedTools });
  const { value, blockCount, lastError } = extractFirstParsableJson(output, { marker, openCh: "{", closeCh: "}" });
  if (value !== undefined) return value;
  if (blockCount === 0) {
    console.error(`JSONブロックが見つかりません（marker=${marker}）。出力先頭400字:\n${output.slice(0, 400)}`);
  } else {
    console.error(
      `候補ブロックを${blockCount}件試したが全てパース失敗（marker=${marker}）: ${lastError?.message}。出力先頭400字:\n${output.slice(0, 400)}`
    );
  }
  return null;
}

/**
 * Claude CLI を1回呼び、出力からJSON配列ブロックを抽出して返す。
 * 候補ブロックが複数ある場合は marker を含む最初のパース可能なブロックを採用する。
 * @param {object} opts { timeout, marker="techName", model="sonnet", allowedTools="WebSearch,WebFetch" }
 * @returns 抽出した配列、または見つからなければ []
 */
export function runClaudeJsonArray(claudeBin, prompt, { timeout, marker = "techName", model = "sonnet", allowedTools = "WebSearch,WebFetch" }) {
  const output = runClaude(claudeBin, prompt, { timeout, model, allowedTools });
  const { value, blockCount, lastError } = extractFirstParsableJson(output, { marker, openCh: "[", closeCh: "]" });
  if (value !== undefined) return value;
  if (blockCount === 0) {
    console.error(`候補JSON配列ブロックが見つかりません（marker=${marker}）。出力先頭400字:\n${output.slice(0, 400)}`);
  } else {
    console.error(
      `候補ブロックを${blockCount}件試したが全てパース失敗（marker=${marker}）: ${lastError?.message}。出力先頭400字:\n${output.slice(0, 400)}`
    );
  }
  return [];
}
