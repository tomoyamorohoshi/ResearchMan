/**
 * 自己回復ウォッチドッグ（実装計画 researchman-ops-routine.md バッチ3）。
 *
 * 2つの実インシデントの再発防止を主目的とする:
 *   1. (2026-07-07〜08) /ideas改修コミットがVercelビルド(2コア・SSG1ワーカー)で300秒×3回
 *      タイムアウトしビルド失敗。以降9デプロイ連続Error、本番が21時間旧ビルドで凍結。
 *      verify-deploy.mjsは「⏳時間切れ」を通知したが自動対応が無く気づかれなかった。
 *   2. (2026-07-08) /thumbnails/*.jpgへの直接アクセスは200でも、サイトが実際に使う
 *      /_next/image経由(Vercel画像変換)が402(Hobbyプランのクォータ枯渇)で全サムネが壊れた。
 *      →「ファイルの直接チェック」だけでは不十分で、「ページが実際にレンダリングする
 *      img srcを取得して、その実URLをチェックする」方式でなければならない。
 *
 * launchd com.researchman.watchdog（12:30/18:30ゲート。日曜18:30枠のみ--deep）から呼ばれる。
 * 各チェック(0〜3, deepなら4も)はtry/catchで独立させ、1つが例外を投げても他は継続する。
 * すべてのgit操作は scripts/lib/watchdog-git.mjs 経由（pull --rebase必須）。
 *
 * 使い方:
 *   node scripts/watchdog.mjs          # 通常実行（12:30/18:30枠）
 *   node scripts/watchdog.mjs --deep   # 日曜deep（収集情報の誤り監査+サムネ肥大化チェック追加）
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

import {
  resolveVercelBin,
  getLatestProductionDeployment,
  getDeploymentCommit,
  extractBuildErrorLines,
  classifyDeployHealth,
} from "./lib/deploy-health.mjs";
import { gitSafeCommitAndPush, gitSafeRevertAndPush } from "./lib/watchdog-git.mjs";
import { parseJobRuns, filterRecentRuns, hasConsecutiveOutcome, countTodayRejections, readLogSafe, defaultLogPath } from "./lib/log-health.mjs";
import { checkThumbnailsOnPage } from "./lib/thumbnail-page-check.mjs";
import { dedupeCandidates, extractKnownTechIdsFromAuditFailLines } from "./lib/quarantine.mjs";
import { isUrlAlive } from "./verify-video.mjs";
import { dueVerification, readIncidentsSafe } from "./lib/verify-schedule.mjs";
import { jstDateString } from "./lib/jst-date.mjs";
import { runDeepVerification } from "./lib/studio-verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SITE = "https://research-man.vercel.app";
const DEEP = process.argv.includes("--deep");
const REPORT_PATH = path.join(os.tmpdir(), "researchman-watchdog-report.txt");
const DEPLOY_BROKEN_FLAG = path.join(os.tmpdir(), "researchman-watchdog-deploy-broken.flag");
const CASES_PATH = path.join(ROOT, "data/cases.json");
const TECH_PATH = path.join(ROOT, "data/tech.json");
const LAST_RUN_PATH = path.join(ROOT, ".last-watchdog-run.txt");
const STALE_HOURS = 26;
const QUARANTINE_MAX_PER_RUN = 5;
const NOT_QUARANTINED_KINDS = ["videoId-mismatch", "thumbnail-dup"];
const INCIDENTS_PATH = path.join(ROOT, "logs", "incidents.json");
const STUDIO_JOBS_URL = "http://127.0.0.1:5178/api/jobs";
const STUDIO_WEBHOOK_URL = "https://laptop-95255niv.tail5f64f5.ts.net/line-webhook";
const STUDIO_TASK_NAMES = ["ResearchMan-Studio", "ResearchMan-studiokeeper"];

function log(msg) {
  console.log(msg);
}

// ゲート(.last-watchdog-run.txt)の消費は、チェック開始"前"（実行冒頭）に行う。
// 他の3ジョブ・tuneupは「成功時のみ末尾で書く」流儀（失敗は次の正時に自然リトライ）だが、
// watchdogはlaunchctl kickstartや複数のgit push等、他プロセスに影響する外部副作用を
// 多数持つため、ハングや予期しないクラッシュ（トップレベルcatchで拾えない異常終了）で
// 最後まで到達しなくても、同じ12:30/18:30枠内で多重起動しないことを優先する。
// トレードオフ: 冒頭で書くため、途中で失敗しても次の12:30/18:30枠まで再試行されない
// （＝失敗時に早期リトライしたい場合は状態ファイルを手動で削除する）。
function markLastRun() {
  try {
    fs.writeFileSync(LAST_RUN_PATH, new Date().toISOString());
  } catch (e) {
    log(`[watchdog] 状態ファイル書き込み失敗（続行）: ${e.message}`);
  }
}

async function safeCheck(name, fn) {
  try {
    return await fn();
  } catch (e) {
    log(`[watchdog] ${name}チェックで例外（続行）: ${e.stack || e.message}`);
    return null;
  }
}

function git(args, opts = {}) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf-8", ...opts });
}

function writeBrokenFlag() {
  try {
    fs.writeFileSync(DEPLOY_BROKEN_FLAG, new Date().toISOString());
  } catch {}
}

function clearBrokenFlag() {
  try {
    fs.rmSync(DEPLOY_BROKEN_FLAG, { force: true });
  } catch {}
}

function getLocalOriginHead() {
  // 最新のorigin/mainを見るためfetchしてからrev-parseする（読み取り専用・非致命的）
  git(["fetch", "origin", "main"], { timeout: 30000 });
  try {
    const r = git(["rev-parse", "origin/main"]);
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

function getLatestCasePath() {
  try {
    const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf-8"));
    // auto-research-cc.mjs は新規事例を先頭に追加する（[...toAdd, ...existing]）ため
    // cases[0] が最新
    return cases[0]?.id ? `/cases/${cases[0].id}` : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 0. デプロイ死活（最優先・毎回）
// ─────────────────────────────────────────────────────────────
async function checkDeployHealth(report) {
  const vercelBin = resolveVercelBin();
  if (!vercelBin) {
    log("[deploy] vercel CLI利用不可 → スキップ");
    return;
  }

  const localOriginHead = getLocalOriginHead();
  const latest = getLatestProductionDeployment(vercelBin, "research-man");
  const health = classifyDeployHealth({ latestDeployment: latest, vercelBin, localOriginHead, cwd: ROOT });

  if (health.anomaly) {
    log(`[deploy] 異常検知: status=${health.status} url=${latest?.url}`);
    writeBrokenFlag();

    const targetUrl = latest.url;
    const failCommit = health.status === "error" ? getDeploymentCommit(vercelBin, targetUrl) : health.staleCommit;

    const logsRun = spawnSync(vercelBin, ["inspect", targetUrl, "--logs"], {
      timeout: 30000,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 10,
    });
    const errorLines = extractBuildErrorLines(`${logsRun.stdout || ""}\n${logsRun.stderr || ""}`, 10);

    let commitSubject = "(不明)";
    if (failCommit) {
      const r = git(["log", "-1", "--format=%s", failCommit]);
      if (r.status === 0) commitSubject = r.stdout.trim();
    }

    if (failCommit && commitSubject.startsWith("chore: biweekly research tuning")) {
      const revertResult = gitSafeRevertAndPush({ commitHash: failCommit, cwd: ROOT });
      if (revertResult.ok) {
        report.push(
          [
            "🔧 デプロイ異常を自動ロールバックしました",
            `失敗コミット: ${failCommit}（${commitSubject}）`,
            `原因: ${errorLines.join(" / ") || "(ログ取得不可)"}`,
            "→ revert + push 完了。次回チェックで復旧を確認します。",
          ].join("\n")
        );
      } else {
        report.push(
          [
            "🚨 デプロイ異常の自動ロールバックに失敗しました",
            `失敗コミット: ${failCommit}（${commitSubject}）`,
            `revert失敗理由: ${revertResult.reason}`,
            "手動対応が必要です。",
          ].join("\n")
        );
      }
    } else {
      let affectedCount = "(不明)";
      if (failCommit) {
        const r = git(["log", `${failCommit}..origin/main`, "--oneline"]);
        if (r.status === 0) affectedCount = String(r.stdout.trim().split("\n").filter(Boolean).length);
      }
      report.push(
        [
          "🚨 本番デプロイ異常を検知しました（コードの自動修正はしません）",
          `対象デプロイ: ${targetUrl}（Age=${latest.age}）`,
          `失敗コミット: ${failCommit || "(特定不可)"}（${commitSubject}）`,
          `エラー抜粋: ${errorLines.slice(0, 5).join(" | ") || "(取得不可)"}`,
          `未反映コミット数: ${affectedCount}`,
          "Claude Codeセッションでの調査・修正を推奨します。",
        ].join("\n")
      );
    }
    return;
  }

  // 異常なし。直前まで異常だった痕跡（flag）があれば復旧確認する
  if (fs.existsSync(DEPLOY_BROKEN_FLAG)) {
    const homeOk = await pageIs200(`${SITE}/`);
    const latestCasePath = getLatestCasePath();
    const caseOk = latestCasePath ? await pageIs200(`${SITE}${latestCasePath}`) : true;
    if (homeOk && caseOk) {
      report.push(`✅ デプロイ異常から復旧しました（${SITE}/ ${latestCasePath ? `・${SITE}${latestCasePath} ` : ""}とも200を確認）`);
      clearBrokenFlag();
    } else {
      log("[deploy] flag存在だが復旧未確認（次回再確認）");
    }
  }
}

async function pageIs200(url) {
  const res = await isUrlAlive(url).catch(() => false);
  return !!res;
}

// ─────────────────────────────────────────────────────────────
// パイプライン直接再実行（項目1(d)・項目3(b)で共有）
// ─────────────────────────────────────────────────────────────
const PIPELINE_CONFIG = {
  cc: {
    script: "auto-research-cc.mjs",
    addPaths: ["data/cases.json", "public/thumbnails", ":(exclude)public/thumbnails/tech"],
    commitMessage: () => `Auto research: ${todayStr()} (watchdog recovery)`,
    verifyDeploy: { args: [] },
    notify: { args: [] },
  },
  tech: {
    script: "auto-research-tech.mjs",
    addPaths: ["data/tech.json", "public/thumbnails/tech"],
    commitMessage: () => `Tech radar: ${todayStr()} (watchdog recovery)`,
    verifyDeploy: { args: ["--skip-pages"], extraScripts: ["verify-tech-pages.mjs"] },
    notify: { args: ["--route", "technology", "--label", "Technology"] },
  },
  ideas: {
    script: "generate-idea-seeds.mjs",
    addPaths: ["data/ideas.json"],
    commitMessage: () => `Idea seeds: ${todayStr()} (watchdog recovery)`,
    notify: { textFile: path.join(os.tmpdir(), "researchman-idea-seeds.txt") },
  },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function attemptPipelineRecovery(jobKey) {
  const cfg = PIPELINE_CONFIG[jobKey];
  if (!cfg) return { ok: false, reason: `未知のjobKey: ${jobKey}` };

  const run = spawnSync("node", [`scripts/${cfg.script}`], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 20 * 60 * 1000,
  });
  if (!run || run.status !== 0) {
    return { ok: false, reason: `パイプライン(${cfg.script})実行失敗（exit ${run?.status}）`, lines: [`${jobKey}: パイプライン再実行が失敗しました（exit ${run?.status}）`] };
  }

  // ideas: 生成成功時点でLINE配信（既存plistと同じ順序。push成否は配信を巻き込まない）
  if (jobKey === "ideas" && cfg.notify.textFile) {
    spawnSync("node", ["scripts/notify-line.mjs", "--text-file", cfg.notify.textFile], { cwd: ROOT, timeout: 30000 });
  }

  const commitResult = gitSafeCommitAndPush({ addPaths: cfg.addPaths, commitMessage: cfg.commitMessage(), cwd: ROOT });
  if (!commitResult.committed) {
    return { ok: true, committed: false, lines: [`${jobKey}: 再実行しましたが新規データなし（変更なし）`] };
  }
  if (!commitResult.ok) {
    return { ok: false, reason: commitResult.reason, lines: [`${jobKey}: 再実行で新規データ生成→commitしたがpush失敗（${commitResult.reason}）`] };
  }

  let verified = true;
  if (jobKey !== "ideas") {
    const vd = spawnSync("node", ["scripts/verify-deploy.mjs", ...cfg.verifyDeploy.args], { cwd: ROOT, timeout: 400000 });
    verified = vd.status === 0;
    for (const script of cfg.verifyDeploy.extraScripts || []) {
      if (!verified) break;
      const r = spawnSync("node", [`scripts/${script}`], { cwd: ROOT, timeout: 400000 });
      verified = r.status === 0;
    }
    spawnSync(
      "node",
      ["scripts/notify-line.mjs", ...cfg.notify.args, ...(verified ? [] : ["--result", "unverified"])],
      { cwd: ROOT, timeout: 30000 }
    );
  }

  return {
    ok: true,
    committed: true,
    verified,
    lines: [`${jobKey}: watchdogによる再実行で回復・commit/push完了${jobKey !== "ideas" ? (verified ? "・反映確認OK" : "（反映未確認）") : ""}`],
  };
}

// ─────────────────────────────────────────────────────────────
// 1. 10時更新の死活
// ─────────────────────────────────────────────────────────────
const JOB_STATE_FILES = [
  { file: ".last-research-run.txt", label: "Case Study収集", launchdLabel: "com.researchman.autoresearch", jobKey: "cc" },
  { file: ".last-tech-research-run.txt", label: "Technology収集", launchdLabel: "com.researchman.techresearch", jobKey: "tech" },
  { file: ".last-idea-seeds-run.txt", label: "IdeaSeeds生成", launchdLabel: "com.researchman.ideaseeds", jobKey: "ideas" },
];

function staleInfo(stateFile) {
  const p = path.join(ROOT, stateFile);
  try {
    const raw = fs.readFileSync(p, "utf-8").trim();
    const last = new Date(raw);
    if (Number.isNaN(last.getTime())) return { stale: true, reasonText: "状態ファイルの中身が不正" };
    const hours = (Date.now() - last.getTime()) / 3600000;
    return { stale: hours > STALE_HOURS, hours };
  } catch {
    return { stale: true, reasonText: "状態ファイルが存在しない" };
  }
}

function cleanupStaleGitLock(lines) {
  const LOCK = path.join(os.tmpdir(), "researchman-git.lock");
  try {
    const st = fs.statSync(LOCK);
    const ageSec = (Date.now() - st.mtimeMs) / 1000;
    if (ageSec > 5400) {
      fs.rmdirSync(LOCK);
      lines.push(`staleロック掃除: ${LOCK}（${Math.round(ageSec)}秒経過）`);
      return true;
    }
  } catch {}
  return false;
}

function waitForStateUpdate(stateFile) {
  return new Promise((resolve) => {
    const p = path.join(ROOT, stateFile);
    const deadline = Date.now() + 5 * 60 * 1000;
    const beforeMtime = (() => {
      try {
        return fs.statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    })();
    const tick = () => {
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs > beforeMtime) return resolve(true);
      } catch {}
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 30000);
    };
    tick();
  });
}

async function checkDailyRunHealth(report) {
  for (const job of JOB_STATE_FILES) {
    const info = staleInfo(job.file);
    if (!info.stale) continue;

    log(`[daily] ${job.label} stale検知（${info.reasonText || `${info.hours?.toFixed(1)}h経過`}）`);
    const lines = [`⚠️ ${job.label}の毎朝10時更新が${STALE_HOURS}時間超停止しています（${info.reasonText || `${info.hours?.toFixed(1)}時間経過`}）。`];

    cleanupStaleGitLock(lines);

    if (process.platform === "win32") {
      // Windowsではlaunchdの代わりにタスクスケジューラの該当タスクを即時起動する
      // （scripts/windows/register-tasks.ps1 が ResearchMan-<job> 名で登録している。
      // 起動されたrun-job.mjs側もrun-if-due.mjsでゲートするためlaunchd時代と同じ意味論。
      // ここを分岐しないとprocess.getuid()がWindowsに存在せず例外→safeCheckが
      // このチェック全体を無効化し、stale検知・直接復旧まで一切働かなくなる）
      const taskName = `ResearchMan-${job.launchdLabel.split(".").pop()}`;
      const kick = spawnSync("schtasks", ["/Run", "/TN", taskName], { timeout: 15000 });
      lines.push(`schtasks /Run を実行しました（${taskName}、exit=${kick.status}）`);
    } else {
      const kickstart = spawnSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${job.launchdLabel}`], { timeout: 15000 });
      lines.push(`launchctl kickstart -k を実行しました（${job.launchdLabel}、exit=${kickstart.status}）`);
    }

    const recovered = await waitForStateUpdate(job.file);
    if (recovered) {
      lines.push("kickstartで復旧を確認しました（状態ファイルが更新されました）。");
      report.push(lines.join("\n"));
      continue;
    }

    lines.push("kickstart後も更新されず → パイプラインを直接1回実行します。");
    const result = attemptPipelineRecovery(job.jobKey);
    lines.push(...(result.lines || [result.ok ? "回復成功" : `回復失敗: ${result.reason}`]));
    report.push(lines.join("\n"));
  }
}

// ─────────────────────────────────────────────────────────────
// 2. サムネイル（ページが実際に参照するURLで検査）
// ─────────────────────────────────────────────────────────────
async function checkThumbnails(report) {
  const caseFailures = await checkThumbnailsOnPage(`${SITE}/`, { sampleCount: 4 }).catch((e) => [{ reason: `例外: ${e.message}` }]);
  if (caseFailures.length) {
    log(`[thumb] Case Study: ${caseFailures.length}件失敗`);
    const heal = spawnSync("node", ["scripts/self-heal-thumbnails.mjs"], { cwd: ROOT, encoding: "utf-8", timeout: 20 * 60 * 1000 });
    const commitResult = gitSafeCommitAndPush({
      addPaths: ["data/cases.json", "public/thumbnails", ":(exclude)public/thumbnails/tech"],
      commitMessage: "fix: self-heal thumbnails (watchdog)",
      cwd: ROOT,
    });
    report.push(
      [
        `🖼 Case Studyサムネイル異常を検知（${caseFailures.length}件、ページ実URLで検査）`,
        ...caseFailures.slice(0, 5).map((f) => `  - ${f.src || "(取得不可)"}: ${f.reason}`),
        heal.status !== 0 ? "self-heal-thumbnails.mjsの実行が異常終了しました。" : "",
        commitResult.committed
          ? `self-heal-thumbnails.mjsで修復しcommit/push${commitResult.ok ? "完了" : `に問題（${commitResult.reason}）`}。`
          : "self-heal-thumbnails.mjsを実行しましたが変更なし（自動修復できなかった可能性）。",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const techFailures = await checkThumbnailsOnPage(`${SITE}/technology`, { sampleCount: 4 }).catch((e) => [{ reason: `例外: ${e.message}` }]);
  if (techFailures.length) {
    log(`[thumb] Technology: ${techFailures.length}件失敗`);
    report.push(
      [
        `🖼 Technologyサムネイル異常を検知（${techFailures.length}件、ページ実URLで検査）`,
        ...techFailures.slice(0, 5).map((f) => `  - ${f.src || "(取得不可)"}: ${f.reason}`),
        "Technology用の自動修復スクリプトは存在しないため自動修復はしていません（要手動確認）。",
      ].join("\n")
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 3. 収集アルゴリズム破損の検知
// ─────────────────────────────────────────────────────────────
const LOG_JOBS = [
  { jobKey: "cc", label: "Case Study収集", logPath: defaultLogPath("auto") },
  { jobKey: "tech", label: "Technology収集", logPath: defaultLogPath("tech") },
  { jobKey: "ideas", label: "IdeaSeeds生成", logPath: defaultLogPath("ideas") },
];

function findRecentTuningCommit(withinDays) {
  const r = git(["log", "--grep=^chore: biweekly research tuning", "-1", "--format=%H %cI"]);
  if (r.status !== 0 || !r.stdout.trim()) return null;
  const [hash, dateStr] = r.stdout.trim().split(" ");
  if (!hash || !dateStr) return null;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  return days <= withinDays ? hash : null;
}

async function checkCollectionHealth(report) {
  const twoDaysMs = 2 * 24 * 3600 * 1000;
  for (const job of LOG_JOBS) {
    const text = readLogSafe(job.logPath);
    const runs = parseJobRuns(text);
    const recent = filterRecentRuns(runs, twoDaysMs);
    if (!hasConsecutiveOutcome(recent, "error", 2)) continue;

    log(`[collection] ${job.jobKey}: 直近2run連続error検知`);
    const lines = [`🚨 ${job.label}が直近2回連続でエラー終了しています。`];

    cleanupStaleGitLock(lines);

    const recoveryResult = attemptPipelineRecovery(job.jobKey);
    lines.push(...(recoveryResult.lines || [recoveryResult.ok ? "再実行1回で回復" : `再実行も失敗: ${recoveryResult.reason}`]));

    if (!recoveryResult.ok) {
      const tuningCommit = findRecentTuningCommit(3);
      if (tuningCommit) {
        const revertResult = gitSafeRevertAndPush({ commitHash: tuningCommit, cwd: ROOT });
        lines.push(
          revertResult.ok
            ? `直近3日以内のチューンアップコミット(${tuningCommit.slice(0, 8)})をrevertしました。`
            : `チューンアップコミットのrevertにも失敗しました（${revertResult.reason}）。`
        );
      }
    }

    if (!recoveryResult.ok) {
      const excerpt = text.split("\n").filter(Boolean).slice(-15).join("\n");
      lines.push("── 直近ログ抜粋 ──", excerpt || "(ログなし)", "Claude Codeセッションでの調査を推奨します。コードの自動修正は行っていません。");
    }

    report.push(lines.join("\n"));
  }

  const logsDir = path.join(ROOT, "logs");
  const todayRejections = countTodayRejections(logsDir);
  if (todayRejections > 15) {
    report.push(`⚠️ 本日の却下候補が${todayRejections}件（閾値15件超）です。収集元の劣化の可能性があります（logs/rejections-*.jsonl参照）。`);
  }
}

// ─────────────────────────────────────────────────────────────
// 4. 収集情報の誤り（--deepのみ・日曜）
// ─────────────────────────────────────────────────────────────
function sampleArray(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function summarizeByKind(issues) {
  const byKind = {};
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  return Object.entries(byKind)
    .map(([k, n]) => `${k}:${n}`)
    .join(", ") || "なし";
}

async function runDeepAudit(report, priorEventCount) {
  log("[deep] audit-integrity / audit-tech 実行中...");
  const integrityOutPath = path.join(os.tmpdir(), "researchman-watchdog-integrity.json");
  let integrityIssues = [];
  try {
    spawnSync("node", ["scripts/audit-integrity.mjs", "--out", integrityOutPath], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 20 * 60 * 1000,
    });
    const rep = JSON.parse(fs.readFileSync(integrityOutPath, "utf-8"));
    integrityIssues = rep.issues || [];
  } catch (e) {
    log(`[deep] audit-integrity実行/読込に失敗: ${e.message}`);
  }

  let techAuditFailLines = [];
  try {
    const techAuditRun = spawnSync("node", ["scripts/audit-tech.mjs"], { cwd: ROOT, encoding: "utf-8", timeout: 5 * 60 * 1000 });
    techAuditFailLines = (techAuditRun.stdout || "").split("\n").filter((l) => l.startsWith("✗"));
  } catch (e) {
    log(`[deep] audit-tech実行に失敗: ${e.message}`);
  }

  // tech links死活の標本再検査（30件・死んでいたものは直列でダブルチェック）
  let deadTechLinks = [];
  let tech = [];
  try {
    tech = JSON.parse(fs.readFileSync(TECH_PATH, "utf-8"));
    const candidates = tech.filter((t) => !t.quarantined && t.links?.[0]?.url);
    const sample = sampleArray(candidates, 30);
    for (const t of sample) {
      const url = t.links[0].url;
      const alive1 = await isUrlAlive(url).catch(() => true); // 例外時は誤検知を避け「生存」扱い
      if (alive1) continue;
      const alive2 = await isUrlAlive(url).catch(() => true);
      if (!alive2) deadTechLinks.push(t);
    }
  } catch (e) {
    log(`[deep] tech links死活サンプル検査に失敗: ${e.message}`);
  }

  // ── 隔離対象の選定（高確度のみ。既知の誤検知が多いkindは対象外＝OPERATIONS.md §5） ──
  let cases = [];
  const quarantineCandidates = [];
  try {
    cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf-8"));
    for (const issue of integrityIssues) {
      if (issue.kind === "thumbnail" && /ローカルファイル欠損/.test(issue.detail)) {
        quarantineCandidates.push({ dataset: "cases", id: issue.id, reason: `thumbnail: ${issue.detail}` });
      } else if (issue.kind === "link-dead") {
        const c = cases.find((x) => x.id === issue.id);
        if (c?.link) {
          const alive = await isUrlAlive(c.link).catch(() => true);
          if (!alive) quarantineCandidates.push({ dataset: "cases", id: issue.id, reason: `link-dead(二重確認済): ${issue.detail}` });
        }
      }
    }
  } catch (e) {
    log(`[deep] cases.json隔離候補選定に失敗: ${e.message}`);
  }

  for (const t of deadTechLinks) {
    quarantineCandidates.push({ dataset: "tech", id: t.id, reason: `tech links[0]死活確認失敗(二重確認済): ${t.links[0].url}` });
  }
  // audit-tech.mjsのFAIL行から候補idを拾う際、抽出したidが実際にtech.jsonに存在する
  // エントリであることを確認してから候補に加える（`✗ ORPHANED THUMBNAIL FILE:
  // public/thumbnails/tech/xxx.jpg`のような「idを名乗らない」FAIL行が誤って
  // id="public"のような偽候補を生む事故の防止。ロジックはscripts/lib/quarantine.mjsに
  // 切り出しfixtureで単体テスト済み＝scripts/smoke-watchdog-quarantine.mjs）
  for (const id of extractKnownTechIdsFromAuditFailLines(techAuditFailLines, tech.map((t) => t.id))) {
    quarantineCandidates.push({ dataset: "tech", id, reason: "audit-tech.mjs FAIL（フィールド欠落/語彙違反/サムネイル欠損）" });
  }

  // 同一entryが複数の理由（例: thumbnail欠損 かつ audit-tech FAIL）で重複して候補に
  // 入りうるため、dataset+idでユニーク化してから5件上限を適用する（重複を1件と誤って
  // 数えないため。理由は結合して残す。ロジックはscripts/lib/quarantine.mjsに切り出し済み）
  const alreadyQuarantined = (dataset, id) => {
    const arr = dataset === "cases" ? cases : tech;
    return !!arr.find((x) => x.id === id)?.quarantined;
  };
  const uniqueCandidates = dedupeCandidates(quarantineCandidates);
  const freshCandidates = uniqueCandidates.filter((c) => !alreadyQuarantined(c.dataset, c.id));
  const toQuarantine = freshCandidates.slice(0, QUARANTINE_MAX_PER_RUN);
  const deferred = Math.max(freshCandidates.length - toQuarantine.length, 0);

  let casesChanged = false;
  let techChanged = false;
  const nowIso = new Date().toISOString();
  for (const t of toQuarantine) {
    const arr = t.dataset === "cases" ? cases : tech;
    const entry = arr.find((x) => x.id === t.id);
    if (entry && !entry.quarantined) {
      entry.quarantined = true;
      entry.quarantineReason = t.reason;
      entry.quarantineTs = nowIso;
      if (t.dataset === "cases") casesChanged = true;
      else techChanged = true;
    }
  }

  if (casesChanged || techChanged) {
    try {
      if (casesChanged) fs.writeFileSync(CASES_PATH, JSON.stringify(cases, null, 2));
      if (techChanged) fs.writeFileSync(TECH_PATH, JSON.stringify(tech, null, 2));
      const addPaths = [];
      if (casesChanged) addPaths.push("data/cases.json");
      if (techChanged) addPaths.push("data/tech.json");
      const commitResult = gitSafeCommitAndPush({
        addPaths,
        commitMessage: `fix: quarantine ${toQuarantine.length} low-confidence entries (watchdog deep audit)`,
        cwd: ROOT,
      });
      report.push(
        [
          `🔒 低確度エントリを${toQuarantine.length}件隔離しました${deferred > 0 ? `（他${deferred}件は次回に持ち越し）` : ""}`,
          ...toQuarantine.map((t) => `  - [${t.dataset}] ${t.id}: ${t.reason}`),
          commitResult.ok ? "commit/push完了。" : `commit/pushに問題（${commitResult.reason}）`,
        ].join("\n")
      );
    } catch (e) {
      report.push(`⚠️ 隔離データの書き込みに失敗しました: ${e.message}`);
    }
  } else if (freshCandidates.length) {
    report.push(`ℹ️ 隔離候補${freshCandidates.length}件を検出しましたが実変更は0件でした（既に隔離済み等）。`);
  }

  // ── サムネイル肥大化チェック（日曜deep追加分） ──
  let normalizeTargetCount = 0;
  try {
    const normalizeDry = spawnSync("node", ["scripts/normalize-thumbnails.mjs", "--dry-run"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10 * 60 * 1000,
    });
    const m = (normalizeDry.stdout || "").match(/対象\s+(\d+)\/(\d+)\s*件/);
    normalizeTargetCount = m ? Number(m[1]) : 0;
    if (normalizeTargetCount > 0) {
      spawnSync("node", ["scripts/normalize-thumbnails.mjs"], { cwd: ROOT, encoding: "utf-8", timeout: 10 * 60 * 1000 });
      const commitResult = gitSafeCommitAndPush({
        addPaths: ["public/thumbnails"],
        commitMessage: "fix: normalize oversized thumbnails (watchdog self-heal)",
        cwd: ROOT,
      });
      report.push(
        `🗜 サムネイル肥大化を${normalizeTargetCount}件検出し正規化しました${commitResult.committed ? `（commit/push${commitResult.ok ? "完了" : `に問題: ${commitResult.reason}`}）` : "（実差分なし）"}。`
      );
    }
  } catch (e) {
    log(`[deep] サムネイル肥大化チェックに失敗: ${e.message}`);
  }

  const lowConfidenceCount = integrityIssues.filter((i) => NOT_QUARANTINED_KINDS.includes(i.kind)).length;

  const summaryLines = [
    "📊 ResearchMan 今週のヘルスサマリー（日曜deep監査）",
    "",
    `監査対象: 事例${cases.length || "?"}件・技術${tech.length || "?"}件・techリンク標本${Math.min(30, tech.length || 0)}件`,
    `検出した問題: 事例監査${integrityIssues.length}件（${summarizeByKind(integrityIssues)}）・tech監査FAIL${techAuditFailLines.length}件・tech links死活NG${deadTechLinks.length}件`,
    `うち自動隔離しない低確度種別（videoId-mismatch/thumbnail-dup）: ${lowConfidenceCount}件`,
    `今回隔離: ${toQuarantine.length}件${deferred > 0 ? `（他${deferred}件は次回）` : ""}`,
    `サムネイル正規化: ${normalizeTargetCount}件`,
    `その他の自己回復イベント（今回の通常チェック0〜3由来）: ${priorEventCount}件`,
  ];
  return summaryLines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// 5. Studio死活の事故後段階的検証（+1/+3/+7日のみ・studio-keeper.mjsが記録した
//    logs/incidents.jsonが起点）
// ─────────────────────────────────────────────────────────────
// 2026-07-17〜21のStudio無言死インシデントの再発防止策（studio-keeper.mjs、15分毎の
// 死活監視・自動復旧）が実際に機能し続けているかを、事故から+1/+3/+7日後にだけ深く確認する。
// この検証は「動いている」という報告自体が目的のため、他チェックと異なり結果によらず
// 必ずreportへpushする（=main()側でreport.lengthが0でなくなり必ずLINE通知される）。
async function checkStudioVerifySchedule(report) {
  const incidents = readIncidentsSafe(INCIDENTS_PATH);
  const today = jstDateString();
  if (!dueVerification(incidents, today)) return;

  log("[studio-verify] 検証対象日 → Studio死活の段階的検証を実行します");
  const result = await runDeepVerification({
    jobsUrl: STUDIO_JOBS_URL,
    webhookUrl: STUDIO_WEBHOOK_URL,
    taskNames: STUDIO_TASK_NAMES,
  });
  report.push(result.reportText);
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────
async function main() {
  markLastRun();
  log(`\nResearchMan Watchdog ${new Date().toLocaleString("ja-JP")}${DEEP ? "（+deep）" : ""}`);

  const report = [];
  await safeCheck("deploy-health", () => checkDeployHealth(report));
  await safeCheck("daily-run-health", () => checkDailyRunHealth(report));
  await safeCheck("thumbnails", () => checkThumbnails(report));
  await safeCheck("collection-health", () => checkCollectionHealth(report));
  await safeCheck("studio-verify-schedule", () => checkStudioVerifySchedule(report));

  let reportText = null;
  if (report.length) {
    reportText = [`🐕 ResearchMan Watchdog`, "", ...report, "", SITE].join("\n\n");
  }

  if (DEEP) {
    const priorEventCount = report.length;
    const summaryText = await safeCheck("deep-audit", () => runDeepAudit(report, priorEventCount));
    if (summaryText) {
      reportText = (reportText ? reportText + "\n\n" : "🐕 ResearchMan Watchdog\n\n") + summaryText;
    }
  }

  if (reportText) {
    fs.writeFileSync(REPORT_PATH, reportText.trimEnd() + "\n");
    spawnSync("node", ["scripts/notify-line.mjs", "--text-file", REPORT_PATH], { cwd: ROOT, timeout: 30000 });
    log(`[watchdog] 異常検知・修復あり → LINE通知（${report.length}件）`);
  } else {
    log("異常なし・通知なし（静粛）");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ watchdog自体がエラー終了:", e.stack || e.message);
    try {
      fs.writeFileSync(REPORT_PATH, `⚠ watchdog自体がエラー終了\n\n${e.stack || e.message}\n\n${SITE}\n`);
      spawnSync("node", ["scripts/notify-line.mjs", "--text-file", REPORT_PATH], { cwd: ROOT, timeout: 30000 });
    } catch {}
    process.exit(1);
  });
