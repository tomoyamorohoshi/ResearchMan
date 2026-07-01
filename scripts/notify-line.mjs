/**
 * LINE 更新完了通知。反映確認（verify-deploy）成功後に呼ばれ、
 * 「今回追加された事例」を LINE Messaging API の push で自分宛に送る。
 *
 * ※ LINE Notify は 2025-03-31 で終了したため Messaging API を使う。
 *
 * 認証情報はリポジトリに置かない。ホーム直下の ~/.researchman-line.json を読む:
 *   { "channelAccessToken": "長いトークン", "to": "Uxxxxxxxx（自分のuserId）" }
 *   - LINE Developers でプロバイダー→Messaging APIチャネル作成 → チャネルアクセストークン(長期)発行
 *   - 公式アカウントを自分で友だち追加 → Webhook等で自分の userId を確認して "to" に設定
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
const LAST_ADD_PATH = "/tmp/researchman-last-add.json";
const SITE = "https://research-man.vercel.app";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";

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
    if (!cfg.channelAccessToken || !cfg.to) {
      log("設定に channelAccessToken/to が不足 → 通知スキップ");
      return null;
    }
    return cfg;
  } catch (e) {
    log(`設定読込失敗（${e.message}）→ 通知スキップ`);
    return null;
  }
}

function loadSummary() {
  try {
    if (fs.existsSync(LAST_ADD_PATH)) {
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
  const lines = [];
  lines.push(`🔍 ResearchMan: ${n}件追加・本番反映OK`);
  lines.push("");
  if (n > 0) {
    for (const c of summary.cases) {
      lines.push(`・${c.title}（${c.year}）`);
      lines.push(`  ${SITE}/cases/${c.id}`);
    }
  } else {
    lines.push("（追加事例の詳細情報なし）");
  }
  lines.push("");
  lines.push(`${SITE}/  (commit ${head})`);
  return lines.join("\n");
}

function pushMessage(cfg, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ to: cfg.to, messages: [{ type: "text", text }] });
    const req = https.request(
      PUSH_URL,
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
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
    req.write(body);
    req.end();
  });
}

async function main() {
  const summary = loadSummary();
  const text = buildText(summary, gitHead());

  if (DRY_RUN) {
    log("--dry-run（送信しません）");
    console.log("--- LINE message ---\n" + text);
    return;
  }

  const cfg = loadConfig();
  if (!cfg) return; // 未設定なら静かにスキップ

  const r = await pushMessage(cfg, text);
  if (r.status === 200) {
    log(`送信OK → userId=${cfg.to}`);
  } else {
    log(`送信失敗（status=${r.status} ${r.body}）— 本体処理には影響なし`);
  }
}

main().finally(() => process.exit(0));
