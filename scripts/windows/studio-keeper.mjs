/**
 * scripts/windows/studio-keeper.mjs
 *
 * Studioサーバ（LINEボットの実体、`npm run studio` = tsx watch server/index.ts、port 5178）の
 * 15分毎の死活監視・自動復旧。ResearchMan-studiokeeper タスク（register-studio-keeper.ps1）から
 * 15分毎に起動される。
 *
 * 背景（2026-07-17〜21の実インシデント）: Studioが無言で死んでいても、ログオン時起動タスク
 * （ResearchMan-Studio、AtLogOnトリガーのみ）は再起動されず、既存watchdog（scripts/watchdog.mjs、
 * 1日2回）にはStudio死活監視が無いためLINEボットが無応答のまま気づかれなかった。
 *
 * 死活判定: GET http://127.0.0.1:5178/api/jobs（timeout 5秒）を最大3回・10秒間隔で試し、
 * 1回でも200が返れば生存として何も出力せずexit 0（ジョブ実行中の一過性負荷での1回の
 * 失敗だけで誤killしないため）。3回とも失敗した場合のみ (1) schtasks /end + Studioプロセスツリー
 * （LISTEN PIDの親連鎖ルート等）を taskkill /F /T してハング状態を解消
 * （`taskkill /IM node.exe` は本番ジョブ巻き込み事故の実績があるため絶対に使わない）→
 * (2) `schtasks /run /tn ResearchMan-Studio` で再起動 → (3) 最大90秒ポーリングして復旧確認 →
 * (4) logs/incidents.json へ記録 → (5) LINEへ通知、の順で自己回復を試みる。
 *
 * 純粋ロジック（PID抽出・インシデント追記・ログローテ判定）は scripts/lib/studio-keeper-core.mjs
 * に切り出しnode:testで単体テスト済み（scripts/lib/studio-keeper-core.test.mjs）。
 *
 * 使い方: node scripts/windows/studio-keeper.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  parseListeningPids,
  findStudioKillRoots,
  appendIncident,
  shouldRotate,
  toJstIsoString,
  retryCheckAlive,
  buildIncidentsFileContent,
  writeJsonAtomicSync,
} from "../lib/studio-keeper-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

const PORT = 5178;
const JOBS_URL = `http://127.0.0.1:${PORT}/api/jobs`;
const TASK_NAME = "ResearchMan-Studio";
const LOG_PATH = path.join(ROOT, "logs", "studio.log");
const LOG_ROTATE_LIMIT_BYTES = 10 * 1024 * 1024; // 10MB
const INCIDENTS_PATH = path.join(ROOT, "logs", "incidents.json");
const FETCH_TIMEOUT_MS = 5000;
const CHECK_ALIVE_RETRY_COUNT = 3;
const CHECK_ALIVE_RETRY_INTERVAL_MS = 10 * 1000;
const RECOVERY_POLL_TIMEOUT_MS = 90 * 1000;
const RECOVERY_POLL_INTERVAL_MS = 5000;
const TASK_STOP_WAIT_MS = 15 * 1000;

function log(msg) {
  console.log(`[studio-keeper] ${msg}`);
}

// register-studio-autostart.ps1 が `>> logs\studio.log 2>&1` でリダイレクトする常駐サーバの
// 出力ログ。tsx watch は再起動のたびに追記され続けるため、keeperの起動時（15分毎）に
// サイズを確認し10MB超なら1世代だけ.oldへ置換ローテートする。
function rotateStudioLogIfNeeded() {
  let size;
  try {
    size = fs.statSync(LOG_PATH).size;
  } catch {
    return; // ログがまだ無ければ何もしない
  }
  if (!shouldRotate(size, LOG_ROTATE_LIMIT_BYTES)) return;
  const rotated = `${LOG_PATH}.old`;
  try {
    fs.rmSync(rotated, { force: true });
    fs.renameSync(LOG_PATH, rotated);
    log(`ログローテート: ${LOG_PATH} → ${rotated}（${size}バイト）`);
  } catch (e) {
    log(`ログローテート失敗（続行）: ${e.message}`);
  }
}

function checkAlive(timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(JOBS_URL, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function getListeningPids() {
  const r = spawnSync("netstat", ["-ano"], { encoding: "utf-8", timeout: 15000 });
  return parseListeningPids(r.stdout || "", PORT);
}

// Studioのプロセスツリー全体を落とす（taskkill /IM node.exe は使わない。他の本番node.exe
// プロセス（日次収集ジョブ等）を巻き込む事故の実績があるため、PID指定のみ）。
// leafだけkillすると親cmd/npm/tsx watchが残りタスクがRunningのままIgnoreNewで再起動が
// 無視される（2026-10-05実インシデント）ため、ルートを /T で木ごとkillする。
function endStudioTask() {
  const r = spawnSync("schtasks", ["/end", "/tn", TASK_NAME], { encoding: "utf-8", timeout: 15000 });
  return r.status === 0;
}

// 取得失敗・空・JSON不正のときは null（「ルート無し」と区別してログ/インシデントに残すため）。
function getProcessSnapshot() {
  const cmd =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], {
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const parsed = JSON.parse(r.stdout || "");
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.length ? list : null;
  } catch {
    return null;
  }
}

function isStudioTaskRunning() {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-ScheduledTask -TaskName '${TASK_NAME}').State`],
    { encoding: "utf-8", timeout: 15000 },
  );
  return /Running/i.test(r.stdout || "");
}

// schtasks /end 後、タスクがRunningでなくなるまで待つ（Running中の /run はIgnoreNewで無視されるため）。
async function waitTaskNotRunning(timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!isStudioTaskRunning()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function killTree(pid) {
  const r = spawnSync("taskkill", ["/F", "/T", "/PID", pid], { encoding: "utf-8", timeout: 15000 });
  return r.status === 0;
}

function restartStudioTask() {
  const r = spawnSync("schtasks", ["/run", "/tn", TASK_NAME], { encoding: "utf-8", timeout: 15000 });
  return r.status === 0;
}

async function pollUntilAlive(timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await checkAlive(FETCH_TIMEOUT_MS)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function readIncidents() {
  try {
    const parsed = JSON.parse(fs.readFileSync(INCIDENTS_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIncidents(incidents) {
  fs.mkdirSync(path.dirname(INCIDENTS_PATH), { recursive: true });
  writeJsonAtomicSync(INCIDENTS_PATH, buildIncidentsFileContent(incidents));
}

function notifyLine(text) {
  const tmpPath = path.join(os.tmpdir(), "researchman-studio-keeper-notify.txt");
  try {
    fs.writeFileSync(tmpPath, text);
    const r = spawnSync("node", ["scripts/notify-line.mjs", "--text-file", tmpPath], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30000,
    });
    if (r.status !== 0) log(`notify-line.mjs実行に問題（続行）: exit=${r.status}`);
  } catch (e) {
    log(`LINE通知に失敗（続行）: ${e.message}`);
  }
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function main() {
  rotateStudioLogIfNeeded();

  // ジョブ実行中の一過性負荷で1回だけcheckAliveが失敗しても即killしないよう、
  // 3回・10秒間隔で試して全滅した場合のみ復旧シーケンスへ進む。
  const alive = await retryCheckAlive(
    () => checkAlive(FETCH_TIMEOUT_MS),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    CHECK_ALIVE_RETRY_COUNT,
    CHECK_ALIVE_RETRY_INTERVAL_MS,
  );
  if (alive) {
    process.exit(0); // 生存 → 静かに終了
  }

  log(`Studio死活確認失敗を検知（${JOBS_URL}）`);
  const detailParts = [];

  const pids = getListeningPids();
  if (!pids.length) {
    log("port 5178 をLISTENしているPIDが見つかりませんでした（親プロセスだけ残っている可能性）");
    detailParts.push("port 5178 のLISTENING PIDなし");
  }

  // schtasks /end より前にスナップショットを取りルートを確定する（/end で連鎖の一部が
  // 先に消えて親子関係が失われる前の状態で判定するため）。
  const snapshot = getProcessSnapshot();
  if (!snapshot) {
    log("プロセススナップショット取得失敗（LISTEN PIDのみを対象に続行）");
    detailParts.push("プロセススナップショット取得失敗");
  }
  const roots = findStudioKillRoots(snapshot, pids, ROOT);

  const ended = endStudioTask();
  log(`schtasks /end /tn ${TASK_NAME} ${ended ? "成功" : "失敗（無視）"}`);
  detailParts.push(`schtasks /end ${ended ? "成功" : "失敗（無視）"}`);

  for (const root of roots) {
    const ok = killTree(root);
    log(`PID ${root} taskkill /F /T ${ok ? "成功" : "失敗"}`);
    detailParts.push(`ルートPID ${root} taskkill /T ${ok ? "成功" : "失敗"}`);
  }
  if (!roots.length) detailParts.push("kill対象ルートなし");

  let stopped = await waitTaskNotRunning(TASK_STOP_WAIT_MS, 1000);
  if (!stopped) {
    const endedAgain = endStudioTask();
    log(`タスクがRunningのまま → schtasks /end を再試行 ${endedAgain ? "成功" : "失敗（無視）"}`);
    detailParts.push(`schtasks /end 再試行 ${endedAgain ? "成功" : "失敗（無視）"}`);
    stopped = await waitTaskNotRunning(TASK_STOP_WAIT_MS, 1000);
  }
  log(stopped ? "タスクがRunningでなくなったことを確認" : `タスクが${TASK_STOP_WAIT_MS / 1000}秒後もRunningのまま（/run は無視される可能性）`);
  if (!stopped) detailParts.push("タスクがRunningのまま");

  const restarted = restartStudioTask();
  log(`schtasks /run /tn ${TASK_NAME} ${restarted ? "成功" : "失敗"}`);
  detailParts.push(`schtasks /run ${restarted ? "成功" : "失敗"}`);

  const recovered = await pollUntilAlive(RECOVERY_POLL_TIMEOUT_MS, RECOVERY_POLL_INTERVAL_MS);
  log(recovered ? "復旧を確認しました（/api/jobs 200）" : `${RECOVERY_POLL_TIMEOUT_MS / 1000}秒待っても復旧を確認できませんでした`);
  detailParts.push(recovered ? "復旧確認OK" : "復旧確認タイムアウト");

  const now = new Date();
  const incident = {
    at: toJstIsoString(now),
    kind: "studio-down",
    recovered,
    detail: detailParts.join(" / "),
  };
  writeIncidents(appendIncident(readIncidents(), incident));
  log(`logs/incidents.json へ記録しました: ${JSON.stringify(incident)}`);

  const text = recovered
    ? `⚠️ Studioサーバ停止を検知→自動復旧しました（${hhmm(now)}）。直前にLINEで送った依頼は失われている可能性があります`
    : `🚨 Studioサーバ停止を検知しましたが自動復旧に失敗しました（${hhmm(now)}）。手動確認が必要です。`;
  notifyLine(text);

  process.exit(recovered ? 0 : 1);
}

main().catch((e) => {
  console.error(`[studio-keeper] 予期しない例外: ${e.stack || e.message}`);
  process.exit(1);
});
