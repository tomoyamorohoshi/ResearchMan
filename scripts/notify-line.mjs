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
 * 追加事例は auto-research-cc.mjs が書く /tmp/researchman-last-add.json を読む。
 *
 * 設計方針: 通知はパイプラインの「おまけ」。設定不備や送信失敗でも
 *   本体（収集・反映）を巻き込まないよう常に exit 0（ログのみ）。
 *
 * 使い方:
 *   node scripts/notify-line.mjs            # 実送信
 *   node scripts/notify-line.mjs --dry-run  # 送信せず本文をプリント
 */
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { execSync } from "child_process";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIG_PATH = path.join(os.homedir(), ".researchman-line.json");
// Technology日次収集からも流用できるよう、サマリーの場所・リンク経路・ラベルを引数で差し替え可能。
// 無引数なら従来どおりCase Study用（後方互換）。
//   例: node scripts/notify-line.mjs --summary /tmp/researchman-tech-last-add.json --route technology --label Technology
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LAST_ADD_PATH = argOf("--summary", "/tmp/researchman-last-add.json");
const ROUTE = argOf("--route", "cases");
const LABEL = argOf("--label", "");
// 実行結果の種別。パイプラインの全終端経路で正確な文面を送るため
//   ok         … 追加あり反映確認済み / 追加0件（既定）
//   unverified … push済みだが反映確認が時間切れ（数分後に反映される見込み）
//   pushfail   … pre-push監査等でpush失敗（要手動対応）
//   error      … 収集スクリプトがエラー終了（ログ確認要）
const RESULT = argOf("--result", "ok");
const SITE = "https://research-man.vercel.app";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast";

function log(msg) {
  console.log(`[notify-line] ${msg}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log(`設定ファイルなし（${CONFIG_PATH}）→ 通知スキップ`);
    return null;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!cfg.channelAccessToken) {
      log("設定に channelAccessToken が不足 → 通知スキップ");
      return null;
    }
    return cfg;
  } catch (e) {
    log(`設定読込失敗（${e.message}）→ 通知スキップ`);
    return null;
  }
}

// サマリーが古い（=今回の実行が書いたものでない）場合は0件として扱う。
// 収集スクリプトがクラッシュした回に、前回の追加分を「新規」として再通知する事故を防ぐ
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
    lines.push("本日分はスキップし、明日10時に再実行します。");
    lines.push("ログ: ~/Library/Logs/researchman-*.log");
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

// LINE の1メッセージは5,000字上限・1リクエストで最大5メッセージ。
// ref付きアイデアの種は数千字になりうるため、空行（種の境界）で分割する。
const LINE_MSG_LIMIT = 4800;
const LINE_MAX_MESSAGES = 5;

function splitForLine(text) {
  if (text.length <= LINE_MSG_LIMIT) return [text];
  // 空行区切りブロック（見出し＋各種）を、上限内で貪欲に結合する
  const blocks = text.split(/\n\n+/);
  const messages = [];
  let cur = "";
  for (const b of blocks) {
    const piece = cur ? `${cur}\n\n${b}` : b;
    if (piece.length > LINE_MSG_LIMIT && cur) {
      messages.push(cur);
      cur = b;
    } else {
      cur = piece;
    }
  }
  if (cur) messages.push(cur);
  // 最大5メッセージに収める（超過分は末尾メッセージへ結合。上限超過は稀）
  if (messages.length > LINE_MAX_MESSAGES) {
    const head = messages.slice(0, LINE_MAX_MESSAGES - 1);
    const tail = messages.slice(LINE_MAX_MESSAGES - 1).join("\n\n").slice(0, LINE_MSG_LIMIT);
    return [...head, tail];
  }
  return messages;
}

function sendMessage(cfg, text) {
  // to があれば push（特定userId宛）、無ければ broadcast（全友だち宛）
  const url = cfg.to ? PUSH_URL : BROADCAST_URL;
  const texts = splitForLine(text);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const messages = texts.map((t) => ({ type: "text", text: t }));
    const payload = cfg.to ? { to: cfg.to, messages } : { messages };
    const body = JSON.stringify(payload);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${cfg.channelAccessToken}`,
        },
      },
      (res) => {
        const chunks = [];
        const finish = () => settle({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
        res.on("data", (d) => chunks.push(d));
        res.on("end", finish);
        // 本文受信中に接続が切れてもPromiseを必ず解決する（未解決awaitでプロセスが静かに死ぬのを防ぐ）
        res.on("close", finish);
        res.on("error", finish);
      }
    );
    req.on("error", (e) => settle({ status: 0, body: e.message }));
    req.setTimeout(15000, () => { settle({ status: 0, body: "timeout" }); req.destroy(); });
    req.write(body);
    req.end();
  });
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

  const cfg = loadConfig();
  if (!cfg) return; // 未設定なら静かにスキップ

  const mode = cfg.to ? `push(userId=${cfg.to})` : "broadcast(全友だち)";
  const r = await sendMessage(cfg, text);
  if (r.status === 200) {
    log(`送信OK → ${mode}`);
  } else {
    log(`送信失敗（status=${r.status} ${r.body}）— 本体処理には影響なし`);
  }
}

main().finally(() => process.exit(0));
