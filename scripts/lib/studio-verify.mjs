/**
 * 事故後の段階的検証（scripts/watchdog.mjs から呼ばれる「深い検証」の中身）。
 *
 * インシデント後 +1/+3/+7日（判定は scripts/lib/verify-schedule.mjs::dueVerification）に、
 * Studioサーバ周りが実際に生きているかを3点チェックする:
 *   (a) GET http://127.0.0.1:5178/api/jobs が200
 *   (b) POST https://<funnel>/line-webhook（空JSON）が401（署名検査に到達している証拠）
 *   (c) ResearchMan-Studio / ResearchMan-studiokeeper タスクが存在し無効化されていない
 *
 * 成功でも失敗でもLINE通知する（事故後の検証は「動いている」報告自体が目的のため、
 * OPERATIONS.md「自己回復ウォッチドッグ」の静粛性ポリシーの例外）。呼び出し側
 * （watchdog.mjs）が report 配列へ本関数の reportText を無条件でpushすることで実現する。
 *
 * 判定ロジック（classifyHttpCheck / parseTaskQueryResult / buildDeepVerificationReport）は
 * 純関数として切り出し fixture でテストする。runDeepVerification() 自体は実HTTP通信・
 * 実CLI呼び出しを含むためテスト対象外（OPERATIONS.md §4と同じ方針）。
 */
import { spawnSync } from "child_process";

// HTTPステータスの合否判定（fetch失敗・タイムアウトはstatus=0として渡される想定）。
export function classifyHttpCheck(label, status, expectedStatus) {
  return { label, status, expected: expectedStatus, ok: status === expectedStatus };
}

// PowerShellの `Get-ScheduledTask -TaskName <name>` の `.State.ToString()` 出力
// （Ready/Disabled/Running/Queued/Unknownというカルチャ非依存のenum文字列。タスク未登録時は
// 呼び出し側がセンチネル文字列 "NOT_FOUND" を渡す）からタスクの存在・有効性を判定する。
//
// 実機検証で判明: 当初は `schtasks /query /tn <name> /fo LIST /v` のテキスト出力を
// 英語ラベル固定の正規表現でパースしていたが、日本語ロケールWindows上で
// `spawnSync("schtasks", [...], {encoding:"utf-8"})` を呼ぶとschtasksがOEMコードページ
// (cp932)で出す項目名をNodeがUTF-8として強制デコードし文字化けし、実際は有効なタスクでも
// 「無効」と誤判定していた（本番環境で実測）。PowerShellの型付きオブジェクトのState
// プロパティはロケールに関わらず固定の英語enum名を返すためこの問題が起きない。
export function classifyTaskState(taskName, stateText) {
  const t = (stateText || "").trim();
  if (!t || t === "NOT_FOUND") return { name: taskName, exists: false, enabled: false, ok: false };
  const enabled = t !== "Disabled";
  return { name: taskName, exists: true, enabled, ok: enabled };
}

// 3点チェックの結果（{label, ok}の配列）からLINE通知本文を組み立てる。
export function buildDeepVerificationReport(checks) {
  const allOk = checks.every((c) => c.ok);
  const lines = ["🔎 事故後の段階的検証（+1/+3/+7日）", ""];
  for (const c of checks) {
    lines.push(`${c.ok ? "✅" : "❌"} ${c.label}`);
  }
  lines.push("");
  lines.push(allOk ? "すべて正常です。" : "異常があります。手動確認をお願いします。");
  return lines.join("\n");
}

// url にtimeoutMs付きでリクエストし、HTTPステータスを返す。接続失敗・タイムアウトは0。
async function httpStatus(url, { method = "GET", body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// Get-ScheduledTaskで問い合わせる（schtasksのテキスト出力パースはロケール依存で壊れるため
// 使わない。classifyTaskStateのコメント参照）。タスク名はシングルクォートで囲むため'を''に
// エスケープする（このプロジェクトのタスク名はResearchMan-*固定で'を含まないが念のため）。
function queryTask(taskName) {
  const escaped = taskName.replace(/'/g, "''");
  const psCommand = `$t = Get-ScheduledTask -TaskName '${escaped}' -ErrorAction SilentlyContinue; if ($t) { $t.State.ToString() } else { 'NOT_FOUND' }`;
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
    encoding: "utf-8",
    timeout: 15000,
  });
  return classifyTaskState(taskName, r.stdout);
}

// 3点チェックを実行し、判定結果とLINE通知本文をまとめて返す。
export async function runDeepVerification({ jobsUrl, webhookUrl, taskNames }) {
  const jobsStatus = await httpStatus(jobsUrl, { method: "GET" });
  const webhookStatus = await httpStatus(webhookUrl, { method: "POST", body: "{}" });
  const taskResults = (taskNames || []).map(queryTask);

  const checks = [
    classifyHttpCheck(`GET ${jobsUrl}`, jobsStatus, 200),
    classifyHttpCheck(`POST ${webhookUrl}`, webhookStatus, 401),
    ...taskResults.map((t) => ({
      label: `タスク ${t.name}: ${t.exists ? (t.enabled ? "有効" : "登録済みだが無効") : "未登録"}`,
      ok: t.ok,
    })),
  ];

  return {
    checks,
    allOk: checks.every((c) => c.ok),
    reportText: buildDeepVerificationReport(checks),
  };
}
