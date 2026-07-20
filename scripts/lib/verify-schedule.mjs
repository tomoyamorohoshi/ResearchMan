/**
 * 事故後の段階的検証（+1/+3/+7日）のスケジュール判定（scripts/watchdog.mjs 用）。
 *
 * logs/incidents.json（studio-keeper.mjsが studio-down インシデントを追記する配列）の
 * 最新エントリの日付（JST暦日）から、今日がちょうど+1日・+3日・+7日のいずれかであれば
 * 「深い検証」を実行する対象日と判定する。事故後の検証は「動いている」という報告自体が
 * 目的のため、成功でも失敗でもLINE通知する（呼び出し側=watchdog.mjsの責務）。
 *
 * 日付比較は scripts/lib/jst-date.mjs の jstDateString と同じ「UTCエポックに9時間分足して
 * toISOStringで切り出す」方式を使うため、実行環境のプロセスタイムゾーン設定に依存しない。
 */
import fs from "fs";
import { jstDateString } from "./jst-date.mjs";

// incidents配列から at が最も新しいエントリを返す（配列の並び順には依存しない。
// studio-keeper.mjs は末尾に追記するが、将来手動編集で順序が崩れても安全なように
// 常に at を比較して選ぶ）。空・不正な配列は null。
export function latestIncident(incidents) {
  if (!Array.isArray(incidents) || incidents.length === 0) return null;
  let latest = null;
  let latestMs = -Infinity;
  for (const inc of incidents) {
    const ms = new Date(inc?.at).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = inc;
    }
  }
  return latest;
}

function ymdToUtcDayIndex(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000;
}

const DUE_OFFSETS_DAYS = [1, 3, 7];

// 最新インシデントの日付（JST暦日）から todayJstYmd までの経過日数が
// 1・3・7日のいずれかに一致すれば true。
export function dueVerification(incidents, todayJstYmd) {
  const latest = latestIncident(incidents);
  if (!latest || !latest.at) return false;
  const incidentDate = new Date(latest.at);
  if (Number.isNaN(incidentDate.getTime())) return false;
  const incidentYmd = jstDateString(incidentDate);
  const diffDays = ymdToUtcDayIndex(todayJstYmd) - ymdToUtcDayIndex(incidentYmd);
  return DUE_OFFSETS_DAYS.includes(diffDays);
}

// logs/incidents.json を安全に読む（無ければ空配列。例外を投げない。log-health.mjsの
// readLogSafe と同じ方針）。
export function readIncidentsSafe(incidentsPath) {
  try {
    const raw = fs.readFileSync(incidentsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
