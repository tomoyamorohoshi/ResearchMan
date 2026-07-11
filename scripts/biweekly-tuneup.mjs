/**
 * 隔週チューンアップ（実装計画 researchman-ops-routine.md バッチ2b）。
 *
 * Case Study / Technology のお気に入り蓄積を分析し、収集レーン・探索角度・
 * アイデア生成の構造（サンプリング重み・パターン混合比）を2週間に1回ブラッシュアップする。
 * launchd `com.researchman.tuneup`（毎月1日・15日 08:30、run-if-due.mjsでゲート）から呼ばれる。
 *
 * 流れ:
 *   1. GET /api/favorites（Bearer FAVORITES_SYNC_TOKEN。設定は ~/.researchman-favsync.json）→
 *      cases.json/tech.jsonと結合してお気に入り分布を算出
 *   2. Claude CLI 分析パス1「リサーチ計画」: research-tuning.json / x-radar-queries.json /
 *      RESEARCH_PLAN.md の改訂案を生成
 *   3. Claude CLI 分析パス2「アイデア構造見直し」: idea-tuning.json の改訂案を生成
 *   4. ガードレール（機械検証・スキーマ＋変更量上限）: scripts/lib/tuneup-guardrails.mjs
 *   5. dry-run全通し: 改訂案を一時的に書き込み、ideas:dry / auto-research:tech:dry /
 *      auto-research:cc:dry が正常終了するか確認。失敗なら git checkout で全戻し
 *   6. 成功時: 設定ファイルを書き込んだ状態で終了（exit 0）。commit/push/verify-deploy/
 *      LINE通知は launchd plist のシェル側が担当（既存3ジョブと同じ役割分担）
 *
 * LINE報告文面は os.tmpdir()/researchman-tuneup-report.txt に書き出す
 * （notify-line.mjs --text-file が送る。成功/スキップ/失敗のいずれでも必ず書く）。
 *
 * 使い方:
 *   node scripts/biweekly-tuneup.mjs             # 本番実行
 *   node scripts/biweekly-tuneup.mjs --dry-run   # フィクスチャお気に入りで全経路検証。
 *                                                  設定ファイルは検証後に必ず元へ戻し、
 *                                                  状態ファイル(.last-tuneup-run.txt)も更新しない
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import https from "https";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJson } from "./lib/claude-cli.mjs";
import { favoriteIds, computeFavoriteStats, computeIdeaStructureStats } from "./lib/tuneup-stats.mjs";
import {
  checkResearchTuningChange,
  checkXRadarQueriesChange,
  checkIdeaTuningChange,
} from "./lib/tuneup-guardrails.mjs";
import { reinjectDescriptions } from "./lib/reinject-descriptions.mjs";
import { applyCandidateWithVerification } from "./lib/tuneup-apply.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CASES_PATH = path.join(ROOT, "data/cases.json");
const TECH_PATH = path.join(ROOT, "data/tech.json");
const IDEAS_PATH = path.join(ROOT, "data/ideas.json");
const RESEARCH_TUNING_PATH = path.join(ROOT, "data/research-tuning.json");
const IDEA_TUNING_PATH = path.join(ROOT, "data/idea-tuning.json");
const XRADAR_QUERIES_PATH = path.join(ROOT, "data/x-radar-queries.json");
const RESEARCH_PLAN_PATH = path.join(ROOT, "RESEARCH_PLAN.md");
const FAVSYNC_CONFIG_PATH = path.join(os.homedir(), ".researchman-favsync.json");
const LAST_RUN_PATH = path.join(ROOT, ".last-tuneup-run.txt");
const REPORT_PATH = path.join(os.tmpdir(), "researchman-tuneup-report.txt");
const SITE = "https://research-man.vercel.app";

const DRY_RUN = process.argv.includes("--dry-run");
const MODEL = "sonnet";
const ANALYSIS_TIMEOUT_MS = 600000;
// 各dry-runサブパイプラインの上限。auto-research-cc.mjsは発見(最大3ラウンド×600秒)+
// 候補ごとのサムネ検証(ネットワーク律速)+記事生成(最大10件×300秒)を直列に行うため、
// 実測で30分を超えることがある。月2回しか動かないジョブなので短縮する理由が無く、
// 短すぎて正当な変更をタイムアウトで誤って破棄する方が有害。余裕を持たせて45分とする
const SUBPIPELINE_TIMEOUT_MS = 2700000;

const TOUCHED_PATHS = [RESEARCH_TUNING_PATH, IDEA_TUNING_PATH, XRADAR_QUERIES_PATH, RESEARCH_PLAN_PATH];

// 外部シグナル（TaskStop/kill等）で中断された場合の保険。--dry-runは「作業ツリーを汚さない」が
// 契約なので、候補ファイル書き込み後に中断されても復元を試みる（2026-07-08、検証中に
// TaskStopで中断した際、書き込み済みの候補設定がgit checkoutされずに残った実機事象の再発防止。
// 通常の完走パスの保証は scripts/lib/tuneup-apply.mjs 側で行う。これはあくまで外部中断に対する
// 保険であり、git checkout はコミット済み状態への復元なので何度呼んでも副作用は無い）
if (DRY_RUN) {
  const emergencyRevert = (signal) => {
    console.error(`\n⚠ ${signal}で中断されました。--dry-runのため作業ツリーを念のため復元します`);
    try {
      spawnSync("git", ["checkout", "--", ...TOUCHED_PATHS], { cwd: ROOT });
    } catch {}
    process.exit(1);
  };
  process.on("SIGINT", () => emergencyRevert("SIGINT"));
  process.on("SIGTERM", () => emergencyRevert("SIGTERM"));
}

function log(msg) {
  console.log(msg);
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function writeJsonFile(p, data) {
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n");
}

async function writeReport(text) {
  await fs.writeFile(REPORT_PATH, text.trimEnd() + "\n");
}

// http GET + Bearer認証。settleパターン準拠（OPERATIONS.md §4。destroy前に必ずsettleし、
// close/errorでも解決してPromiseが永久未解決にならないようにする）。
function httpGetJson(url, token) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    // https.get()はURLが不正（http://等の非httpsスキーム・パース不能な文字列）だと
    // コールバック前に同期throwする。~/.researchman-favsync.jsonの設定ミス（typo等）で
    // 拾い漏れて未処理例外化しないよう、この呼び出し自体をtry/catchで包む
    // （settleパターン: エラーも必ずsettleで解決し、Promiseが未解決のまま残らないようにする）。
    try {
      const req = https.get(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "researchman-tuneup" } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return settle({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}` });
        }
        const chunks = [];
        const finish = () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            settle({ ok: true, status: 200, body });
          } catch (e) {
            settle({ ok: false, status: 200, error: `JSON解析エラー: ${e.message}` });
          }
        };
        res.on("data", (d) => chunks.push(d));
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      });
      req.on("error", (e) => settle({ ok: false, status: 0, error: e.message }));
      req.setTimeout(15000, () => {
        settle({ ok: false, status: 0, error: "timeout" });
        req.destroy();
      });
    } catch (e) {
      settle({ ok: false, status: 0, error: `不正なendpoint: ${e.message}` });
    }
  });
}

// --dry-run用フィクスチャ: 実データから先頭数件を「お気に入り」とみなす（favsync未設定でも
// 全経路を通すため。本物のGET /api/favoritesは呼ばない）
function buildFixtureFavorites(cases, tech) {
  const now = Date.now();
  const items = {};
  for (const c of cases.slice(0, 5)) items[c.id] = { fav: true, ts: now };
  for (const t of tech.slice(0, 5)) items[t.id] = { fav: true, ts: now };
  return { version: 1, items };
}

function gitCheckoutRevert(paths) {
  const r = spawnSync("git", ["checkout", "--", ...paths], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("⚠ git checkout による復元に失敗しました。手動確認が必要です:", paths.join(", "));
  }
}

function runDrySubpipeline(npmScript) {
  log(`── dry-run検証: npm run ${npmScript} ──`);
  const r = spawnSync("npm", ["run", npmScript], {
    cwd: ROOT,
    stdio: "inherit",
    timeout: SUBPIPELINE_TIMEOUT_MS,
  });
  return !r.error && r.status === 0;
}

function buildPass1Prompt({ favStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan }) {
  return `ResearchMan（デジタルクリエイティブ事例・技術データベース）の隔週チューンアップ「リサーチ計画」担当。
ユーザーがサイトでお気に入り(★)した Case Study / Technology の傾向を、全体分布と比較して、
日次自動収集（auto-research-cc.mjs / auto-research-tech.mjs）の探索レーン・角度・X検索クエリを
ブラッシュアップしてください。

# お気に入り統計
- お気に入り事例: ${favStats.favoriteCaseCount}件 / 全${favStats.totalCaseCount}件
- お気に入り技術: ${favStats.favoriteTechCount}件 / 全${favStats.totalTechCount}件
- 事例タグ分布（全体）: ${JSON.stringify(favStats.caseTagDistributionAll)}
- 事例タグ分布（お気に入りのみ）: ${JSON.stringify(favStats.caseTagDistributionFav)}
- 技術domain分布（全体）: ${JSON.stringify(favStats.techDomainDistributionAll)}
- 技術domain分布（お気に入りのみ）: ${JSON.stringify(favStats.techDomainDistributionFav)}
- お気に入り事例のsources分布: ${JSON.stringify(favStats.caseSourcesDistributionFav)}
- お気に入り技術のtype分布: ${JSON.stringify(favStats.techTypeDistributionFav)}
- お気に入り事例一覧（抜粋）: ${JSON.stringify(favStats.favoriteCases.slice(0, 40))}
- お気に入り技術一覧（抜粋）: ${JSON.stringify(favStats.favoriteTech.slice(0, 40))}

# 現行設定
research-tuning.json: ${JSON.stringify(oldResearchTuning)}
x-radar-queries.json: ${JSON.stringify(oldXRadarQueries)}
現行RESEARCH_PLAN.md:
${oldResearchPlan}

# 厳守事項（機械検証で拒否される。逸脱すると変更全体が破棄される）
- research-tuning.json の構造（tech.lanes / cc.roundFoci、各要素の必須キー）は変えない。
  label/sources/diversityの**文言**のみ変更可
- tech.lanes・cc.roundFociとも件数は3〜6件を維持
- x-radar-queries.jsonは文字列配列のまま、件数は1〜6件を維持
- **変更は保守的に**: tech.lanes と cc.roundFoci を合わせて2件まで、x-radarクエリは3件までしか
  差し替えない（大半は現状維持し、お気に入りが強く示す傾向がある部分だけピンポイントで変える）
- 有意な傾向が見えない・お気に入りが少なすぎる場合は、無理に変えず現状のJSONをそのまま返してよい

# 出力
JSON1つのみ（前置き・後書きなし）:
{
  "researchTuning": ${JSON.stringify({ tech: { lanes: "..." }, cc: { roundFoci: "..." } })},
  "xRadarQueries": ["..."],
  "researchPlanMarkdown": "# RESEARCH_PLAN.md の全文（Markdown）。現在の関心仮説・強化する源・弱める源・根拠を人間可読に書く",
  "rationale": "LINE報告用の変更理由の要約（2〜4文、日本語）"
}`;
}

function buildPass2Prompt({ favStats, ideaStats, oldIdeaTuning }) {
  return `ResearchMan「アイデアの種」生成（generate-idea-seeds.mjs）の隔週チューンアップ「構造見直し」担当。
アイデア品質の直接評価はしない（★は無い）。ideas.json蓄積の機械指標とお気に入り分布から、
サンプリング重み・パターン混合比・プロンプト文言の**構造**だけを見直してください。

# ideas.json 機械指標
- 総アイデア数: ${ideaStats.totalIdeas}
- パターン分布: ${JSON.stringify(ideaStats.patternCounts)}
- ユニーク参照数: ${ideaStats.uniqueRefsUsed}
- 使い回され気味の参照（3回以上）: ${JSON.stringify(ideaStats.overusedRefs)}

# お気に入り分布（Case/Techの関心シグナル）
- 事例タグ分布（お気に入り）: ${JSON.stringify(favStats.caseTagDistributionFav)}
- 技術domain分布（お気に入り）: ${JSON.stringify(favStats.techDomainDistributionFav)}

# 現行設定 (idea-tuning.json)
${JSON.stringify(oldIdeaTuning)}

# 厳守事項（機械検証で拒否される。逸脱すると変更全体が破棄される）
- キー構造は変えない。seedCount/caseSample/techSample は正の整数のまま
- patternMix の contextXTech/techXTech/repurpose/free は合計が必ず1になるようにする
- samplingWeights.caseTags / samplingWeights.techDomains の各値は0.25〜4.0の範囲に収める
  （キーは cases.json の tags 文字列 / tech.json の domains 文字列。過度な傾倒を避けるため
  基本は1.0付近に留め、明確な偏りがある場合だけ調整する）
- 変更する重み項目は合計10項目まで（大半のキーは1.0のままでよい）
- promptText.patternDefinitions/roleIntro/styleNotes は文言の調整のみ（空にしない）
- 有意な傾向が見えない場合は無理に変えず現状のJSONをそのまま返してよい

# 出力
JSON1つのみ（前置き・後書きなし）:
{
  "ideaTuning": ${JSON.stringify(oldIdeaTuning)},
  "rationale": "LINE報告用の変更理由の要約（2〜4文、日本語）"
}`;
}

function buildReport(lines) {
  return [`🔧 ResearchMan 隔週チューンアップ`, "", ...lines, "", `${SITE}`].join("\n");
}

async function main() {
  log(`\nResearchMan 隔週チューンアップ`);
  log(`   ${new Date().toLocaleString("ja-JP")}`);
  if (DRY_RUN) log("   ⚠ DRY RUN（設定ファイルは検証後に必ず元へ戻します）");

  const cases = await readJson(CASES_PATH);
  const tech = await readJson(TECH_PATH);
  const ideas = await readJson(IDEAS_PATH);

  // ── 1. favorites取得 ──
  let favoritesData;
  if (DRY_RUN) {
    favoritesData = buildFixtureFavorites(cases, tech);
    log(`🧪 フィクスチャお気に入り${Object.keys(favoritesData.items).length}件を使用`);
  } else {
    let favsyncConfig = null;
    try {
      favsyncConfig = JSON.parse(await fs.readFile(FAVSYNC_CONFIG_PATH, "utf-8"));
    } catch {
      log(`同期未設定（${FAVSYNC_CONFIG_PATH} が無い）→ 今回はスキップ`);
      await writeReport(
        buildReport([
          "お気に入りサーバ同期が未設定のため、今回の分析をスキップしました。",
          `${FAVSYNC_CONFIG_PATH} に { "endpoint": "...", "token": "..." } を設定してください。`,
        ])
      );
      await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
      return;
    }
    if (!favsyncConfig?.endpoint || !favsyncConfig?.token) {
      log("同期設定が不完全（endpoint/token欠落）→ 今回はスキップ");
      await writeReport(buildReport([`${FAVSYNC_CONFIG_PATH} の設定が不完全です（endpoint/tokenを確認してください）。`]));
      await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
      return;
    }
    const res = await httpGetJson(favsyncConfig.endpoint, favsyncConfig.token);
    if (!res.ok) {
      log(`favorites取得失敗: ${res.error}`);
      await writeReport(buildReport([`❌ お気に入りの取得に失敗しました（${res.error}）。ログを確認してください。`]));
      process.exitCode = 1;
      return;
    }
    favoritesData = res.body;
  }

  const favIds = favoriteIds(favoritesData?.items);
  log(`お気に入り: ${favIds.length}件`);
  if (!favIds.length) {
    log("お気に入りが0件 → 分析材料なし。今回はスキップ");
    await writeReport(buildReport(["お気に入りがまだ0件のため、今回の分析をスキップしました。"]));
    if (!DRY_RUN) await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
    return;
  }

  const favStats = computeFavoriteStats({ favIds, cases, tech });
  const ideaStats = computeIdeaStructureStats(ideas);

  const oldResearchTuning = await readJson(RESEARCH_TUNING_PATH);
  const oldIdeaTuning = await readJson(IDEA_TUNING_PATH);
  const oldXRadarQueries = await readJson(XRADAR_QUERIES_PATH);
  const oldResearchPlan = await fs.readFile(RESEARCH_PLAN_PATH, "utf-8").catch(() => "(初版なし)");

  const claudeBin = resolveClaudeBin();

  // ── 2. 分析パス1: リサーチ計画 ──
  log("── 分析パス1: リサーチ計画 ──");
  let pass1;
  try {
    pass1 = runClaudeJson(
      claudeBin,
      buildPass1Prompt({ favStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan }),
      { timeout: ANALYSIS_TIMEOUT_MS, marker: '"researchTuning"', model: MODEL }
    );
  } catch (e) {
    log(`分析パス1失敗: ${e.message}`);
    await writeReport(buildReport([`❌ 分析パス1（リサーチ計画）が失敗しました: ${e.message}`]));
    process.exitCode = 1;
    return;
  }
  if (!pass1?.researchTuning || !pass1?.xRadarQueries || !pass1?.researchPlanMarkdown) {
    log("分析パス1の出力が不完全です");
    await writeReport(buildReport(["❌ 分析パス1（リサーチ計画）の出力が不完全でした。"]));
    process.exitCode = 1;
    return;
  }

  // ── 3. 分析パス2: アイデア構造見直し ──
  log("── 分析パス2: アイデア構造見直し ──");
  let pass2;
  try {
    pass2 = runClaudeJson(claudeBin, buildPass2Prompt({ favStats, ideaStats, oldIdeaTuning }), {
      timeout: ANALYSIS_TIMEOUT_MS,
      marker: '"ideaTuning"',
      model: MODEL,
    });
  } catch (e) {
    log(`分析パス2失敗: ${e.message}`);
    await writeReport(buildReport([`❌ 分析パス2（アイデア構造見直し）が失敗しました: ${e.message}`]));
    process.exitCode = 1;
    return;
  }
  if (!pass2?.ideaTuning) {
    log("分析パス2の出力が不完全です");
    await writeReport(buildReport(["❌ 分析パス2（アイデア構造見直し）の出力が不完全でした。"]));
    process.exitCode = 1;
    return;
  }

  // ── 4. ガードレール（機械検証） ──
  log("── ガードレール検証 ──");
  const researchCheck = checkResearchTuningChange(oldResearchTuning, pass1.researchTuning);
  const queriesCheck = checkXRadarQueriesChange(oldXRadarQueries, pass1.xRadarQueries);
  const ideaCheck = checkIdeaTuningChange(oldIdeaTuning, pass2.ideaTuning);
  const guardrailErrors = [...researchCheck.errors, ...queriesCheck.errors, ...ideaCheck.errors];
  if (guardrailErrors.length) {
    log(`ガードレール違反:\n  ${guardrailErrors.join("\n  ")}`);
    await writeReport(
      buildReport(["❌ 分析結果がガードレールに違反したため、変更を破棄しました。", "", ...guardrailErrors.map((e) => `・${e}`)])
    );
    process.exitCode = 1;
    return;
  }
  log(
    `ガードレールPASS（レーン変更${researchCheck.laneChanges}件・クエリ変更${queriesCheck.queryChanges}件・重み変更${ideaCheck.weightChanges}件）`
  );

  // ── 5. 改訂案を書き込み、dry-run全通しで検証 ──
  // write→verify→revert判断は scripts/lib/tuneup-apply.mjs に一本化している
  // （検証失敗・例外いずれでも必ずrevertし、dry-run時は成功時も必ずrevertすることを
  // 単一の実装で保証する。個別分岐に revert 呼び出しを散らすと考慮漏れの温床になるため）
  const nextResearchTuning = reinjectDescriptions(oldResearchTuning, pass1.researchTuning);
  const nextIdeaTuning = reinjectDescriptions(oldIdeaTuning, pass2.ideaTuning);

  const applyResult = await applyCandidateWithVerification({
    writeFiles: async () => {
      await writeJsonFile(RESEARCH_TUNING_PATH, nextResearchTuning);
      await writeJsonFile(IDEA_TUNING_PATH, nextIdeaTuning);
      await writeJsonFile(XRADAR_QUERIES_PATH, pass1.xRadarQueries);
      await fs.writeFile(RESEARCH_PLAN_PATH, pass1.researchPlanMarkdown.trimEnd() + "\n");
    },
    verifySteps: ["ideas:dry", "auto-research:tech:dry", "auto-research:cc:dry"].map(
      (npmScript) => () => runDrySubpipeline(npmScript)
    ),
    revert: async () => gitCheckoutRevert(TOUCHED_PATHS),
    dryRun: DRY_RUN,
  });

  if (!applyResult.ok) {
    log(`dry-run全通し検証が失敗しました（${applyResult.reason}）→ 全戻し済み`);
    await writeReport(buildReport([`❌ dry-run検証に失敗したため、変更を破棄しました（${applyResult.reason}）。`]));
    process.exitCode = 1;
    return;
  }
  log("dry-run全通し PASS");

  const changeSummaryLines = [
    `お気に入り: 事例${favStats.favoriteCaseCount}件・技術${favStats.favoriteTechCount}件を分析`,
    `変更: レーン/角度${researchCheck.laneChanges}件・Xクエリ${queriesCheck.queryChanges}件・重み${ideaCheck.weightChanges}件`,
    "",
    "【リサーチ計画】" + (pass1.rationale || "(理由の記載なし)"),
    "【アイデア構造】" + (pass2.rationale || "(理由の記載なし)"),
  ];

  if (DRY_RUN) {
    log("✅ --dry-run: 全ガードレール・dry-run検証を通過。設定ファイルは元に戻しました（コミットしません）");
    await writeReport(buildReport(["✅ --dry-run 全経路PASS（コミットはしていません）", "", ...changeSummaryLines]));
    return;
  }

  await writeReport(buildReport(["✅ 分析・検証が完了しました。反映します。", "", ...changeSummaryLines]));
  await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  log("✅ 完了（commit/push/通知は launchd plist 側で実行）");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("\n❌ エラー:", e.message);
    process.exit(1);
  });
