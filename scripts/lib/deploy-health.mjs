/**
 * デプロイ死活の共有ロジック（scripts/watchdog.mjs / scripts/verify-deploy.mjs が共用）。
 *
 * 2026-07-08インシデント1（/ideas改修がVercelビルド300秒×3タイムアウトで9デプロイ連続失敗・
 * 本番21時間凍結）の再発防止。`vercel ls` で最新Productionデプロイの状態を取得し、
 * Error または「Readyだがorigin/mainより古い（＝それより後のpushが全部失敗している）」を
 * 検知する。全関数は同期・例外を投げない設計（内部try/catchでnull/false相当を返す）にし、
 * fixtureで単体テストしやすくしてある（scripts/smoke-watchdog-deploy-health.mjs）。
 *
 * Vercel CLI はインストール・認証済み（/opt/homebrew/bin/vercel）。launchd からは PATH が
 * 最小なので絶対パスで呼ぶこと。CLIが使えない環境（未認証・オフライン）では
 * resolveVercelBin() が null を返し、呼び出し側はチェックをスキップする。
 */
import { execFileSync, execSync, spawnSync } from "child_process";

const VERCEL_ABS_PATH = "/opt/homebrew/bin/vercel";

// vercel CLIの実在確認。絶対パス→`which vercel`の順で探す。どちらも無ければnull
// （呼び出し側はnullならチェックをスキップし「vercel CLI利用不可→スキップ」とログに出す）。
export function resolveVercelBin() {
  try {
    execFileSync(VERCEL_ABS_PATH, ["--version"], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    return VERCEL_ABS_PATH;
  } catch {}
  try {
    const which = execSync("which vercel", { timeout: 5000, encoding: "utf-8" }).trim();
    if (which) {
      execFileSync(which, ["--version"], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
      return which;
    }
  } catch {}
  return null;
}

// `vercel ls <project>` の実出力（固定幅パディング・スペース2個以上区切り）をパースする。
// ヘッダー行（Age/Project/Deployment/Status/Environment...）を見つけ、以降の非空行を
// 列に分解する。ステータス列の先頭にある ●/○ 記号は取り除く。
// vercel CLIを一切呼ばない純粋関数（fixtureでの単体テストのため分離してある）。
export function parseVercelLsOutput(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const headerIdx = lines.findIndex((l) => /^\s*Age\s+Project\s+Deployment\s+Status\s+Environment/.test(l));
  if (headerIdx === -1) return [];
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      if (rows.length) break; // 表の終わり（空行）。表が始まる前の空行はスキップ
      continue;
    }
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 6) continue; // 列数が足りない行（折返し等）はスキップ
    const [age, project, deployment, statusRaw, environment, duration, username = ""] = cols;
    rows.push({
      age,
      project,
      url: deployment,
      status: statusRaw.replace(/^[●○]\s*/, "").trim(),
      environment,
      duration,
      username,
    });
  }
  return rows;
}

// 最新Productionデプロイを取得する。行の並びはvercel lsの出力順（Age最小=最新が先頭）を
// 前提とし、Environment==="Production"の最初の行を返す。パース失敗・CLI失敗はnull
// （例外を投げない）。
export function getLatestProductionDeployment(vercelBin, project = "research-man") {
  if (!vercelBin) return null;
  try {
    const r = spawnSync(vercelBin, ["ls", project], { timeout: 30000, encoding: "utf-8" });
    if (!r || r.error) return null;
    // 実機検証で判明: 非TTY実行（spawnSync・launchd等）ではvercel CLIは人間可読の表を
    // stdoutではなくstderrに出す（stdoutはURLのみの機械可読リストになる）。TTY環境で
    // 表がstdoutに出るケースにも両対応するため、両ストリームを結合してパースする。
    const rows = parseVercelLsOutput(`${r.stdout || ""}\n${r.stderr || ""}`);
    const prod = rows.filter((row) => row.environment === "Production");
    return prod[0] || null;
  } catch {
    return null;
  }
}

// `vercel inspect <url> --logs` の出力から `Cloning ... Commit: <hash>` 行のコミットハッシュ
// (短縮形)を抽出する純粋関数（vercel CLIを呼ばないのでfixtureで単体テスト可能）。
export function extractCommitFromInspectLogs(text) {
  if (!text) return null;
  const m = text.match(/Cloning .*Commit:\s*([0-9a-f]{7,40})/);
  return m ? m[1] : null;
}

// vercelBin経由で実際に `vercel inspect <url> --logs` を呼び、コミットハッシュを取得する。
// 取得失敗（CLI失敗・マッチなし）はnull（例外を投げない）。
export function getDeploymentCommit(vercelBin, url) {
  if (!vercelBin || !url) return null;
  try {
    const r = spawnSync(vercelBin, ["inspect", url, "--logs"], {
      timeout: 30000,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (!r || r.error) return null;
    return extractCommitFromInspectLogs(`${r.stdout || ""}\n${r.stderr || ""}`);
  } catch {
    return null;
  }
}

// ビルド失敗ログからエラー行を抽出（重複除去・最大max件）。
// `Failed to build ...` / `Error: Command "..." exited with N` / 行頭 `Error:` にマッチ。
export function extractBuildErrorLines(logsText, max = 10) {
  if (!logsText) return [];
  const patterns = [/Failed to build[^\n]*/g, /Error: Command "[^"]*" exited with \d+/g, /^Error:.*$/gm];
  const found = [];
  for (const re of patterns) {
    const matches = logsText.match(re) || [];
    for (const m of matches) found.push(m.trim());
  }
  return [...new Set(found)].slice(0, max);
}

// <commit> が origin/main の祖先か（＝それより後にpushされたコミットがある）を確認する。
// git呼び出し失敗・非祖先はfalse（例外を投げない）。
export function isAncestorOfOriginMain(commit, cwd) {
  if (!commit) return false;
  try {
    const r = spawnSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"], { cwd, timeout: 15000 });
    return !!r && r.status === 0;
  } catch {
    return false;
  }
}

// デプロイ死活の上位分類ロジック。
//   - latestDeployment が null → { status: "unknown", anomaly: false }
//   - status === "Error" → anomaly（vercelBin/git を一切呼ばずに即判定できる。
//     smoke test が実CLI呼び出しゼロで検証できる設計上のポイント）
//   - status === "Ready" だが getDeploymentCommit で取れたコミットが localOriginHead と不一致、
//     かつそのコミットが origin/main の祖先（＝それより後のpushが未反映）→ anomaly（stale）
//   - それ以外 → 正常
export function classifyDeployHealth({ latestDeployment, vercelBin, localOriginHead, cwd } = {}) {
  if (!latestDeployment) return { status: "unknown", anomaly: false };

  if (latestDeployment.status === "Error") {
    return { status: "error", anomaly: true, reason: "latest-production-deployment-error", url: latestDeployment.url };
  }

  if (latestDeployment.status === "Ready") {
    if (vercelBin && localOriginHead) {
      const commit = getDeploymentCommit(vercelBin, latestDeployment.url);
      if (commit && !localOriginHead.startsWith(commit) && isAncestorOfOriginMain(commit, cwd)) {
        return {
          status: "stale",
          anomaly: true,
          reason: "ready-deployment-behind-origin-main",
          url: latestDeployment.url,
          staleCommit: commit,
        };
      }
    }
    return { status: "ok", anomaly: false };
  }

  // Building/Queued等の中間状態。異常とはみなさない（次回チェックで再評価される）
  return { status: latestDeployment.status || "unknown", anomaly: false };
}
