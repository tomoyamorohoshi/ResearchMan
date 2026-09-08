/**
 * 週次チューンアップ（実装計画 researchman-ops-routine.md バッチ2b。2026-07-14に隔週→週次へ変更）。
 *
 * ★ ファイル名 biweekly-tuneup.mjs は後方互換のため据え置きだが、実体は週次実行（毎週月曜08:30）。
 *
 * Case Study / Technology のお気に入り蓄積（＋ごみ箱＝弱化シグナル・ユーザー追加事例＝強化シグナル・
 * アイデアいいね/ゴミ箱＝アイデア評価シグナル）を分析し、収集レーン・探索角度・アイデア生成の構造
 * （サンプリング重み・パターン混合比）を週1回ブラッシュアップする。あわせて切り口語彙
 * （data/idea-angles.json）もcases.json蓄積が+50件増えるたびに自動リフレッシュする。
 * Windowsタスクスケジューラ タスク名 ResearchMan-tuneup
 * （毎週月曜08:30、scripts/windows/run-job.mjs経由。run-if-due.mjsで同日重複防止）から呼ばれる。
 *
 * 流れ:
 *   0. 切り口語彙リフレッシュ（2026-07-16新設）: cases.json件数が前回生成時
 *      （data/idea-angles-meta.json）から+50件以上増えていれば、
 *      studio/server/pipeline/generateIdeaAnglesCli.tsを子プロセス実行して再生成し、
 *      機械ガードレール（件数15〜25・実在id・旧語彙との入れ替わり率≤80%）を通ったときだけ反映する
 *      （scripts/lib/tuneup-angles.mjs）。favorites同期の要否とは独立に毎回判定する
 *   1. GET /api/favorites（Bearer FAVORITES_SYNC_TOKEN。設定は ~/.researchman-favsync.json）→
 *      cases.json/tech.jsonと結合してお気に入り分布を算出。あわせて GET /api/trash
 *      （favoritesと同じtoken・endpointから導出）でごみ箱分布（弱化シグナル）、
 *      cases.json の sources:["User"] からユーザー追加事例分布（強化シグナル）、
 *      GET /api/idea-likes・GET /api/idea-trash（2026-07-16新設）でアイデア評価シグナル
 *      （パターン別・参照先タグ別のいいね/ゴミ箱分布とscoresとの相関）も算出し、
 *      分析パス1・パス2のプロンプトに反映する（各endpointが未設定/エラーの場合は黙ってスキップし、
 *      処理全体は落とさない）
 *   2. Claude CLI 分析パス1「リサーチ計画」: research-tuning.json / x-radar-queries.json /
 *      RESEARCH_PLAN.md の改訂案を生成
 *   3. Claude CLI 分析パス2「アイデア構造見直し」: idea-tuning.json の改訂案を生成
 *   4. ガードレール（機械検証・スキーマ＋変更量上限）: scripts/lib/tuneup-guardrails.mjs
 *   5. dry-run全通し: 改訂案を一時的に書き込み、ideas:dry / auto-research:tech:dry /
 *      auto-research:cc:dry が正常終了するか確認。失敗なら git checkout で全戻し
 *   6. 成功時: 設定ファイルを書き込んだ状態で終了（exit 0）。commit/push/verify-deploy/
 *      LINE通知は run-job.mjs 側が担当（既存3ジョブと同じ役割分担）。切り口語彙を更新した場合は
 *      data/idea-angles.json・data/idea-angles-meta.jsonを自らgit addしておき、
 *      run-job.mjs側のgit add→commitに相乗りさせる（run-job.mjsは編集対象外のため）
 *
 * LINE報告文面は os.tmpdir()/researchman-tuneup-report.txt に書き出す
 * （notify-line.mjs --text-file が送る。成功/スキップ/失敗のいずれでも必ず書く。
 * 切り口語彙を更新した場合はその差分も末尾に追記する）。
 *
 * 使い方:
 *   node scripts/biweekly-tuneup.mjs             # 本番実行
 *   node scripts/biweekly-tuneup.mjs --dry-run   # フィクスチャお気に入り/ごみ箱で全経路検証。
 *                                                  設定ファイルは検証後に必ず元へ戻し、
 *                                                  状態ファイル(.last-tuneup-run.txt)も更新しない
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import https from "https";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveClaudeBin, runClaudeJson } from "./lib/claude-cli.mjs";
import {
  favoriteIds,
  computeFavoriteStats,
  computeIdeaStructureStats,
  computeTrashStats,
  computeUserCaseStats,
  computeIdeaFeedbackStats,
  deriveTrashEndpoint,
  deriveIdeaLikesEndpoint,
  deriveIdeaTrashEndpoint,
} from "./lib/tuneup-stats.mjs";
import {
  checkResearchTuningChange,
  checkXRadarQueriesChange,
  checkIdeaTuningChange,
} from "./lib/tuneup-guardrails.mjs";
import { reinjectDescriptions } from "./lib/reinject-descriptions.mjs";
import { applyCandidateWithVerification } from "./lib/tuneup-apply.mjs";
import { buildPass1Prompt, buildPass2Prompt } from "./lib/tuneup-prompts.mjs";
import {
  shouldRefreshAngles,
  checkAnglesGuardrail,
  diffAngleLabels,
  readAnglesMeta,
  writeAnglesMeta,
  runGenerateIdeaAnglesCli,
} from "./lib/tuneup-angles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CASES_PATH = path.join(ROOT, "data/cases.json");
const TECH_PATH = path.join(ROOT, "data/tech.json");
const IDEAS_PATH = path.join(ROOT, "data/ideas.json");
const RESEARCH_TUNING_PATH = path.join(ROOT, "data/research-tuning.json");
const IDEA_TUNING_PATH = path.join(ROOT, "data/idea-tuning.json");
const XRADAR_QUERIES_PATH = path.join(ROOT, "data/x-radar-queries.json");
const IDEA_ANGLES_PATH = path.join(ROOT, "data/idea-angles.json");
const IDEA_ANGLES_META_PATH = path.join(ROOT, "data/idea-angles-meta.json");
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
// 実測で30分を超えることがある。週1回しか動かないジョブなので短縮する理由が無く、
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

// --dry-run用フィクスチャ: お気に入りフィクスチャ(先頭5件)と重ならない6〜8件目を「ごみ箱」とみなす
// （favsync未設定でも全経路を通すため。本物のGET /api/trashは呼ばない）
function buildFixtureTrash(cases) {
  const now = Date.now();
  const items = {};
  for (const c of cases.slice(5, 8)) items[c.id] = { fav: true, ts: now };
  return { version: 1, items };
}

// --dry-run用フィクスチャ: ideas.jsonの先頭5件を「いいね」とみなす（favsync未設定でも
// 全経路を通すため。本物のGET /api/idea-likesは呼ばない）
function buildFixtureIdeaLikes(ideas) {
  const now = Date.now();
  const items = {};
  for (const i of ideas.slice(0, 5)) items[i.id] = { fav: true, ts: now };
  return { version: 1, items };
}

// --dry-run用フィクスチャ: いいねフィクスチャ(先頭5件)と重ならない6〜8件目を「ゴミ箱」とみなす
// （favsync未設定でも全経路を通すため。本物のGET /api/idea-trashは呼ばない）
function buildFixtureIdeaTrash(ideas) {
  const now = Date.now();
  const items = {};
  for (const i of ideas.slice(5, 8)) items[i.id] = { fav: true, ts: now };
  return { version: 1, items };
}

function gitCheckoutRevert(paths) {
  const r = spawnSync("git", ["checkout", "--", ...paths], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("⚠ git checkout による復元に失敗しました。手動確認が必要です:", paths.join(", "));
  }
}

// 切り口語彙リフレッシュ成功時、data/idea-angles.json・data/idea-angles-meta.jsonをステージする。
// run-job.mjs（編集対象外）は既存4パス(research-tuning.json等)だけをgit addしてcommitするため、
// ここで先にステージしておけば、run-job.mjs側のgit add→commitに自動的に相乗りする
// （run-job.mjsを変更せずに済む。commit対象ファイル一覧をrun-job.mjsとここの2箇所に
// 分散させたくないための意図的な設計。詳細はOPERATIONS.md参照）。
function gitAdd(paths) {
  const r = spawnSync("git", ["add", ...paths], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("⚠ git add に失敗しました。手動確認が必要です:", paths.join(", "));
  }
}

/**
 * 切り口語彙（data/idea-angles.json）の自動リフレッシュ（要件2）。
 * cases.json件数が前回語彙生成時（data/idea-angles-meta.json）から+50件以上増えていれば、
 * studio/server/pipeline/generateIdeaAnglesCli.tsを子プロセス実行して再生成し、
 * 機械ガードレール（件数15〜25・実在id・入れ替わり率≤80%）を通ったときだけ反映する。
 * 失敗時は旧語彙を維持し警告を返す。--dry-run時はコスト（Claude呼び出し）を避けるため
 * 呼び出し元でこの関数自体を呼ばない。
 * @returns {Promise<string[]>} LINE報告に追加する行（何もしなければ空配列）
 */
// metaPath/anglesPath/gitAddFnはテスト用の注入ポイント（既定値は本番と同じ実パス/実gitAdd。
// スモークテストが実リポジトリのファイル・実gitコマンドに触れずに検証できるようにするため。
// smoke-tuneup-angles.mjsから直接importして検証する）。
// runGenerateIdeaAnglesCliFn/gitCheckoutRevertFnも同様の注入ポイント（ガードレール違反シナリオを
// 実Agent SDK呼び出し・実git checkoutなしに検証するため。既定値は本番と同じ実関数）。
export async function maybeRefreshIdeaAngles({
  cases,
  metaPath = IDEA_ANGLES_META_PATH,
  anglesPath = IDEA_ANGLES_PATH,
  gitAddFn = gitAdd,
  runGenerateIdeaAnglesCliFn = runGenerateIdeaAnglesCli,
  gitCheckoutRevertFn = gitCheckoutRevert,
}) {
  const meta = await readAnglesMeta(metaPath);
  const caseCount = cases.length;

  if (!meta) {
    // 初回導入時: いきなり再生成はせず、まずベースラインだけ記録する
    // （導入直後の初回チューンアップで無条件に高コストなClaude呼び出しが走らないようにするため）。
    // caseCount（語彙の生成起点）とlastAttemptCaseCount（次回判定の基準点）は初回は同値。
    await writeAnglesMeta(metaPath, {
      caseCount,
      lastAttemptCaseCount: caseCount,
      generatedAt: new Date().toISOString(),
    });
    // ベースライン記録のみのパスでも、metaファイル自体は必ずgit addしておく
    // （そうしないと次に語彙リフレッシュが実際に発生するまでdata/idea-angles-meta.jsonが
    // 永久にgit untrackedのまま残ってしまうバグの修正）。
    gitAddFn([metaPath]);
    log(`切り口語彙メタ未設定 → ベースラインを記録(cases=${caseCount}件)。再生成はスキップ`);
    return [];
  }

  const lastAttemptBaseline = meta.lastAttemptCaseCount ?? meta.caseCount;

  if (!shouldRefreshAngles(caseCount, meta)) {
    log(`切り口語彙リフレッシュ条件未達（前回${lastAttemptBaseline}件→現在${caseCount}件。+50件未満）→ スキップ`);
    return [];
  }

  log(`切り口語彙リフレッシュ条件達成（前回${lastAttemptBaseline}件→現在${caseCount}件）→ 再生成を実行`);

  let oldAngles;
  try {
    oldAngles = JSON.parse(await fs.readFile(anglesPath, "utf-8"));
  } catch (e) {
    log(`⚠ 既存の切り口語彙の読み込みに失敗しました（${e.message}）→ 今回はリフレッシュをスキップ`);
    return ["⚠ 切り口語彙リフレッシュをスキップしました（既存ファイルの読み込みエラー）。"];
  }

  const cliOk = await runGenerateIdeaAnglesCliFn({ rootDir: ROOT });
  if (!cliOk) {
    log("⚠ 切り口語彙の再生成CLIが失敗しました → 旧語彙を維持");
    gitCheckoutRevert([anglesPath]);
    return ["⚠ 切り口語彙の再生成に失敗したため、旧語彙を維持しました。"];
  }

  let newAngles;
  try {
    newAngles = JSON.parse(await fs.readFile(anglesPath, "utf-8"));
  } catch (e) {
    log(`⚠ 再生成後の切り口語彙の読み込みに失敗しました（${e.message}）→ 旧語彙を維持`);
    gitCheckoutRevert([anglesPath]);
    return ["⚠ 切り口語彙の再生成結果が読み込めなかったため、旧語彙を維持しました。"];
  }

  const validCaseIds = new Set(cases.map((c) => c.id));
  const guardrail = checkAnglesGuardrail({ oldAngles, newAngles, validCaseIds });
  if (!guardrail.ok) {
    log(`⚠ 切り口語彙ガードレール違反 → 旧語彙を維持:\n  ${guardrail.errors.join("\n  ")}`);
    gitCheckoutRevertFn([anglesPath]);
    // 今回の生成結果は採用しない（meta.caseCount＝語彙の実際の生成起点は据え置く）が、
    // 次回のshouldRefreshAngles判定は「今回の時点からの増分」で行われるようにするため、
    // lastAttemptCaseCountだけ今回のcaseCountに更新して書き込む（デッドロック解消。
    // TURNOVER_RATE_MAX自体は緩めない。docs/CODE_REVIEW_HANDOFF等参照不要、方針はここに記載）。
    await writeAnglesMeta(metaPath, { ...meta, lastAttemptCaseCount: caseCount, generatedAt: meta.generatedAt });
    gitAddFn([metaPath]);
    log(`　→ 次回判定の基準点を更新（${caseCount}件時点）`);
    return [
      "⚠ 切り口語彙の再生成がガードレールに違反したため、旧語彙を維持しました。",
      ...guardrail.errors.map((e) => `・${e}`),
    ];
  }

  await writeAnglesMeta(metaPath, { caseCount, lastAttemptCaseCount: caseCount, generatedAt: new Date().toISOString() });
  gitAddFn([anglesPath, metaPath]);
  const diff = diffAngleLabels(oldAngles, newAngles);
  log(`✅ 切り口語彙を更新: ${oldAngles.length}→${newAngles.length}語彙`);
  return [
    `🔤 切り口語彙を更新: ${oldAngles.length}→${newAngles.length}語彙`,
    `新規: ${diff.added.length ? diff.added.join("、") : "なし"}`,
    `削除: ${diff.removed.length ? diff.removed.join("、") : "なし"}`,
  ];
}

// タイムアウト時、shell:true配下の孫プロセス（例: node scripts/generate-idea-seeds.mjs）が
// killされずに生き残る実機事象（指摘3）への対処。
//
// 当初は spawnSync の組み込み timeout オプションのまま、返ってきた後に
// `taskkill /PID <r.pid> /T /F` を呼ぶ実装を試みたが、実機検証で完全に無効と判明した:
// spawnSync の timeout はNode内部が「トップの子(cmd.exe)をkillしてから」同期的に返ってくる
// ため、呼び出し元がtaskkillを呼ぶ時点でr.pidは既に存在しない
// （`taskkill /PID <死んだpid> /T /F` は "ERROR: ... not found" で何もしない。
// 実機で ping.exe を孫に持つ cmd.exe を用いて確認: 親を先にkillしてから taskkill /T すると
// 孫は生き残ったまま。一方、親がまだ生きている状態で taskkill /T すると孫ごと確実に落ちる）。
// そのため spawnSync ではなく spawn（非同期）＋自前タイマーに切り替え、
// 「プロセスがまだ生きているうちに」taskkillでツリーごと落とす方式にした。
// 過剰設計を避けるため、これ以上のプロセス監視（監視デーモン化・ポーリングでの生存確認等）は
// 行わない単純なタイマー1本の対処に留める。
// taskkill /IM node.exe のような無差別killは本番Studioを巻き込む事故実績があるため厳禁だが、
// /PID指定でのツリーkillは対象PID配下に限定されるため安全（CLAUDE.md参照）。
function killProcessTreeSync(pid) {
  if (!pid) return { attempted: false, ok: false, output: "(PID不明のためkillを試行できません)" };
  const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    cwd: ROOT,
    stdio: "pipe",
    windowsHide: true,
  });
  const output = `${r.stdout ? r.stdout.toString() : ""}${r.stderr ? r.stderr.toString() : ""}`.trim();
  return { attempted: true, ok: r.status === 0, output };
}

// Windowsでshell:true経由のnpm起動が「起動そのものに失敗した(npmがPATH上に無い等)」のか
// 「起動はできたがnpmスクリプト自体が失敗した」のかを判別するためのプリフライト。
// shell:trueでは両者ともr.error=undefined・r.status=1という同一シグネチャになり
// （実機確認済み。指摘1）、r.error/r.statusだけでは区別できない。npm --versionという
// 最小コストの別コマンドを同じshell経由で実行し、それすら失敗するなら「npm自体が
// 解決できない」＝今回の事故（npmがENOENTで起動できない）の再発と判定する。
// 案として、cmd.exeのstderrメッセージ文字列判定（'npm' は…認識されていません 等）も
// 検討したが、Windowsの表示言語・OSバージョンによって文言が変わりうる（本文言は
// 日本語Windows実機のもの）ため、判定条件が壊れやすい。npm --versionの成否という
// 言語非依存の機能的な判定の方が頑健なため、こちらを採用する。
function npmResolvable(env) {
  const p = spawnSync("npm --version", {
    cwd: ROOT,
    stdio: "pipe",
    timeout: 15000,
    shell: true,
    windowsHide: true,
    env,
  });
  return !p.error && p.status === 0;
}

// Windowsでは npm の実体が npm.cmd（バッチファイル）であり、shell:true を渡さない限り
// spawnSync("npm", ...) は ENOENT で即死する（package.json 経由の子プロセス起動が
// 一切成功していなかった根本原因。2026-07-08〜稼働開始以来、dry-run検証は毎回このENOENTで
// 「起動すらしていない」まま false を返し、全ロールバックしていた）。
// scripts/lib/tuneup-angles.mjs の runGenerateIdeaAnglesCli と同じ
// 「process.platform === "win32" で分岐する」流儀を踏襲する。npm.cmd はバッチファイルのため
// （tsxのcli.mjsと違い）process.execPath直接起動では代替できず、shell:true が必須
// （spawnSync("<npm.cmdのフルパス>", [...]) を shell:true 無しで直接起動しても
// EINVAL になることを実機確認済み）。npmScript は本関数呼び出し元（本ファイル内の
// 固定配列リテラル、またはテスト）以外から渡らないため、shell経由でもコマンドインジェクションの
// 実害は無い。
// env/timeoutMsはテスト用の注入ポイント（既定はprocess.env / SUBPIPELINE_TIMEOUT_MS＝
// 本番と同じ）。プリフライトが「npm解決不可」を正しく検出できること、タイムアウト分岐が
// 「起動失敗」と区別してラベルされること・孫プロセスが実際に一掃されることを、それぞれ
// 壊れたPATH・短いtimeoutMsを注入してスモークテストで検証する
// （scripts/smoke-tuneup-dry-subpipeline.mjs参照。45分待つのは非現実的なため、
// タイムアウト検出ロジック自体を短時間で検証するための注入）。
//
// spawnSync の組み込み timeout ではなく spawn(非同期)＋自前タイマーを使う理由は
// killProcessTreeSync のコメント参照（指摘3。トップの子が既に死んだ後ではtaskkillが
// 孫に届かないため）。呼び出し元(scripts/lib/tuneup-apply.mjs)は
// `const result = await step()` と await 前提のため、Promiseを返すこの変更は
// 呼び出し側の変更なしに互換である。
export function runDrySubpipeline(npmScript, { env = process.env, timeoutMs = SUBPIPELINE_TIMEOUT_MS } = {}) {
  log(`── dry-run検証: npm run ${npmScript} ──`);
  const isWindows = process.platform === "win32";

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };

    let child;
    try {
      child = isWindows
        ? spawn(`npm run ${npmScript}`, { cwd: ROOT, stdio: "inherit", shell: true, windowsHide: true, env })
        : spawn("npm", ["run", npmScript], { cwd: ROOT, stdio: "inherit", env });
    } catch (e) {
      // spawn自体が同期throwするのは稀（不正なcwd等）だが、念のため起動失敗として扱う。
      const reason = `${npmScript} (起動失敗: ${e.message})`;
      log(`❌ dry-run検証: npm run ${npmScript} の起動に失敗しました（${e.message}）`);
      resolve({ ok: false, reason });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      const minutes = Math.round(timeoutMs / 60000);
      log(`❌ dry-run検証: npm run ${npmScript} がタイムアウトしました（${minutes}分経過）`);
      if (isWindows && child.pid) {
        // プロセスがまだ生きているうちにtaskkillでツリーごと落とす（指摘3。
        // killProcessTreeSync直上のコメント参照）。
        const killResult = killProcessTreeSync(child.pid);
        log(
          killResult.ok
            ? `　→ プロセスツリーをtaskkillで終了させました（PID ${child.pid}）`
            : `⚠ プロセスツリーのtaskkillに失敗した可能性があります（PID ${child.pid}）: ${killResult.output || "(出力なし)"}`
        );
      } else {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      // "exit"イベントは通常この後に発火するが、万一発火しない場合に備えて
      // タイムアウト結果を確実に返すフォールバックを少し遅らせて仕込む
      // （taskkillでプロセスは既に落ちているはずなので、通常はexitイベントが先に来てここは実行されない）。
      setTimeout(() => {
        const reasonFallback = `${npmScript} (タイムアウト: ${minutes}分)`;
        settle({ ok: false, reason: reasonFallback });
      }, 5000).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (err) => {
      const reason = `${npmScript} (起動失敗: ${err.message})`;
      log(`❌ dry-run検証: npm run ${npmScript} の起動に失敗しました（${err.message}）`);
      settle({ ok: false, reason });
    });

    child.on("exit", (code, signal) => {
      // タイムアウト(上限時間走り切った末のkill)は「起動失敗」「検証失敗」より優先して判定する
      // （指摘2。timedOutフラグはタイマー発火時に立てる）。
      if (timedOut) {
        const minutes = Math.round(timeoutMs / 60000);
        settle({ ok: false, reason: `${npmScript} (タイムアウト: ${minutes}分)` });
        return;
      }

      if (code === 0) {
        log(`✅ dry-run検証: npm run ${npmScript} 成功`);
        settle({ ok: true });
        return;
      }

      if (isWindows) {
        // shell:true経由では「npmが起動できない」も「npmスクリプトが検証に失敗した」も
        // 同一シグネチャ（起動時エラーは出ずexit codeのみ非0）になる（実機確認済み。指摘1）。
        // npm --versionのプリフライトで両者を判別する。
        if (!npmResolvable(env)) {
          const reason = `${npmScript} (起動失敗: npmが解決できません。PATH設定を確認してください)`;
          log(`❌ dry-run検証: npm run ${npmScript} の起動に失敗しました（npm --versionも失敗＝npm解決不可）`);
          settle({ ok: false, reason });
          return;
        }
      }

      const detail = `exit code ${code}${signal ? `, signal ${signal}` : ""}`;
      const reason = `${npmScript} (${detail})`;
      log(`❌ dry-run検証: npm run ${npmScript} が失敗終了しました（${detail}）`);
      settle({ ok: false, reason });
    });
  });
}

function buildReport(lines) {
  return [`🔧 ResearchMan 週次チューンアップ`, "", ...lines, "", `${SITE}`].join("\n");
}

async function main() {
  log(`\nResearchMan 週次チューンアップ`);
  log(`   ${new Date().toLocaleString("ja-JP")}`);
  if (DRY_RUN) log("   ⚠ DRY RUN（設定ファイルは検証後に必ず元へ戻します）");

  const cases = await readJson(CASES_PATH);
  const tech = await readJson(TECH_PATH);
  const ideas = await readJson(IDEAS_PATH);

  // ── 0. 切り口語彙の自動リフレッシュ（要件2）。favorites同期の要否とは独立に判定するため、
  //    favorites取得より前に行う（favorites未設定でスキップされるパスでもリフレッシュ自体は動く）。
  //    コストの大きいClaude呼び出しを伴うため、--dry-runでは呼ばない（他の検証と違い
  //    フィクスチャで済ませず本物のCLIを叩くことになってしまうため。tuneup:dryの目的である
  //    「設定ファイル改訂フローの安価な検証」から外れる）。
  const angleRefreshLines = DRY_RUN ? [] : await maybeRefreshIdeaAngles({ cases });
  const report = (lines) =>
    writeReport(buildReport(angleRefreshLines.length ? [...lines, "", ...angleRefreshLines] : lines));

  // ── 1. favorites取得（＋ごみ箱＝弱化シグナル＋アイデアいいね/ゴミ箱＝アイデア評価シグナル） ──
  let favoritesData;
  let trashedIds = [];
  let likedIdeaIds = [];
  let trashedIdeaIds = [];
  if (DRY_RUN) {
    favoritesData = buildFixtureFavorites(cases, tech);
    log(`🧪 フィクスチャお気に入り${Object.keys(favoritesData.items).length}件を使用`);
    const fixtureTrash = buildFixtureTrash(cases);
    trashedIds = favoriteIds(fixtureTrash.items);
    log(`🧪 フィクスチャごみ箱${trashedIds.length}件を使用`);
    likedIdeaIds = favoriteIds(buildFixtureIdeaLikes(ideas).items);
    log(`🧪 フィクスチャいいねアイデア${likedIdeaIds.length}件を使用`);
    trashedIdeaIds = favoriteIds(buildFixtureIdeaTrash(ideas).items);
    log(`🧪 フィクスチャゴミ箱アイデア${trashedIdeaIds.length}件を使用`);
  } else {
    let favsyncConfig = null;
    try {
      favsyncConfig = JSON.parse(await fs.readFile(FAVSYNC_CONFIG_PATH, "utf-8"));
    } catch {
      log(`同期未設定（${FAVSYNC_CONFIG_PATH} が無い）→ 今回はスキップ`);
      await report([
        "お気に入りサーバ同期が未設定のため、今回の分析をスキップしました。",
        `${FAVSYNC_CONFIG_PATH} に { "endpoint": "...", "token": "..." } を設定してください。`,
      ]);
      await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
      return;
    }
    if (!favsyncConfig?.endpoint || !favsyncConfig?.token) {
      log("同期設定が不完全（endpoint/token欠落）→ 今回はスキップ");
      await report([`${FAVSYNC_CONFIG_PATH} の設定が不完全です（endpoint/tokenを確認してください）。`]);
      await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
      return;
    }
    const res = await httpGetJson(favsyncConfig.endpoint, favsyncConfig.token);
    if (!res.ok) {
      log(`favorites取得失敗: ${res.error}`);
      await report([`❌ お気に入りの取得に失敗しました（${res.error}）。ログを確認してください。`]);
      process.exitCode = 1;
      return;
    }
    favoritesData = res.body;

    // ごみ箱（弱化シグナル）取得。favoritesと同じFAVORITES_SYNC_TOKENを共用する
    // （src/app/api/trash/route.ts参照）。endpointはfavsyncConfig.trashEndpointで明示指定できるが、
    // 未指定ならfavoritesのendpointから /api/favorites → /api/trash を機械的に導出する
    // （設定ファイルを増やさず追従できるため。deriveTrashEndpoint参照）。
    // 導出不可（非標準URL等でderiveTrashEndpointがnullを返した場合）・未設定・エラー・503いずれも
    // 黙ってスキップし、処理全体は落とさない（弱化シグナル無しで続行）。導出不可時にfavoritesの
    // endpointをそのままGETしてしまうとfavoritesのレスポンスをtrashとして誤集計するため、
    // その場合はHTTPリクエスト自体を行わない。
    const trashEndpoint = deriveTrashEndpoint(favsyncConfig.endpoint, favsyncConfig.trashEndpoint);
    if (!trashEndpoint) {
      log("ごみ箱取得スキップ（trashEndpoint導出不可）→ 弱化シグナル無しで続行");
    } else {
      const trashRes = await httpGetJson(trashEndpoint, favsyncConfig.token);
      if (trashRes.ok) {
        trashedIds = favoriteIds(trashRes.body?.items);
        log(`ごみ箱: ${trashedIds.length}件`);
      } else {
        log(`ごみ箱取得スキップ（${trashRes.error}）→ 弱化シグナル無しで続行`);
      }
    }

    // アイデアいいね/ゴミ箱（アイデア評価シグナル）取得。favoritesと同じFAVORITES_SYNC_TOKENを
    // 共用する想定（GET /api/idea-likes・GET /api/idea-trash。別エージェント実装中のAPI契約）。
    // endpointはfavsyncConfig.ideaLikesEndpoint/ideaTrashEndpointで明示指定できるが、未指定なら
    // favoritesのendpointから機械的に導出する（deriveTrashEndpointと同じ流儀。
    // deriveIdeaLikesEndpoint/deriveIdeaTrashEndpoint参照）。導出不可・未設定・エラー・503いずれも
    // 黙ってスキップし、処理全体は落とさない（ごみ箱と同じ縮退方針）。
    const ideaLikesEndpoint = deriveIdeaLikesEndpoint(favsyncConfig.endpoint, favsyncConfig.ideaLikesEndpoint);
    if (!ideaLikesEndpoint) {
      log("いいねアイデア取得スキップ（ideaLikesEndpoint導出不可）→ アイデア評価シグナル無しで続行");
    } else {
      const likesRes = await httpGetJson(ideaLikesEndpoint, favsyncConfig.token);
      if (likesRes.ok) {
        likedIdeaIds = favoriteIds(likesRes.body?.items);
        log(`いいねアイデア: ${likedIdeaIds.length}件`);
      } else {
        log(`いいねアイデア取得スキップ（${likesRes.error}）→ アイデア評価シグナル無しで続行`);
      }
    }
    const ideaTrashEndpoint = deriveIdeaTrashEndpoint(favsyncConfig.endpoint, favsyncConfig.ideaTrashEndpoint);
    if (!ideaTrashEndpoint) {
      log("ゴミ箱アイデア取得スキップ（ideaTrashEndpoint導出不可）→ アイデア評価シグナル無しで続行");
    } else {
      const ideaTrashRes = await httpGetJson(ideaTrashEndpoint, favsyncConfig.token);
      if (ideaTrashRes.ok) {
        trashedIdeaIds = favoriteIds(ideaTrashRes.body?.items);
        log(`ゴミ箱アイデア: ${trashedIdeaIds.length}件`);
      } else {
        log(`ゴミ箱アイデア取得スキップ（${ideaTrashRes.error}）→ アイデア評価シグナル無しで続行`);
      }
    }
  }

  const favIds = favoriteIds(favoritesData?.items);
  log(`お気に入り: ${favIds.length}件`);
  if (!favIds.length) {
    log("お気に入りが0件 → 分析材料なし。今回はスキップ");
    await report(["お気に入りがまだ0件のため、今回の分析をスキップしました。"]);
    if (!DRY_RUN) await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
    return;
  }

  const favStats = computeFavoriteStats({ favIds, cases, tech });
  const ideaStats = computeIdeaStructureStats(ideas);
  const trashStats = computeTrashStats({ trashedIds, cases });
  const userCaseStats = computeUserCaseStats({ cases });
  const ideaFeedbackStats = computeIdeaFeedbackStats({ likedIds: likedIdeaIds, trashedIds: trashedIdeaIds, ideas, cases, tech });

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
      buildPass1Prompt({ favStats, trashStats, userCaseStats, oldResearchTuning, oldXRadarQueries, oldResearchPlan }),
      { timeout: ANALYSIS_TIMEOUT_MS, marker: '"researchTuning"', model: MODEL }
    );
  } catch (e) {
    log(`分析パス1失敗: ${e.message}`);
    await report([`❌ 分析パス1（リサーチ計画）が失敗しました: ${e.message}`]);
    process.exitCode = 1;
    return;
  }
  if (!pass1?.researchTuning || !pass1?.xRadarQueries || !pass1?.researchPlanMarkdown) {
    log("分析パス1の出力が不完全です");
    await report(["❌ 分析パス1（リサーチ計画）の出力が不完全でした。"]);
    process.exitCode = 1;
    return;
  }

  // ── 3. 分析パス2: アイデア構造見直し ──
  log("── 分析パス2: アイデア構造見直し ──");
  let pass2;
  try {
    pass2 = runClaudeJson(claudeBin, buildPass2Prompt({ favStats, ideaStats, ideaFeedbackStats, oldIdeaTuning }), {
      timeout: ANALYSIS_TIMEOUT_MS,
      marker: '"ideaTuning"',
      model: MODEL,
    });
  } catch (e) {
    log(`分析パス2失敗: ${e.message}`);
    await report([`❌ 分析パス2（アイデア構造見直し）が失敗しました: ${e.message}`]);
    process.exitCode = 1;
    return;
  }
  if (!pass2?.ideaTuning) {
    log("分析パス2の出力が不完全です");
    await report(["❌ 分析パス2（アイデア構造見直し）の出力が不完全でした。"]);
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
    await report(["❌ 分析結果がガードレールに違反したため、変更を破棄しました。", "", ...guardrailErrors.map((e) => `・${e}`)]);
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
    await report([`❌ dry-run検証に失敗したため、変更を破棄しました（${applyResult.reason}）。`]);
    process.exitCode = 1;
    return;
  }
  log("dry-run全通し PASS");

  const changeSummaryLines = [
    `お気に入り: 事例${favStats.favoriteCaseCount}件・技術${favStats.favoriteTechCount}件を分析`,
    `ごみ箱(弱化)${trashStats.trashedCaseCount}件・ユーザー追加(強化)${userCaseStats.userCaseCount}件も分析材料に反映`,
    `アイデア評価: いいね${ideaFeedbackStats.likedIdeaCount}件・ゴミ箱${ideaFeedbackStats.trashedIdeaCount}件も分析材料に反映`,
    `変更: レーン/角度${researchCheck.laneChanges}件・Xクエリ${queriesCheck.queryChanges}件・重み${ideaCheck.weightChanges}件`,
    "",
    "【リサーチ計画】" + (pass1.rationale || "(理由の記載なし)"),
    "【アイデア構造】" + (pass2.rationale || "(理由の記載なし)"),
  ];

  if (DRY_RUN) {
    log("✅ --dry-run: 全ガードレール・dry-run検証を通過。設定ファイルは元に戻しました（コミットしません）");
    await report(["✅ --dry-run 全経路PASS（コミットはしていません）", "", ...changeSummaryLines]);
    return;
  }

  await report(["✅ 分析・検証が完了しました。反映します。", "", ...changeSummaryLines]);
  await fs.writeFile(LAST_RUN_PATH, new Date().toISOString());
  log("✅ 完了（commit/push/通知は run-job.mjs 側で実行）");
}

// smoke-tuneup-angles.mjsからmaybeRefreshIdeaAnglesをimportして検証できるよう、
// スクリプトとして直接実行された場合のみmain()を起動する（importだけではmain()が
// 走らないようにするガード。run-job.mjs経由の本番実行(spawnSync(NODE_BIN, [絶対パス, ...]))・
// `node scripts/biweekly-tuneup.mjs`実行時の挙動は変えない）。
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
      console.error("\n❌ エラー:", e.message);
      process.exit(1);
    });
}
