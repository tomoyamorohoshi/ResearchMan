/**
 * 更新完了メール通知。反映確認（verify-deploy）成功後に呼ばれ、
 * 「今回追加された事例」を件名・本文にまとめて Gmail SMTP で送る。
 *
 * 認証情報はリポジトリに置かない。ホーム直下の ~/.researchman-mail.json を読む:
 *   { "user": "xxx@gmail.com", "appPassword": "abcd efgh ijkl mnop", "to": "you@example.com" }
 *   appPassword は Google アカウント → セキュリティ → アプリパスワード で発行した16桁。
 *
 * 追加事例は auto-research-cc.mjs が書く /tmp/researchman-last-add.json を読む。
 *
 * 設計方針: 通知はパイプラインの「おまけ」。設定不備やSMTP失敗でも
 *   本体（収集・反映）を巻き込まないよう、常に exit 0 で終える（ログのみ残す）。
 *
 * 使い方:
 *   node scripts/send-mail.mjs            # 実送信
 *   node scripts/send-mail.mjs --dry-run  # 送信せず本文をプリント
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import nodemailer from "nodemailer";

const DRY_RUN = process.argv.includes("--dry-run");
const CONFIG_PATH = path.join(os.homedir(), ".researchman-mail.json");
const LAST_ADD_PATH = "/tmp/researchman-last-add.json";
const SITE = "https://research-man.vercel.app";

function log(msg) {
  console.log(`[send-mail] ${msg}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log(`設定ファイルなし（${CONFIG_PATH}）→ 通知スキップ`);
    return null;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!cfg.user || !cfg.appPassword || !cfg.to) {
      log("設定に user/appPassword/to が不足 → 通知スキップ");
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

function gitInfo() {
  try {
    const head = execSync("git rev-parse HEAD", { cwd: path.join(process.cwd()) })
      .toString().trim();
    let remote = "";
    try {
      remote = execSync("git remote get-url origin").toString().trim()
        .replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
    } catch {}
    const commitUrl = remote ? `${remote}/commit/${head}` : "";
    return { head: head.slice(0, 8), commitUrl };
  } catch {
    return { head: "unknown", commitUrl: "" };
  }
}

function buildMail(summary, git) {
  const n = summary.count || 0;
  const subject = `ResearchMan: ${n}件追加・本番反映OK`;
  const lines = [];
  lines.push(`ResearchMan に新しい事例 ${n} 件を追加し、本番ページへの反映を確認しました。`);
  lines.push("");
  lines.push("■ 追加事例");
  if (n > 0) {
    for (const c of summary.cases) {
      lines.push(`  ・${c.title}（${c.year}）  ${SITE}/cases/${c.id}`);
    }
  } else {
    lines.push("  （詳細情報なし）");
  }
  lines.push("");
  lines.push(`■ サイト: ${SITE}/`);
  lines.push(`■ コミット: ${git.head}${git.commitUrl ? "  " + git.commitUrl : ""}`);
  lines.push("");
  lines.push("— ResearchMan 自動収集パイプライン");
  return { subject, text: lines.join("\n") };
}

async function main() {
  const summary = loadSummary();
  const git = gitInfo();
  const { subject, text } = buildMail(summary, git);

  if (DRY_RUN) {
    log("--dry-run（送信しません）");
    console.log("--- Subject ---\n" + subject);
    console.log("--- Body ---\n" + text);
    return;
  }

  const cfg = loadConfig();
  if (!cfg) return; // 未設定なら静かにスキップ

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: cfg.user, pass: cfg.appPassword.replace(/\s+/g, "") },
  });

  try {
    const info = await transporter.sendMail({
      from: `ResearchMan <${cfg.user}>`,
      to: cfg.to,
      subject,
      text,
    });
    log(`送信OK → ${cfg.to}（id=${info.messageId}）`);
  } catch (e) {
    log(`送信失敗（${e.message}）— 本体処理には影響なし`);
  }
}

main().finally(() => process.exit(0));
