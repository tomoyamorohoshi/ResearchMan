/**
 * scripts/windows/run-job.mjs
 *
 * Windows タスクスケジューラ用の汎用ジョブランナー。macOS launchd の5つのplist
 * （launchd/com.researchman.*.plist）が持つzshロジックを、忠実にNodeへ移植したもの。
 * 各jobの実行シーケンス・分岐・通知文言・ログの区切りマーカーは元のzshと一字一句
 * 揃えてある（scripts/lib/log-health.mjs のマーカー文字列パースがWindows生成ログでも
 * そのまま動くようにするため）。
 *
 * 使い方: node scripts/windows/run-job.mjs <job>
 *   <job> … autoresearch | techresearch | ideaseeds | tuneup | watchdog
 *
 * ログ: %USERPROFILE%\.researchman\logs\researchman-<short>.log
 *   short: autoresearch→auto, techresearch→tech, ideaseeds→ideas, tuneup→tuneup,
 *   watchdog→watchdog。plist時代の実ログファイル名をそのまま踏襲する
 *   （scripts/lib/log-health.mjs::defaultLogPath() が生成するパスと一致させる必要がある。
 *   watchdog.mjsのcheckCollectionHealth()がこのファイル名でログを読み、直近runの
 *   成功/失敗を判定するため、ファイル名がズレると健全性チェックが機能しなくなる）。
 *   5MB超で <name>.log.1 へローテート（plist同様、ジョブ本体の実行より前に必ず行う）。
 *
 * git排他ロック: os.tmpdir()/researchman-git.lock を mkdir 方式で取得する
 *   （scripts/lib/watchdog-git.mjs・studio/server/pipeline/lock.ts と同一のパス定数。
 *   全プロセスが同じ os.tmpdir() を返すため、これだけで排他が一致する）。
 *   30秒間隔でリトライし、待機上限はジョブごとにplistの値をそのまま踏襲する
 *   （autoresearch/techresearch=30分、ideaseeds/tuneup=45分）。90分（5400秒）超の
 *   staleロックは奪取する。watchdogジョブだけはこのロックを取得しない
 *   （launchd/com.researchman.watchdog.plistのコメント参照: watchdog.mjs内部が
 *   scripts/lib/watchdog-git.mjs経由で必要な瞬間だけ短く握る設計になっている）。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { isMainBranch, parseCurrentBranch } from "../lib/branch-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", ".."); // scripts/windows -> repo root
const NODE_BIN = process.execPath; // PATHに依存しない（タスクスケジューラの実行環境対策）
const LOCK_PATH = path.join(os.tmpdir(), "researchman-git.lock");
const STALE_MS = 5400 * 1000; // 90分（既存3ジョブ・scripts/lib/watchdog-git.mjsと同じ閾値）

const JOB = process.argv[2];

// job → ログファイル短縮名（plist時代の実ファイル名を踏襲。変更禁止）
const JOB_TABLE = {
  autoresearch: { shortName: "auto" },
  techresearch: { shortName: "tech" },
  ideaseeds: { shortName: "ideas" },
  tuneup: { shortName: "tuneup" },
  watchdog: { shortName: "watchdog" },
};

if (!JOB || !JOB_TABLE[JOB]) {
  console.error(`使い方: node scripts/windows/run-job.mjs <${Object.keys(JOB_TABLE).join("|")}>`);
  process.exit(2);
}

// ── Unix `date` 互換の日時文字列 ──────────────────────────────
// 例: "Tue Jul  8 10:00:01 JST 2026"。scripts/lib/log-health.mjs の
// parseJobRuns/parseLogDate がこの形式（曜日3文字 月3文字 日 時:分:秒 TZ 年）を
// 前提にパースするため、Windows生成ログでも同じ形式で書く必要がある
// （形式がズレるとwatchdogの「直近2run連続error」検知が機能しなくなる）。
// タイムゾーンは固定文字列"JST"（このプロジェクトはJST運用前提。タスクスケジューラを
// 登録するアカウントのシステム時刻がJSTであることが前提）。
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function unixDateString(d = new Date()) {
  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${weekday} ${month} ${day} ${hh}:${mm}:${ss} JST ${d.getFullYear()}`;
}

// `date '+%Y-%m-%d'`相当（コミットメッセージ用）。ローカル時刻基準（システムがJST前提）。
function todayYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// git実行バイナリの解決（PATHに依存しない。scripts/lib/claude-cli.mjs::resolveClaudeBin と
// 同じ方針でwhere/which→既知パスの順に探す。タスクスケジューラは対話ログインより
// 環境変数が限定されることがあるための保険）。
function resolveGitBin() {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("where", ["git"], { encoding: "utf-8" }).trim().split(/\r?\n/)[0];
      if (out) return out;
    } catch {}
    for (const p of [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    ]) {
      if (fs.existsSync(p)) return p;
    }
    return "git";
  }
  try {
    return execFileSync("which", ["git"], { encoding: "utf-8" }).trim();
  } catch {
    return "git";
  }
}
const GIT_BIN = resolveGitBin();

// ── ログ ────────────────────────────────────────────────────
const LOG_DIR = path.join(os.homedir(), ".researchman", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `researchman-${JOB_TABLE[JOB].shortName}.log`);

// 5MB超で.1へローテート（plist同様、ジョブ本体の実行より前に必ず行う。
// ゲート判定でスキップされる回でもローテートだけは走る＝元のzshと同じ順序）
(function rotateLogIfNeeded() {
  try {
    const st = fs.statSync(LOG_PATH);
    if (st.size > 5 * 1024 * 1024) {
      const rotated = `${LOG_PATH}.1`;
      try {
        fs.rmSync(rotated, { force: true });
      } catch {}
      fs.renameSync(LOG_PATH, rotated);
    }
  } catch {
    // ログがまだ無ければ何もしない
  }
})();

const logFd = fs.openSync(LOG_PATH, "a");
function log(msg) {
  fs.writeSync(logFd, `${msg}\n`);
}

// ── 子プロセス実行ヘルパー ──────────────────────────────────
// nodeはPATHに依存せず process.execPath で呼ぶ。stdio はログへ追記
// （plistの `>> $LOG 2>&1` に相当）。
function runNode(relScriptPath, args = []) {
  // 従量課金防止ガード: APIキー系の環境変数を子スクリプトに渡さない（常にサブスクの
  // ログイン認証で動かす。ユーザー方針 2026-07-13。claude-cli.mjs / studio にも同じガードあり）
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return spawnSync(NODE_BIN, [path.join(ROOT, relScriptPath), ...args], {
    cwd: ROOT,
    stdio: ["ignore", logFd, logFd],
    env,
  });
}
function runGit(args) {
  return spawnSync(GIT_BIN, args, { cwd: ROOT, stdio: ["ignore", logFd, logFd] });
}
// `git diff --cached --quiet` は判定専用（元の出力も無し）なのでログに書かない
function gitDiffCachedIsEmpty() {
  const r = spawnSync(GIT_BIN, ["diff", "--cached", "--quiet"], { cwd: ROOT, stdio: "ignore" });
  return r.status === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── git排他ロック（mkdir方式。os.tmpdir()/researchman-git.lock） ──────
async function acquireLock(waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_PATH);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    try {
      const st = fs.statSync(LOCK_PATH);
      if (Date.now() - st.mtimeMs > STALE_MS) {
        log(`staleロック奪取: ${unixDateString()}`);
        try {
          fs.rmdirSync(LOCK_PATH);
        } catch {}
        continue;
      }
    } catch {}
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(30000, Math.max(0, deadline - Date.now())));
  }
}
function releaseLock() {
  try {
    fs.rmdirSync(LOCK_PATH);
  } catch {}
}

// ── 各ジョブ ────────────────────────────────────────────────
// 3ジョブ共通で「収集→git add/commit/push→verify-deploy→notify」の骨格を持つが、
// パス・コミットメッセージ・verify引数・notify引数がplistごとに異なるため、
// 忠実さを優先してほぼ独立に書く（共通化による差異の埋没を避ける）。

async function runAutoresearch() {
  const due = runNode("scripts/run-if-due.mjs", ["--daily-at", "10"]);
  if (due.status !== 0) return; // 期限前・対象日でない → 静かにスキップ（plistの`|| exit 0`）

  if (!(await acquireLock(30 * 60 * 1000))) {
    log(`ロック取得タイムアウト: ${unixDateString()}`);
    return;
  }
  try {
    log(`===== Run start: ${unixDateString()} =====`);
    const cc = runNode("scripts/auto-research-cc.mjs");
    if (cc.status !== 0) {
      log(`収集エラー終了: ${unixDateString()}`);
      runNode("scripts/run-if-due.mjs", ["--mark"]);
      runNode("scripts/notify-line.mjs", ["--result", "error"]);
      return;
    }
    const heal = runNode("scripts/self-heal-thumbnails.mjs");
    if (heal.status !== 0) log(`self-heal失敗（続行）: ${unixDateString()}`);

    runGit(["add", "--", "data/cases.json", "public/thumbnails", ":(exclude)public/thumbnails/tech"]);
    if (gitDiffCachedIsEmpty()) {
      log(`変更なし（新規事例なし）: ${unixDateString()}`);
      runNode("scripts/notify-line.mjs");
    } else {
      runGit(["commit", "-m", `Auto research: ${todayYmd()}`]);
      const push = runGit(["push"]);
      if (push.status === 0) {
        const verify = runNode("scripts/verify-deploy.mjs");
        if (verify.status === 0) {
          log(`反映まで確認OK: ${unixDateString()}`);
          runNode("scripts/send-mail.mjs");
          runNode("scripts/notify-line.mjs");
        } else {
          log(`push成功だが反映未確認（時間切れ）: ${unixDateString()}`);
          runNode("scripts/notify-line.mjs", ["--result", "unverified"]);
        }
      } else {
        log(`push失敗（pre-push監査で中止の可能性）。コミットはローカル残存。要手動対応: ${unixDateString()}`);
        runNode("scripts/notify-line.mjs", ["--result", "pushfail"]);
      }
    }
    log(`Completed: ${unixDateString()}`);
  } finally {
    releaseLock();
  }
}

async function runTechresearch() {
  const due = runNode("scripts/run-if-due.mjs", ["--state", ".last-tech-research-run.txt", "--daily-at", "10"]);
  if (due.status !== 0) return;

  if (!(await acquireLock(30 * 60 * 1000))) {
    log(`ロック取得タイムアウト: ${unixDateString()}`);
    return;
  }
  try {
    log(`===== Tech run start: ${unixDateString()} =====`);
    const tech = runNode("scripts/auto-research-tech.mjs");
    const summaryArgs = [
      "--summary",
      path.join(os.tmpdir(), "researchman-tech-last-add.json"),
      "--route",
      "technology",
      "--label",
      "Technology",
    ];
    if (tech.status !== 0) {
      log(`収集エラー終了: ${unixDateString()}`);
      runNode("scripts/run-if-due.mjs", ["--state", ".last-tech-research-run.txt", "--mark"]);
      runNode("scripts/notify-line.mjs", ["--result", "error", "--route", "technology", "--label", "Technology"]);
      return;
    }
    runGit(["add", "data/tech.json", "public/thumbnails/tech/"]);
    if (gitDiffCachedIsEmpty()) {
      log(`変更なし（新規技術なし）: ${unixDateString()}`);
      runNode("scripts/notify-line.mjs", summaryArgs);
    } else {
      runGit(["commit", "-m", `Tech radar: ${todayYmd()}`]);
      const push = runGit(["push"]);
      if (push.status === 0) {
        // 元のzshは `verify-deploy --skip-pages && verify-tech-pages` の短絡評価。
        // verify-deployが失敗したらverify-tech-pagesは実行しない。
        const verifyDeploy = runNode("scripts/verify-deploy.mjs", ["--skip-pages"]);
        const verifyTechPages = verifyDeploy.status === 0 ? runNode("scripts/verify-tech-pages.mjs") : verifyDeploy;
        if (verifyDeploy.status === 0 && verifyTechPages.status === 0) {
          log(`反映まで確認OK: ${unixDateString()}`);
          runNode("scripts/notify-line.mjs", summaryArgs);
        } else {
          log(`push成功だが反映未確認（時間切れ）: ${unixDateString()}`);
          runNode("scripts/notify-line.mjs", ["--result", "unverified", ...summaryArgs]);
        }
      } else {
        log(`push失敗（pre-push監査で中止の可能性）。コミットはローカル残存。要手動対応: ${unixDateString()}`);
        runNode("scripts/notify-line.mjs", ["--result", "pushfail", ...summaryArgs]);
      }
    }
    log(`Tech completed: ${unixDateString()}`);
  } finally {
    releaseLock();
  }
}

async function runIdeaseeds() {
  const due = runNode("scripts/run-if-due.mjs", ["--state", ".last-idea-seeds-run.txt", "--daily-at", "10"]);
  if (due.status !== 0) return;

  if (!(await acquireLock(45 * 60 * 1000))) {
    log(`ロック取得タイムアウト: ${unixDateString()}`);
    return;
  }
  try {
    log(`===== Idea seeds start: ${unixDateString()} =====`);
    const gen = runNode("scripts/generate-idea-seeds.mjs");
    if (gen.status === 0) {
      runNode("scripts/notify-line.mjs", ["--text-file", path.join(os.tmpdir(), "researchman-idea-seeds.txt")]);
      // data/ideas.json と data/idea-layouts.json は必ずペアでcommit/push
      // （片方だけだとpre-push鮮度検査に拒否される。launchd/com.researchman.ideaseeds.plist参照）
      runGit(["add", "data/ideas.json", "data/idea-layouts.json"]);
      if (gitDiffCachedIsEmpty()) {
        log(`ideas.json変更なし（追記対象なし）: ${unixDateString()}`);
      } else {
        runGit(["commit", "-m", `Idea seeds: ${todayYmd()}`]);
        const push = runGit(["push"]);
        if (push.status === 0) {
          log(`ideas.json push成功: ${unixDateString()}`);
        } else {
          log(`push失敗（pre-push監査で中止の可能性）。コミットはローカル残存。要手動対応: ${unixDateString()}`);
          runNode("scripts/notify-line.mjs", ["--result", "pushfail", "--label", "IdeaSeeds"]);
        }
      }
    } else {
      log(`生成エラー終了: ${unixDateString()}`);
      runNode("scripts/run-if-due.mjs", ["--state", ".last-idea-seeds-run.txt", "--mark"]);
      runNode("scripts/notify-line.mjs", ["--result", "error", "--label", "IdeaSeeds"]);
    }
    log(`Idea seeds completed: ${unixDateString()}`);
  } finally {
    releaseLock();
  }
}

async function runTuneup() {
  // 週次実行（2026-07-14に隔週/毎月1・15日から変更）。run-if-due.mjsに曜日指定オプションは
  // 無い（scripts/run-if-due.mjsは編集対象外）ため、runWatchdog()のisSunday判定と同じ方針で
  // 曜日制約はここ（JS側）で持つ。タスクスケジューラ側のトリガも毎週月曜08:30単発に変更済み
  // （scripts/windows/register-tasks.ps1参照）だが、StartWhenAvailableによる遅延キャッチアップが
  // 月曜以外にずれ込む可能性への保険として、ここでも月曜以外は静かにスキップする
  // （＝月曜を逃したら次の月曜まで待つ。旧--monthly-daysと同じ「対象日以外は待つ」思想を踏襲）。
  if (new Date().getDay() !== 1) return; // 1 = Monday
  const due = runNode("scripts/run-if-due.mjs", ["--state", ".last-tuneup-run.txt", "--daily-at", "8", "--minute", "30"]);
  if (due.status !== 0) return;

  if (!(await acquireLock(45 * 60 * 1000))) {
    log(`ロック取得タイムアウト: ${unixDateString()}`);
    return;
  }
  try {
    log(`===== Tuneup start: ${unixDateString()} =====`);
    // biweekly-tuneup.mjs自体が全パス（成功/スキップ/失敗）でREPORT_PATHへ本文を書くため、
    // ここではその内容をnotify-line --text-fileで中継するだけでよい（--result errorは使わない。
    // これは他3ジョブと異なる点＝tuneupのplistのみnotify-lineに--resultを渡していない）。
    const reportArgs = ["--text-file", path.join(os.tmpdir(), "researchman-tuneup-report.txt")];
    const tuneup = runNode("scripts/biweekly-tuneup.mjs");
    if (tuneup.status === 0) {
      runGit(["add", "data/research-tuning.json", "data/idea-tuning.json", "data/x-radar-queries.json", "RESEARCH_PLAN.md"]);
      if (gitDiffCachedIsEmpty()) {
        log(`変更なし（分析結果は現状維持 or スキップ）: ${unixDateString()}`);
        runNode("scripts/notify-line.mjs", reportArgs);
      } else {
        runGit(["commit", "-m", `chore: biweekly research tuning ${todayYmd()}`]);
        const push = runGit(["push"]);
        if (push.status === 0) {
          const verify = runNode("scripts/verify-deploy.mjs", ["--skip-pages"]);
          if (verify.status === 0) log(`反映まで確認OK: ${unixDateString()}`);
          else log(`push成功だが反映未確認（時間切れ）: ${unixDateString()}`);
          runNode("scripts/notify-line.mjs", reportArgs);
        } else {
          log(`push失敗（pre-push監査で中止の可能性）。コミットはローカル残存。要手動対応: ${unixDateString()}`);
          runNode("scripts/notify-line.mjs", reportArgs);
        }
      }
    } else {
      log(`チューンアップエラー終了: ${unixDateString()}`);
      runNode("scripts/run-if-due.mjs", ["--state", ".last-tuneup-run.txt", "--mark"]);
      runNode("scripts/notify-line.mjs", reportArgs);
    }
    log(`Tuneup completed: ${unixDateString()}`);
  } finally {
    releaseLock();
  }
}

async function runWatchdog() {
  // AM/PMの2段ゲートを共有state( .last-watchdog-run.txt )で判定する
  // （launchd/com.researchman.watchdog.plistと同じロジック）。
  const stateArgs = ["--state", ".last-watchdog-run.txt"];
  const amDue = runNode("scripts/run-if-due.mjs", [...stateArgs, "--daily-at", "12", "--minute", "30"]);
  const AMDUE = amDue.status === 0;
  let PMDUE = false;
  if (!AMDUE) {
    const pmDue = runNode("scripts/run-if-due.mjs", [...stateArgs, "--daily-at", "18", "--minute", "30"]);
    PMDUE = pmDue.status === 0;
  }
  if (!AMDUE && !PMDUE) return;

  // 日曜PM枠のみ--deep（`date +%u`=7相当。JSのgetDay()は日曜=0）
  const isSunday = new Date().getDay() === 0;
  const DEEP = PMDUE && isSunday;
  const slot = AMDUE ? "AM" : "PM";
  const suffix = DEEP ? " +deep" : "";
  log(`===== Watchdog start (${slot}${suffix}): ${unixDateString()} =====`);
  // watchdog.mjs内部が必要な瞬間だけ短くロックを握る設計のため、ここではロックを取得しない
  const wd = runNode("scripts/watchdog.mjs", DEEP ? ["--deep"] : []);
  if (wd.status !== 0) log(`watchdogエラー終了: ${unixDateString()}`);
  log(`Watchdog completed: ${unixDateString()}`);
}

// ── main ────────────────────────────────────────────────────
// ブランチガード: 作業ツリーがmain以外なら収集処理を一切実行せず即座に失敗させる。
// 2026-07-19、作業ツリーが別ブランチ（mcp-oauth-spike）のまま放置され、日次収集がmain以外に
// コミットされる事故が実際に起きたための再発防止（ジョブ冒頭での検査で即座に失敗させる方針。
// 事故時の状態を単純にするため、途中まで実行してから中断する設計にはしない）。
function assertOnMainBranchOrExit() {
  let raw;
  try {
    raw = execFileSync(GIT_BIN, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
  } catch (e) {
    const msg = `❌ ブランチ判定に失敗しました（git rev-parse エラー）: ${e.message}`;
    log(msg);
    console.error(msg);
    try {
      fs.closeSync(logFd);
    } catch {}
    process.exit(1);
  }
  const branch = parseCurrentBranch(raw);
  if (!isMainBranch(branch)) {
    const msg = `❌ 作業ツリーがmainブランチではありません（現在: ${branch || "(不明)"}）。収集処理を中止します。`;
    log(msg);
    console.error(msg);
    try {
      fs.closeSync(logFd);
    } catch {}
    process.exit(1);
  }
}

async function main() {
  try {
    assertOnMainBranchOrExit();
    switch (JOB) {
      case "autoresearch":
        await runAutoresearch();
        break;
      case "techresearch":
        await runTechresearch();
        break;
      case "ideaseeds":
        await runIdeaseeds();
        break;
      case "tuneup":
        await runTuneup();
        break;
      case "watchdog":
        await runWatchdog();
        break;
    }
  } catch (e) {
    // run-job.mjs自体の予期しない例外（サブスクリプトの異常ではなく、このランナー自体の
    // バグ・環境不備等）。ログへ残してからプロセスを終了する（launchd時代のStandardErrorPath
    // 相当。Windowsタスクスケジューラは既定でstderrを保存しないため、ここで確実にログへ落とす）。
    try {
      log(`❌ run-job.mjs自体がエラー終了: ${e.stack || e.message}`);
    } catch {}
    console.error(e);
    try {
      fs.closeSync(logFd);
    } catch {}
    process.exit(1);
  }
  try {
    fs.closeSync(logFd);
  } catch {}
  process.exit(0);
}

main();
