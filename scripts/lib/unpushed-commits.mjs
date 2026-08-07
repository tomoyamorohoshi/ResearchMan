/**
 * 未pushコミット滞留の検知（scripts/watchdog.mjs 用）。
 *
 * 2026-07-31、日次ジョブがサムネイル不良をcommitし、.git/hooks/pre-push が実行する
 * node scripts/audit-tech.mjs が失敗し続け、以降8日間すべてのpushがブロックされた。
 * ジョブ自体はcommitまでは成功し続けたため未pushコミットが11個滞留した。
 * 既存watchdog（サイトの200応答のみ確認）は「古い内容配信中」を正常と誤判定し続けて
 * 気づけなかった。ここでは「未pushコミットの滞留」自体を検知対象とし、
 *   1. pre-pushと同じ4監査をローカルで順に実行し、最初に落ちたものを特定する
 *   2. 全通過ならpushを1回だけ再試行する（=push詰まりからの自動復旧）
 *   3. 監査失敗時はpushせず、logs/incidents.json記録＋LINE通知（重複抑制つき）する
 * という副作用のないレポート組み立て・状態判定ロジックのみをここに切り出す。
 * git操作・spawnSyncの実行自体はwatchdog.mjs側（薄いオーケストレーション）で行う。
 *
 * 重複通知抑制はscripts/lib/verify-schedule.mjs（shouldRunToday/readVerifyStateSafe/
 * writeVerifyState）と同じ「例外を投げない安全な読み書き」パターンを踏襲する。
 */
import fs from "fs";

// scripts/hooks/pre-push が実行する4監査と同じ順序（このファイルの原本はpre-push側。
// 変更したら両方揃えること）。
export const AUDIT_SCRIPTS = [
  "audit-cannes.mjs",
  "audit-thumbnails.mjs",
  "audit-tech.mjs",
  "check-idea-layouts-freshness.mjs",
];

// stdout+stderrの末尾maxLines行だけを残す（レポート・incidents.jsonの肥大化防止）。
export function truncateOutput(text, maxLines = 20) {
  const lines = String(text || "").split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(lines.length - maxLines).join("\n");
}

// 監査実行結果（[{script, status, signal, error, stdout, stderr}, ...]）から、最初に
// 非0終了（またはタイムアウト等でstatus===null）したスクリプトを特定する。
// pre-pushと同じく「最初の失敗で以降は実行しない」前提のため、呼び出し側
// （watchdog.mjs）は非0/タイムアウトを見た時点でループを止めてこの配列を渡せばよい。
// signal/errorが立っている（=プロセスが正常終了しなかった）場合はtimeoutSuspected=true
// とし、「監査ロジックが壊れている」という通常の対処ヒントと区別できるようにする。
export function findFirstAuditFailure(results) {
  for (const r of results || []) {
    if (r.status !== 0) {
      return {
        allPassed: false,
        failedScript: r.script,
        excerpt: truncateOutput(`${r.stdout || ""}\n${r.stderr || ""}`.trim(), 20),
        timeoutSuspected: Boolean(r.status === null || r.signal || r.error),
      };
    }
  }
  return { allPassed: true, failedScript: null, excerpt: "" };
}

// commitIsoDate から現在（nowMs）までの経過日数（整数・切り捨て）。不正な日付はnull
// （例外を投げない。verify-schedule.mjsの各safe関数と同じ方針）。
export function staleDaysSince(commitIsoDate, nowMs = Date.now()) {
  if (!commitIsoDate) return null;
  const t = new Date(commitIsoDate).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

// 重複通知抑制のための「理由キー」。監査失敗ならどのスクリプトで落ちたかで区別し、
// 監査通過後のpush結果はpush-ok/push-failで区別する（理由が変われば再通知したいため）。
export function unpushedReasonKey({ allPassed, failedScript, pushOk }) {
  if (!allPassed) return `audit-fail:${failedScript}`;
  return pushOk ? "push-ok" : "push-fail";
}

// 前回通知記録（{lastReason, lastNotifiedYmd}）と比較し、再通知が必要かを判定する。
// 理由が変わった、または日付（JST暦日）が変わったら再通知可。同一理由・同日のみ抑制。
// ただし "push-ok"（復旧成功）は抑制対象から除外し常に通知する。watchdogは1日2回
// （12:30/18:30）走るため、同一JST日内に「滞留→復旧」が2回起きた場合に2回目が
// 無音になるのを防ぐ（監査失敗系・push-fail系は「原因が直り続けていない」状態が
// 続く限り1日1回の抑制が妥当なため、そちらは従来どおり）。
export function shouldNotifyUnpushed(prevState, reasonKey, todayYmd) {
  if (reasonKey === "push-ok") return true;
  if (!prevState || !prevState.lastReason) return true;
  if (prevState.lastReason !== reasonKey) return true;
  return prevState.lastNotifiedYmd !== todayYmd;
}

// logs/unpushed-notify-state.json を安全に読む（無ければ空オブジェクト。例外を投げない。
// verify-schedule.mjsのreadVerifyStateSafeと同じ方針）。
export function readUnpushedStateSafe(statePath) {
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// logs/unpushed-notify-state.json に前回通知した理由・通知日を書き込む（例外を投げない。
// verify-schedule.mjsのwriteVerifyStateと同じ方針）。
export function writeUnpushedState(statePath, { lastReason, lastNotifiedYmd }) {
  try {
    fs.writeFileSync(statePath, JSON.stringify({ lastReason, lastNotifiedYmd }, null, 2));
    return true;
  } catch {
    return false;
  }
}

// 4監査すべて通過した場合のレポート文言（push再試行の成否で分岐）。
export function buildUnpushedAuditPassReport({ unpushedCount, oldestCommitAt, pushResult }) {
  const header = `未pushコミットが${unpushedCount}件滞留していました（最古: ${oldestCommitAt || "不明"}）`;
  if (pushResult?.ok) {
    return ["✅ " + header, "→ 4監査すべて通過 → push成功しました（滞留は解消されています）。"].join("\n");
  }
  return [
    "🚨 " + header,
    "→ 4監査すべて通過しましたが、pushの再試行に失敗しました。",
    `理由: ${pushResult?.reason || "不明"}`,
    "手動でのpush対応が必要です（ジョブロック確認後にgit pushしてください）。",
  ].join("\n");
}

// 4監査のいずれかが失敗した場合のレポート文言（対処ヒントつき）。
// timeoutSuspected=trueの場合は「監査ロジックが壊れている」という通常の対処ヒントに加え、
// プロセスがタイムアウト等で正常終了しなかった可能性を明示する。
export function buildUnpushedAuditFailReport({ unpushedCount, oldestCommitAt, staleDays, failedScript, excerpt, timeoutSuspected }) {
  return [
    `🚨 未pushコミットが${unpushedCount}件滞留しています（最古: ${oldestCommitAt || "不明"}${staleDays != null ? `、${staleDays}日滞留` : ""}）`,
    `原因: pre-push監査 ${failedScript} が失敗しています（pushは試みていません）。`,
    excerpt ? `── ログ抜粋 ──\n${excerpt}` : "",
    `対処: ローカルで node scripts/${failedScript} を実行すれば再現します。`,
    timeoutSuspected ? "（プロセスが正常終了しませんでした。タイムアウトの可能性があります）" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// logs/incidents.json（INCIDENTS_PATH）へ1件appendする。既存配列が壊れている/存在しない
// 場合は新規配列として扱う（例外を投げない）。呼び出し側は本番パスを渡すこと
// （テストでは必ず一時ファイルを使うこと）。
export function appendIncidentSafe(incidentsPath, incident) {
  try {
    let arr = [];
    try {
      const raw = fs.readFileSync(incidentsPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      // 未存在・壊れている場合は空配列から開始
    }
    arr.push(incident);
    fs.writeFileSync(incidentsPath, JSON.stringify(arr, null, 2));
    return true;
  } catch {
    return false;
  }
}
