/**
 * Technology記事の抽出ファクトチェック（P4-4・ユーザー決定=抽出検査のみ）。
 * data/tech.json からランダムN件抽出し、各技術の一次ソースをWebFetchで実際に読ませ、
 * summary/point/detailの**事実誤りのみ**を報告する（文体の良し悪しは対象外）。
 * 検出はレポートのみ。tech.jsonの書き換えは行わない（人がレビューして
 * apply-tech-rewrites.mjs で個別適用する）。
 *
 * 使い方: node scripts/factcheck-tech.mjs [--n 10] [--out report.json] [--exclude id1,id2,...]
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJsonArray } from "./lib/claude-cli.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECH_PATH = path.join(__dirname, "../data/tech.json");
const FACTCHECK_TIMEOUT_MS = 240000;

const nIdx = process.argv.indexOf("--n");
const SAMPLE_SIZE = nIdx >= 0 ? parseInt(process.argv[nIdx + 1], 10) : 10;
const outIdx = process.argv.indexOf("--out");
const OUT_PATH = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const excludeIdx = process.argv.indexOf("--exclude");
const EXCLUDE_IDS = new Set(excludeIdx >= 0 ? process.argv[excludeIdx + 1].split(",") : []);

function pickPrimaryLink(links) {
  return (links || []).find((l) => ["github", "project", "product", "paper"].includes(l.kind)) || links?.[0];
}

function buildPrompt(t, primaryUrl) {
  return `Technology記事の事実確認（ファクトチェック）タスク。

技術情報:
id: ${t.id}
title: ${t.title}
org: ${t.org}
一次ソースURL: ${primaryUrl}

現在の記事文章:
summary: ${t.summary}
point: ${t.point}
detail: ${t.detail}

手順（厳守）:
1. 一次ソースURLを **WebFetch で実際に開いて読む**こと。読めなかった場合は空配列 [] を返す
2. summary/point/detail の内容を一次ソースと照合し、**事実誤りのみ**を検出する
   （対象例: 誤った数値・仕組みの説明違い・対応環境/OSの誤り・ライセンス条件の誤り・
   開発元/発表時期の誤り）。**文体の硬さ・わかりやすさ・表現の好みは対象外**（報告しない）
3. **GitHubスター数・利用者数など時間とともに変動する数値は指摘しない**（記事作成時点の
   スナップショットである可能性が高く、現在値との差分は「誤り」ではない）
4. 誤りが見つかったフィールドについてのみ、修正後の全文（corrected）と根拠（evidence、
   一次ソースの該当箇所を引用または要約）を報告する
5. 誤りが1件も無ければ空配列 [] を返す（無理に指摘を作らない）

出力はJSON配列のみ（前置き・後書きなし）:
[{"id":"${t.id}","field":"summary|point|detail","current":"現在の文章","corrected":"修正後の全文","evidence":"一次ソースの根拠"}]`;
}

async function main() {
  const tech = JSON.parse(await fs.readFile(TECH_PATH, "utf-8"));
  const pool = tech.filter((t) => !EXCLUDE_IDS.has(t.id));
  const sample = [];
  for (let i = 0; i < SAMPLE_SIZE && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    sample.push(pool.splice(idx, 1)[0]);
  }
  console.log(`ファクトチェック対象: ${sample.length}件（全${tech.length}件からランダム抽出）\n`);

  const claudeBin = resolveClaudeBin();
  const issues = [];
  for (const t of sample) {
    const primary = pickPrimaryLink(t.links);
    if (!primary?.url) {
      console.log(`── ${t.title} (${t.id}): 一次ソースなし、スキップ`);
      continue;
    }
    process.stdout.write(`── ${t.title} (${t.id}) 検証中... `);
    try {
      const found = runClaudeJsonArray(claudeBin, buildPrompt(t, primary.url), {
        timeout: FACTCHECK_TIMEOUT_MS,
        marker: "field",
        model: "sonnet",
        allowedTools: "WebFetch",
      });
      if (found.length) {
        console.log(`⚠ ${found.length}件の疑い`);
        issues.push(...found);
      } else {
        console.log("✓ 誤りなし");
      }
      // 長時間実行タスクなので、途中でkillされても結果を失わないよう都度追記保存する
      if (OUT_PATH && found.length) {
        await fs.appendFile(OUT_PATH + ".partial.jsonl", found.map((f) => JSON.stringify(f)).join("\n") + "\n");
      }
    } catch (e) {
      console.log(`✗ 検証失敗: ${e.message}`);
    }
  }

  console.log(`\n=== 結果: ${sample.length}件検査 / ${issues.length}件の事実誤りの疑い ===`);
  issues.forEach((i) => console.log(`- [${i.id}] ${i.field}: ${i.evidence?.slice(0, 100)}`));

  if (OUT_PATH) {
    await fs.writeFile(OUT_PATH, JSON.stringify(issues, null, 2));
    console.log(`\nレポート: ${OUT_PATH}`);
    try {
      await fs.unlink(OUT_PATH + ".partial.jsonl");
    } catch {}
  }

  if (issues.length >= 2) {
    console.log(
      `\n※ ${issues.length}件の誤りが見つかりました。ユーザー決定基準（誤り2件以上）に該当するため、` +
      `全${tech.length}件への展開をユーザーに提案してください。`
    );
  }
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
