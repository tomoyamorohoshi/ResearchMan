/**
 * Exhibition タブのデータ組み立てスクリプト（SPEC §5.1 ステップ4。build-tech-from-research.mjs と同型）。
 *
 * 調査済み候補JSON（配列、または {candidates:[...]} / {found:[...]}）から、
 *   公式ページ再取得での日付・会場の機械照合 → 終了済み/hard除外/閾値/dedupe 判定 → サムネ取得 → data/exhibition.json 更新
 * を行う。照合に通らないものは data/inbox/exhibition-unverified.json へ。Claude の主張だけでは追加しない。
 * 実装本体は scripts/lib/exhibition-build.mjs（日次ジョブ auto-research-exhibition.mjs と共有）。
 *
 * 使い方: node scripts/build-exhibition-from-research.mjs <candidates.json> [...] [--dry-run]
 *   --dry-run  data・サムネ・サマリーを更新せず結果のみ表示
 * 環境変数: EXHIBITION_JOB_ROOT（既定: リポジトリルート）/ EXHIBITION_JOB_TODAY / EXHIBITION_JOB_TMPDIR
 */
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { todayJst } from "./lib/exhibition-status.mjs";
import { processCandidates } from "./lib/exhibition-build.mjs";
import { readJson, writeJsonAtomic, appendUnverified, writeSummary, defaultFetchHtml, makeSaveThumb } from "./lib/exhibition-io.mjs";
import { logRejection } from "./lib/rejection-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EXHIBITION_JOB_ROOT || path.join(__dirname, "..");
const TODAY = process.env.EXHIBITION_JOB_TODAY || todayJst();
const TMP_DIR = process.env.EXHIBITION_JOB_TMPDIR || os.tmpdir();
const DRY_RUN = process.argv.includes("--dry-run");
const inputFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function main() {
  if (!inputFiles.length) {
    console.error("usage: node scripts/build-exhibition-from-research.mjs <candidates.json> ... [--dry-run]");
    process.exit(1);
  }
  const profile = await readJson(path.join(ROOT, "data/exhibition-profile.json"));
  const data = await readJson(path.join(ROOT, "data/exhibition.json"));
  const candidates = [];
  for (const f of inputFiles) {
    const raw = await readJson(f);
    const arr = Array.isArray(raw) ? raw : raw.candidates || raw.found || [];
    candidates.push(...arr);
  }
  console.log(`候補: ${candidates.length}件 / 既存: ${data.items.length}件 / today=${TODAY}${DRY_RUN ? "（dry-run）" : ""}\n`);

  const reservedIds = new Set();
  for (const f of ["data/cases.json", "data/tech.json"]) {
    try {
      for (const x of await readJson(path.join(ROOT, f))) if (x?.id) reservedIds.add(x.id);
    } catch {}
  }

  const out = await processCandidates({
    data,
    candidates,
    today: TODAY,
    deps: { fetchHtml: defaultFetchHtml, saveThumb: makeSaveThumb(path.join(ROOT, "public/thumbnails/exhibition")), now: () => new Date().toISOString() },
    opts: {
      addThreshold: profile.scoring.threshold.add,
      highlightThreshold: profile.scoring.threshold.highlight,
      maxAdd: Number.POSITIVE_INFINITY, // 手動/一括取り込みでは日次上限を掛けない
      dryRun: DRY_RUN,
      reservedIds,
    },
  });

  for (const x of out.added) console.log(`＋追加: ${x.title} | ${x.venue} | ${x.startDate}〜${x.endDate} | score=${x.score} | ${x.link}`);
  for (const x of out.updated) console.log(`↻会期更新: ${x.title} ${JSON.stringify(x.patch)}`);
  for (const x of out.skipped) console.log(`＝重複: ${x.title}（既存 ${x.existingId}）`);
  for (const x of out.unverified) console.log(`？unverified: ${x.title} — ${x.reason}`);
  for (const x of out.rejected) {
    console.log(`✗ reject: ${x.title} — ${x.reason}${x.detail ? ` (${x.detail})` : ""}`);
    if (!DRY_RUN) await logRejection({ pipeline: "exhibition", title: x.title, reason: x.reason, detail: x.detail || "", link: x.link || "" });
  }
  console.log(`\n追加${out.added.length} / 会期更新${out.updated.length} / 重複${out.skipped.length} / unverified${out.unverified.length} / reject${out.rejected.length}`);

  if (DRY_RUN) {
    console.log("(dry-run: data/exhibition.json・サムネ・サマリー未更新)");
    return;
  }
  await writeJsonAtomic(path.join(ROOT, "data/exhibition.json"), out.data);
  await appendUnverified(ROOT, out.unverified);
  await writeSummary(TMP_DIR, { added: out.added, unverified: out.unverified });
  console.log(`✅ data/exhibition.json → 合計${out.data.items.length}件`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  });
