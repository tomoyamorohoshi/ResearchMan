// 通知の振り分け（2026-10-20仕様変更）。
//   share  = LINEに送る: 日次収集の新規追加紹介 / アイデアの種配信 / ユーザーがLINEから依頼した処理への返信
//   system = LINEに送らず logs/system-alerts.jsonl に記録: それ以外すべて（エラー・0件・点検・自動修復等）
// 既定は system（安全側）。share は呼び出し側が --kind share を明示した経路だけで、さらに
// 「ok かつ新規1件以上」または「--text-file（アイデアの種）」でなければ system に落とす
// （share を付けた呼び出しでも error/pushfail/unverified/0件は LINE に出さないため）。
// context=studio（Studio発＝ユーザー自身の依頼への返信）は常に share。
import { appendSystemAlert } from "./system-alerts.mjs";

/**
 * @param {{kind?:string, result?:string, count?:number, context?:string, hasTextFile?:boolean}} p
 * @returns {"share"|"system"}
 */
export function resolveNotifyKind({ kind, result = "ok", count = 0, context = "daily", hasTextFile = false }) {
  if (context === "studio") return "share";
  if (kind !== "share") return "system";
  // unverified（push済み・反映確認だけ時間切れ）でも事例の紹介は届ける。error/pushfail は未公開なので system
  if (result !== "ok" && result !== "unverified") return "system";
  if (hasTextFile) return "share";
  return count > 0 ? "share" : "system";
}

function firstLine(text) {
  const i = text.indexOf("\n");
  return (i === -1 ? text : text.slice(0, i)).trim();
}

/** system 記録の level / title / source を決める。 */
export function deriveAlertMeta({ result = "ok", level, title, source, label, route, text = "" }) {
  const derivedLevel = result === "error" || result === "pushfail" ? "error" : result === "unverified" ? "warn" : "info";
  return {
    level: level || derivedLevel,
    title: title || firstLine(text) || "(no title)",
    source: source || `notify-line:${label || route || "general"}`,
  };
}

/**
 * @param {{kind?:string, result?:string, count?:number, context?:string, hasTextFile?:boolean,
 *          text:string, level?:string, title?:string, source?:string, label?:string, route?:string}} n
 * @param {{send:(text:string)=>Promise<any>, logsDir?:string, now?:Date, dryRun?:boolean}} deps
 */
export async function dispatchNotification(n, { send, logsDir, now, dryRun = false }) {
  const route = resolveNotifyKind(n);
  if (route === "share") {
    if (dryRun) return { route, sent: false };
    const result = await send(n.text);
    // 反映未確認という事実は system 側にも別途1件残す
    if (n.result === "unverified") {
      const meta = deriveAlertMeta({ ...n, title: `反映未確認: ${n.label || n.route || "収集"}（push済み・時間切れ）`, level: "warn" });
      appendSystemAlert({ ...meta, body: n.text }, { logsDir, now });
    }
    return { route, sent: true, result };
  }
  const meta = deriveAlertMeta(n);
  if (dryRun) return { route, recorded: false, ...meta };
  const entry = appendSystemAlert({ ...meta, body: n.text }, { logsDir, now });
  return { route, recorded: true, entry };
}
