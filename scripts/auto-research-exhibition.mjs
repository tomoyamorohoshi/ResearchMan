/**
 * Exhibition タブの日次自動収集（SPEC §5.1 / §6.3）。auto-research-tech.mjs を雛形にする。
 *
 * 流れ:
 *   1. status 更新（Claude 不要・最初に実行・即永続化）。全件を computeStatus で再計算し statusAsOf を今日に。ended は削除しない
 *   2. intake 処理: GET /api/exhibition-intake → 投稿本文取得 → Claude で抽出 → 公式裏取り → PATCH（失敗/未デプロイはスキップして続行）
 *   3. 発見: data/exhibition-profile.json をプロンプトに埋め込み、ソースを日替わりローテーションして Claude (WebSearch/WebFetch) に探させる（最大 MAX_ROUNDS）
 *   4. 候補は scripts/lib/exhibition-build.mjs で機械検証（公式ページ再取得で日付・会場照合、dedupe、hard 除外、score、サムネ）。不一致は data/inbox/exhibition-unverified.json
 *   5. data/exhibition.json を原子的に更新し、通知サマリー os.tmpdir()/researchman-exhibition-last-add.json を 0 件でも必ず上書き
 *
 * CLI の失敗（タイムアウト・JSON 抽出失敗）は発見だけスキップして成功終了（status 更新は毎日必ず反映）。
 * Claude CLI が完全に動かない（実行ファイル不在・全ラウンドが非0終了）場合のみ、status 更新を保存した上で非0終了。
 *
 * 使い方: node scripts/auto-research-exhibition.mjs [--dry-run] [--status-only]
 *   --dry-run     data・サムネ・サマリー・状態ファイル・PATCH を一切書き換えない（Claude 発見までは実行）
 *   --status-only ステップ1のみ（Claude・ネットワーク不使用。テスト/緊急用）
 * テスト用環境変数: EXHIBITION_JOB_ROOT / EXHIBITION_JOB_TODAY / EXHIBITION_JOB_TMPDIR
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJsonArray } from "./lib/claude-cli.mjs";
import { localDayIndex } from "./lib/day-index.mjs";
import { todayJst } from "./lib/exhibition-status.mjs";
import { applyStatusUpdate, processCandidates, PREFECTURES } from "./lib/exhibition-build.mjs";
import { runIntake } from "./lib/exhibition-intake-job.mjs";
import { buildDiscoveryPrompt, buildIntakePrompt, expandQueries, pickSourcesForDay, EXHIBITION_CLI_OPTS } from "./lib/exhibition-prompts.mjs";
import {
  readJson,
  writeJsonAtomic,
  appendUnverified,
  writeSummary,
  defaultFetchHtml,
  defaultFetchJson,
  loadIntakeConfig,
  fetchPendingIntake,
  patchIntakeResults,
  makeSaveThumb,
} from "./lib/exhibition-io.mjs";
import { logRejection } from "./lib/rejection-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EXHIBITION_JOB_ROOT || path.join(__dirname, "..");
const TODAY = process.env.EXHIBITION_JOB_TODAY || todayJst();
const TMP_DIR = process.env.EXHIBITION_JOB_TMPDIR || os.tmpdir();
const DATA_PATH = path.join(ROOT, "data/exhibition.json");
const PROFILE_PATH = path.join(ROOT, "data/exhibition-profile.json");
const LAST_RUN_PATH = path.join(ROOT, ".last-exhibition-research-run.txt");
const THUMB_DIR = path.join(ROOT, "public/thumbnails/exhibition");

const DRY_RUN = process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status-only");

const MAX_ROUNDS = 2;
// 1日の追加上限（NEORT++/オンチェーン/ジェネラティブ=collectAll と intake 投稿は上限外）
const MAX_ADD = 5;
// リサーチはSonnetで十分（既定の上位モデルだと遅くタイムアウトしやすい）
const MODEL = "sonnet";
const DISCOVER_TIMEOUT_MS = 600000;
const INTAKE_TIMEOUT_MS = 600000;

// 実行ファイル不在・認証切れ/利用上限などで CLI が非0終了＝「完全に動かない」。タイムアウト/JSON抽出失敗は含めない
const isCliFatal = (e) => /ENOENT|EACCES|終了コード/.test(String(e?.message));

async function saveLastRunDate() {
  try {
    await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  } catch {}
}

async function main() {
  console.log(`\nResearchMan Exhibition 日次収集`);
  console.log(`   ${new Date().toLocaleString("ja-JP")}（today=${TODAY}）`);
  if (DRY_RUN) console.log("   ⚠ DRY RUN（data・サムネ・サマリーは更新しません）");

  const original = await readJson(DATA_PATH);

  // ── 1. status 更新（最初に永続化。後続の失敗で捨てない） ──
  const { data: statusUpdated, transitions } = applyStatusUpdate(original, TODAY);
  console.log(`既存: ${original.items.length}件 / status遷移: ${transitions.length}件${transitions.map((t) => ` [${t.id}: ${t.from}→${t.to}]`).join("")}`);
  let data = statusUpdated;
  if (!DRY_RUN) await writeJsonAtomic(DATA_PATH, data);

  const added = [];
  const unverified = [];
  let cliFatal = false;

  if (!STATUS_ONLY) {
    const profile = await readJson(PROFILE_PATH);
    const claudeBin = resolveClaudeBin();
    const saveThumb = makeSaveThumb(THUMB_DIR);
    const deps = { fetchHtml: defaultFetchHtml, fetchJson: defaultFetchJson, saveThumb, now: () => new Date().toISOString() };
    const reservedIds = await loadReservedIds();
    const buildOpts = {
      addThreshold: profile.scoring.threshold.add,
      highlightThreshold: profile.scoring.threshold.highlight,
      dryRun: DRY_RUN,
      reservedIds,
    };

    // ── 2. intake ──
    try {
      const cfg = await loadIntakeConfig();
      if (!cfg) {
        console.log("[intake] ~/.researchman-favsync.json 未設定 → スキップ");
      } else {
        const pending = await fetchPendingIntake(cfg);
        if (!pending.ok) {
          console.log(`[intake] 取得できず（${pending.reason}）→ スキップして続行`);
        } else if (!pending.items.length) {
          console.log("[intake] 未処理の投稿なし");
        } else {
          console.log(`[intake] 未処理 ${pending.items.length}件`);
          const out = await runIntake({
            items: pending.items,
            data,
            today: TODAY,
            opts: buildOpts,
            deps: {
              ...deps,
              extract: async (posts) =>
                runClaudeJsonArray(claudeBin, buildIntakePrompt(posts, profile, TODAY), {
                  timeout: INTAKE_TIMEOUT_MS,
                  marker: "intakeUrl",
                  model: MODEL,
                  ...EXHIBITION_CLI_OPTS,
                }),
              // PATCH 送信より前に追加分を保存する（PATCH 失敗・後続エラーで取りこぼさない）
              persist: async (d) => {
                if (!DRY_RUN) await writeJsonAtomic(DATA_PATH, d);
              },
              patch: async (results) => {
                if (DRY_RUN) {
                  console.log(`[intake] --dry-run: PATCH しません（${results.length}件）`);
                  return { updated: 0 };
                }
                return patchIntakeResults(cfg, results);
              },
            },
          });
          data = out.data;
          added.push(...out.added);
          unverified.push(...out.unverified);
          console.log(`[intake] 結果: ${out.results.map((r) => `${r.status}`).join(", ")} / PATCH ${out.patched ? "OK" : `失敗（${out.patchError || "dry-run"}）→ data更新は継続`}`);
        }
      }
    } catch (e) {
      console.error(`[intake] 想定外のエラー（続行）: ${e.message}`);
    }

    // ── 3. 発見 + 4. 機械検証 ──
    const dayIndex = localDayIndex();
    const sourceList = pickSourcesForDay(profile.sources, dayIndex);
    const queries = expandQueries(profile.watch.discoveryQueries, TODAY, dayIndex, PREFECTURES);
    console.log(`本日のソース: ${sourceList.map((s) => s.name).join(" / ")}`);
    const existingTitles = data.items.map((i) => i.title);
    const seenThisRun = [];
    let discoveryErrors = 0;
    let roundsAttempted = 0;
    let fatalErrors = 0;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      console.log(`── ラウンド ${round}/${MAX_ROUNDS}: 発見フェーズ ──`);
      roundsAttempted++;
      let found = [];
      try {
        found = runClaudeJsonArray(
          claudeBin,
          buildDiscoveryPrompt({ profile, today: TODAY, sourceList, queries, existingTitles, seenThisRun }),
          { timeout: DISCOVER_TIMEOUT_MS, marker: "officialUrl", model: MODEL, ...EXHIBITION_CLI_OPTS }
        );
      } catch (e) {
        console.error(`発見フェーズ失敗: ${e.message}`);
        discoveryErrors++;
        if (isCliFatal(e)) fatalErrors++;
        continue;
      }
      console.log(`候補: ${found.length}件`);
      if (!found.length) break;
      for (const c of found) if (typeof c?.title === "string" && c.title) seenThisRun.push(c.title);

      const capped = added.filter((a) => a.origin !== "intake" && !a.tags.some((t) => ["generative", "onchain"].includes(t)) && !a.venue.includes("NEORT")).length;
      const out = await processCandidates({ data, candidates: found, today: TODAY, deps, opts: { ...buildOpts, maxAdd: Math.max(0, MAX_ADD - capped), protectIds: new Set(added.map((a) => a.id)) } });
      data = out.data;
      added.push(...out.added);
      unverified.push(...out.unverified);
      for (const x of out.added) console.log(`  ＋追加: ${x.title}（${x.venue} ${x.startDate}〜${x.endDate} score=${x.score}）`);
      for (const x of out.updated) console.log(`  ↻会期更新: ${x.title} ${JSON.stringify(x.patch)}`);
      for (const x of out.unverified) console.log(`  ？unverified: ${x.title} — ${x.reason}`);
      for (const x of out.rejected) {
        console.log(`  ✗ reject: ${x.title} — ${x.reason}`);
        if (!DRY_RUN) await logRejection({ pipeline: "exhibition", title: x.title, reason: x.reason, detail: x.detail || "", link: x.link || "" });
      }
      if (added.length >= MAX_ADD) break;
    }
    cliFatal = roundsAttempted > 0 && fatalErrors >= roundsAttempted;
    if (discoveryErrors && !cliFatal) console.log(`発見フェーズの失敗 ${discoveryErrors}/${roundsAttempted} ラウンド（発見のみスキップして続行）`);
  }

  // ── 5. 書き込みと通知サマリー ──
  if (!DRY_RUN) {
    await writeJsonAtomic(DATA_PATH, data);
    await appendUnverified(ROOT, unverified);
    await writeSummary(TMP_DIR, { added, unverified });
    if (!cliFatal) await saveLastRunDate();
  }
  console.log(`\n完了: 追加${added.length}件 / unverified${unverified.length}件 / 合計${data.items.length}件${DRY_RUN ? "（dry-run: 書き込みなし）" : ""}`);

  if (cliFatal) {
    console.error("Claude CLI が全ラウンドで起動/終了コード異常 → 収集エラーとして終了（status更新は保存済み）");
    process.exitCode = 1;
  }
}

/** cases/tech の id（お気に入り名前空間共有のため exhibition id と衝突させない）。読めなければ空。 */
async function loadReservedIds() {
  const ids = new Set();
  for (const f of ["data/cases.json", "data/tech.json"]) {
    try {
      for (const x of await readJson(path.join(ROOT, f))) if (x?.id) ids.add(x.id);
    } catch {}
  }
  return ids;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("\n❌ エラー:", e.message);
    process.exit(1);
  });
