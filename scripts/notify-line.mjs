/**
 * LINE 更新完了通知。反映確認（verify-deploy）成功後に呼ばれ、
 * 「今回追加された事例」を LINE Messaging API の push で自分宛に送る。
 *
 * ※ LINE Notify は 2025-03-31 で終了したため Messaging API を使う。
 *
 * 認証情報はリポジトリに置かない。ホーム直下の ~/.researchman-line.json を読む:
 *   { "channelAccessToken": "長いトークン" }              // broadcast（全友だち宛。個人通知botはこれで十分）
 *   { "channelAccessToken": "長いトークン", "to": "Uxxx" } // push（特定userId宛。to があればこちらを優先）
 *   - LINE Developers でプロバイダー→Messaging APIチャネル作成 → チャネルアクセストークン(長期)発行
 *   - 公式アカウントを自分で友だち追加（broadcast は友だち全員に届く。自分1人ならその1人に届く）
 *
 * 追加事例は auto-research-cc.mjs が書く os.tmpdir()/researchman-last-add.json を読む。
 *
 * 設計方針: 通知はパイプラインの「おまけ」。設定不備や送信失敗でも
 *   本体（収集・反映）を巻き込まないよう常に exit 0（ログのみ）。
 *
 * 使い方:
 *   node scripts/notify-line.mjs            # 実送信
 *   node scripts/notify-line.mjs --dry-run  # 送信せず本文をプリント
 *
 * --priority <critical|routine>（既定 critical）: LINE無料枠（200通/月）超過対策
 *   （2026-07-18、OPERATIONS.md参照）。routineは実送信せずlogs/notify-queue.jsonlに
 *   1行追記するだけに変わる（notify-digest.mjsが23:45に1本へまとめて送る）。
 *   criticalは既存の送信ロジックのまま変更しない（quotaガードも呼ばない＝
 *   criticalはquotaに関わらず必ず送信を試みる仕様のため）。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { buildErrorBodyLines } from "./lib/notify-line-text.mjs";
import { loadLineConfig } from "./lib/notify-line-config.mjs";
import { splitForLine, sendLineMessages } from "./lib/notify-line-send.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, ".."); // scripts -> repo root
const TMP_LAST_ADD_PATH = path.join(os.tmpdir(), "researchman-last-add.json");
const QUEUE_PATH = path.join(ROOT, "logs", "notify-queue.jsonl");

const DRY_RUN = process.argv.includes("--dry-run");
// Technology日次収集からも流用できるよう、サマリーの場所・リンク経路・ラベルを引数で差し替え可能。
// 無引数なら従来どおりCase Study用（後方互換）。
//   例: node scripts/notify-line.mjs --summary <os.tmpdir()>/researchman-tech-last-add.json --route technology --label Technology
// --context daily|studio: エラー通知(--result error)の再実行案内文言の出し分け（既定daily）。
// studio/server/pipeline/audit.ts::runNotifyLine がStudio(LINE)発ジョブでは常に
// --context studio を付与する。日次ジョブ（run-job.mjs等）は無指定のまま＝挙動不変。
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LAST_ADD_PATH = argOf("--summary", TMP_LAST_ADD_PATH);
const ROUTE = argOf("--route", "cases");
const LABEL = argOf("--label", "");
// 実行結果の種別。パイプラインの全終端経路で正確な文面を送るため
//   ok         … 追加あり反映確認済み / 追加0件（既定）
//   unverified … push済みだが反映確認が時間切れ（数分後に反映される見込み）
//   pushfail   … pre-push監査等でpush失敗（要手動対応）
//   error      … 収集スクリプトがエラー終了（ログ確認要）
const RESULT = argOf("--result", "ok");
// 呼び出し元コンテキスト。"daily"（既定・run-job.mjs経由の毎朝の自動実行）と
// "studio"（Studio(LINE)発のオンデマンドジョブ。studio/server/pipeline/audit.ts::
// runNotifyLineが常に付与する）でエラー通知の再実行案内文言を出し分ける
// （lib/notify-line-text.mjs::buildErrorBodyLines参照。日次ジョブ側の呼び出し元は
// 無指定のままで従来どおりの挙動を維持する）。
const CONTEXT = argOf("--context", "daily");
// LINE無料枠（200通/月）超過対策（2026-07-18）。critical（既定・全既存呼び出し）は
// 送信ロジックを一切変えない。routineは実送信せずlogs/notify-queue.jsonlに積み、
// notify-digest.mjsが23:45にまとめて送る（OPERATIONS.md参照）。
const PRIORITY = argOf("--priority", "critical");
if (!["critical", "routine"].includes(PRIORITY)) {
  console.error(`--priority の値が不正: ${PRIORITY}（critical|routine のいずれかを指定）`);
  process.exit(2);
}
const SITE = "https://research-man.vercel.app";

function log(msg) {
  console.log(`[notify-line] ${msg}`);
}

function loadConfig() {
  return loadLineConfig(log);
}

// --route から --label 省略時のラベルを簡易マッピングで補完する（queue追記用）。
const ROUTE_LABEL_FALLBACK = { cases: "Auto research", technology: "Tech radar" };
function queueLabel() {
  if (LABEL) return LABEL;
  return ROUTE_LABEL_FALLBACK[ROUTE] || "ResearchMan";
}

function appendToQueue(text) {
  fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
  const line = `${JSON.stringify({ at: new Date().toISOString(), label: queueLabel(), text })}\n`;
  fs.appendFileSync(QUEUE_PATH, line, { flag: "a" });
  log(`priority=routine → ${QUEUE_PATH} に追記（実送信はnotify-digest.mjsに委譲）`);
}

// サマリーが古い（=今回の実行が書いたものでない）場合は0件として扱う。
// 収集スクリプトがクラッシュした回に、前回の追加分を「新規」として再通知する事故を防ぐ。
// verify-deploy.mjsのLAST_ADD_MAX_AGE_MS(2h)より緩いのは意図的: notify-lineは
// git競合ロック待ち・毎正時キャッチアップ実行による遅延分を許容する必要があるため
const SUMMARY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function loadSummary() {
  try {
    if (fs.existsSync(LAST_ADD_PATH)) {
      const st = fs.statSync(LAST_ADD_PATH);
      if (Date.now() - st.mtimeMs > SUMMARY_MAX_AGE_MS) {
        log(`サマリーが古い（${LAST_ADD_PATH}）→ 0件として通知`);
        return { count: 0, cases: [] };
      }
      return JSON.parse(fs.readFileSync(LAST_ADD_PATH, "utf8"));
    }
  } catch {}
  return { count: 0, cases: [] };
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD").toString().trim().slice(0, 8);
  } catch {
    return "unknown";
  }
}

function buildText(summary, head) {
  const n = summary.count || 0;
  const name = `ResearchMan${LABEL ? ` ${LABEL}` : ""}`;
  const lines = [];

  if (RESULT === "error") {
    lines.push(`❌ ${name}: 収集がエラー終了`);
    lines.push("");
    lines.push(...buildErrorBodyLines(CONTEXT));
  } else if (RESULT === "pushfail") {
    lines.push(`⚠️ ${name}: 収集${n > 0 ? `${n}件` : ""}完了したがpush失敗`);
    lines.push("");
    lines.push("pre-push監査で中止の可能性。コミットはローカル残存、要手動対応。");
  } else if (RESULT === "unverified") {
    lines.push(`⚠️ ${name}: ${n}件追加・push済み（反映確認は時間切れ）`);
    lines.push("");
    for (const c of summary.cases) {
      lines.push(`・${c.title}（${c.year}）`);
      lines.push(`  ${SITE}/${ROUTE}/${c.id}`);
    }
    lines.push("数分後に反映される見込み。");
  } else if (n > 0) {
    lines.push(`🔍 ${name}: ${n}件追加・本番反映OK`);
    lines.push("");
    for (const c of summary.cases) {
      lines.push(`・${c.title}（${c.year}）`);
      lines.push(`  ${SITE}/${ROUTE}/${c.id}`);
    }
  } else {
    // 0件の回はデプロイが走っていないため「反映OK」とは言わない
    lines.push(`🔍 ${name}: 本日の新規追加なし`);
    lines.push("");
    lines.push("（収集は正常実行。クライテリア適合の新着がありませんでした）");
  }
  lines.push("");
  lines.push(`${SITE}/${ROUTE === "cases" ? "" : ROUTE}  (commit ${head})`);
  return lines.join("\n");
}

async function main() {
  // --text-file <path>: サマリー整形を使わず、ファイルの中身をそのまま本文として送る
  // （アイデアの種の配信など、収集結果以外の定期メッセージに使う）
  const textFile = argOf("--text-file", null);
  let text;
  if (textFile) {
    try {
      text = fs.readFileSync(textFile, "utf8").trim();
    } catch (e) {
      log(`本文ファイル読込失敗（${e.message}）→ 送信スキップ`);
      return;
    }
    if (!text) {
      log("本文が空 → 送信スキップ");
      return;
    }
  } else {
    text = buildText(loadSummary(), gitHead());
  }

  if (DRY_RUN) {
    const parts = splitForLine(text);
    log(`--dry-run（送信しません）本文${text.length}字 → ${parts.length}メッセージに分割`);
    parts.forEach((p, i) => console.log(`--- LINE message ${i + 1}/${parts.length}（${p.length}字）---\n${p}`));
    return;
  }

  if (PRIORITY === "routine") {
    // LINE APIに一切アクセスせずqueueへ積むだけ（quotaガードはここでは呼ばない。
    // notify-digest.mjsが送信時にshouldSkipForQuotaで判断する）。
    appendToQueue(text);
    return;
  }

  // priority=critical（既定）: 既存の送信ロジックのまま変更しない。quotaに関わらず必ず送信を試みる。
  const cfg = loadConfig();
  if (!cfg) return; // 未設定なら静かにスキップ

  const mode = cfg.to ? `push(userId=${cfg.to})` : "broadcast(全友だち)";
  const r = await sendLineMessages(cfg, text);
  if (r.status === 200) {
    log(`送信OK → ${mode}`);
  } else {
    log(`送信失敗（status=${r.status} ${r.body}）— 本体処理には影響なし`);
  }
}

main().finally(() => process.exit(0));
