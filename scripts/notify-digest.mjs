/**
 * logs/notify-queue.jsonl に積まれた routine 通知（notify-line.mjs --priority routine が
 * 実送信の代わりに書いたもの）を1本のダイジェストにまとめてLINEへ送る。
 * Windowsタスクスケジューラから毎日23:45に実行される想定
 * （scripts/windows/register-digest-task.ps1）。
 *
 * 設計方針: 他の通知スクリプトと同じく「おまけ」。設定不備・quota超過・送信失敗でも
 *   常に exit 0（ログのみ）。ジョブ本体・スケジュールタスクを失敗扱いにしない。
 *
 * 使い方: node scripts/notify-digest.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseQueueLines, buildDigestText } from "./lib/notify-digest-core.mjs";
import { loadLineConfig } from "./lib/notify-line-config.mjs";
import { sendLineMessages } from "./lib/notify-line-send.mjs";
import { fetchQuotaUsage, shouldSkipForQuota } from "./lib/notify-quota-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, ".."); // scripts -> repo root
const QUEUE_PATH = path.join(ROOT, "logs", "notify-queue.jsonl");

function log(msg) {
  console.log(`[notify-digest] ${msg}`);
}

// `date '+%Y-%m-%d'`相当（ローカル時刻基準）
function todayYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  let before;
  try {
    before = fs.readFileSync(QUEUE_PATH, "utf8");
  } catch {
    log(`queueファイルなし（${QUEUE_PATH}）→ 何もせず終了`);
    return;
  }

  const entries = parseQueueLines(before);
  if (entries.length === 0) {
    log("queueが空 → 何もせず終了");
    return;
  }

  const digestText = buildDigestText(entries, todayYmd());
  if (!digestText) {
    log("ダイジェスト本文が空 → 何もせず終了");
    return;
  }

  const cfg = loadLineConfig(log);
  if (!cfg) return; // 未設定なら静かにスキップ（notify-line.mjsと同じ流儀）

  const totalUsage = await fetchQuotaUsage(cfg.channelAccessToken);
  if (shouldSkipForQuota(totalUsage, "routine")) {
    log(`quota超過（totalUsage=${totalUsage}）→ 今回の送信をスキップ（queueは残す）`);
    return;
  }

  const mode = cfg.to ? `push(userId=${cfg.to})` : "broadcast(全友だち)";
  const r = await sendLineMessages(cfg, digestText);
  if (r.status !== 200) {
    log(`送信失敗（status=${r.status} ${r.body}）— queueには触れず、次回に持ち越す`);
    return;
  }
  log(`送信OK → ${mode}`);

  // 送信成功時のみqueueをクリアする。ただし送信開始前に読んだスナップショット(before)と
  // 現在のqueueを比較し、送信完了後に新規追記された分（beforeより後ろに増えた部分）は残す
  // （tmp→renameのアトミック置換で、送信中の新規追記を失わない）。
  let after;
  try {
    after = fs.readFileSync(QUEUE_PATH, "utf8");
  } catch {
    after = "";
  }
  const remainder = after.startsWith(before) ? after.slice(before.length) : after;
  const tmpPath = `${QUEUE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, remainder);
  fs.renameSync(tmpPath, QUEUE_PATH);
  log(`queueをクリア（残存${remainder.length}字分は次回に持ち越し）`);
}

main().finally(() => process.exit(0));
