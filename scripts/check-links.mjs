/**
 * 全relatedWorksのURLの死活確認スクリプト
 * 使い方: node scripts/check-links.mjs
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../data/cases.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

const cases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
const broken = [];
const total = [];

for (const c of cases) {
  if (!Array.isArray(c.relatedWorks)) continue;
  for (const w of c.relatedWorks) {
    total.push(w.url);
    const result = await checkUrl(w.url);
    if (!result.ok) {
      broken.push({ caseId: c.id, title: w.title, url: w.url, status: result.status, error: result.error });
      process.stdout.write(`✗ [${c.id}] ${w.title.slice(0, 40)}\n  ${w.url}\n  → ${result.status || result.error}\n\n`);
    } else {
      process.stdout.write(`✓ ${result.status} ${w.url.slice(0, 60)}\n`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

console.log(`\n--- 結果 ---`);
console.log(`総URL数: ${total.length}`);
console.log(`NG: ${broken.length}件`);
if (broken.length > 0) {
  console.log("\nNG一覧:");
  broken.forEach(b => console.log(`  [${b.caseId}] ${b.title}\n    ${b.url}`));
}
