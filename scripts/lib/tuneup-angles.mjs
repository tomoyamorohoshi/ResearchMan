/**
 * 週次チューンアップ（scripts/biweekly-tuneup.mjs）: 切り口語彙（data/idea-angles.json）の
 * 自動リフレッシュ判定・機械ガードレール・再生成CLI呼び出し。
 *
 * 切り口語彙の生成・検証ロジック本体は studio/server/pipeline/ideaAngles.ts にあるが、
 * studio/ は編集対象外（AGENTS.md方針）かつ biweekly-tuneup.mjs は素のnode実行（tsx経由ではない）
 * のためTS実装を直接importできない。ここではstudio側の内部検証（validateIdeaAngles）を無条件に
 * 信用せず、チューンアップ側で独立にもう一段ガードレールをかける
 * （tuneup-guardrails.mjsと同じ「LLM出力は無検証で信用しない」方針を踏襲）:
 *   (a) 語彙数15〜25 (b) 各exemplarCaseIdsが実在id (c) 旧語彙との入れ替わり率が80%以下
 *
 * 入れ替わり判定はid/label文字列の完全一致ではなくexemplarCaseIdsの重なり(Jaccard係数)で行う。
 * 語彙はAgent SDKで毎回ゼロから生成し直されるため、同じ発想の型でもid/labelの文言は変わりうるが、
 * exemplarCaseIdsはcases.json由来の安定したid集合であり、同じ発想の型なら重なりやすいため。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

// studio/server/pipeline/ideaAngles.ts の MIN_ANGLES/MAX_ANGLES と同じ値（DESIGN.md §6 idea）。
// importはできないためチューンアップ側で独立に保持する（studio側が将来変更しても、ここは
// 「壊れていないか」を疑う立場のガードレールなので同期を強制しない）。
const MIN_ANGLES = 15;
const MAX_ANGLES = 25;
const TURNOVER_RATE_MAX = 0.8;
const REFRESH_CASE_COUNT_DELTA = 50;
const OVERLAP_MATCH_THRESHOLD = 0.5;
const DEFAULT_CLI_TIMEOUT_MS = 15 * 60 * 1000; // cases.json全件を読み込み最大3回リトライしうるため長め

/**
 * cases.json件数が前回語彙生成時（data/idea-angles-meta.json）から+50件以上増えていればtrue。
 * meta未設定（初回）はfalseを返す（呼び出し側はこれを「ベースライン記録のみ行い、
 * いきなり再生成はしない」の合図として扱う）。
 */
export function shouldRefreshAngles(caseCount, meta) {
  if (!meta || typeof meta.caseCount !== "number") return false;
  return caseCount - meta.caseCount >= REFRESH_CASE_COUNT_DELTA;
}

function jaccard(a, b) {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 新旧の切り口をexemplarCaseIdsの重なりで対応付け、旧語彙のうち新語彙に「生き残った」ものが
 * 無い割合（入れ替わり率）を返す。旧語彙が0件なら入れ替わりようがないので0を返す。
 */
export function computeAngleTurnoverRate(oldAngles, newAngles) {
  const old = oldAngles || [];
  const next = newAngles || [];
  if (old.length === 0) return 0;
  let survived = 0;
  for (const oldAngle of old) {
    const hasMatch = next.some(
      (newAngle) => jaccard(oldAngle.exemplarCaseIds, newAngle.exemplarCaseIds) >= OVERLAP_MATCH_THRESHOLD
    );
    if (hasMatch) survived++;
  }
  return 1 - survived / old.length;
}

/**
 * 新旧を突き合わせ、新規に現れたlabel・消えたlabelを返す（LINE報告用）。
 * 判定基準はcomputeAngleTurnoverRateと同じexemplarCaseIdsの重なり。
 */
export function diffAngleLabels(oldAngles, newAngles) {
  const old = oldAngles || [];
  const next = newAngles || [];
  const matchedOld = new Set();
  const matchedNew = new Set();
  old.forEach((oldAngle, i) => {
    next.forEach((newAngle, j) => {
      if (matchedNew.has(j)) return;
      if (jaccard(oldAngle.exemplarCaseIds, newAngle.exemplarCaseIds) >= OVERLAP_MATCH_THRESHOLD) {
        matchedOld.add(i);
        matchedNew.add(j);
      }
    });
  });
  const added = next.filter((_, j) => !matchedNew.has(j)).map((a) => a.label);
  const removed = old.filter((_, i) => !matchedOld.has(i)).map((a) => a.label);
  return { added, removed };
}

/**
 * 再生成後の切り口語彙を機械検証する: (a)件数15〜25 (b)各exemplarCaseIdsが実在id
 * (c)旧語彙との入れ替わり率が80%以下。いずれか違反で ok:false（呼び出し側は旧語彙を維持する）。
 * @returns {{ok: boolean, errors: string[], turnoverRate: number|null}}
 */
export function checkAnglesGuardrail({ oldAngles, newAngles, validCaseIds }) {
  const errors = [];
  if (!Array.isArray(newAngles)) {
    return { ok: false, errors: ["切り口語彙が配列ではありません"], turnoverRate: null };
  }
  if (newAngles.length < MIN_ANGLES || newAngles.length > MAX_ANGLES) {
    errors.push(`切り口語彙数が範囲外です[${MIN_ANGLES},${MAX_ANGLES}]: ${newAngles.length}`);
  }
  newAngles.forEach((angle, i) => {
    const ids = angle?.exemplarCaseIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      errors.push(`newAngles[${i}](${angle?.id ?? "?"})のexemplarCaseIdsが空です`);
      return;
    }
    const invalid = ids.filter((id) => !validCaseIds.has(id));
    if (invalid.length > 0) {
      errors.push(`newAngles[${i}](${angle?.id ?? "?"})のexemplarCaseIdsに実在しないidがあります: ${invalid.join(",")}`);
    }
  });
  const turnoverRate = computeAngleTurnoverRate(oldAngles, newAngles);
  if (turnoverRate > TURNOVER_RATE_MAX) {
    errors.push(
      `旧語彙との入れ替わり率が上限を超えました(${(turnoverRate * 100).toFixed(0)}% > ${TURNOVER_RATE_MAX * 100}%)`
    );
  }
  return { ok: errors.length === 0, errors, turnoverRate };
}

/**
 * data/idea-angles-meta.json（前回語彙生成時のcases.json件数・生成日時）を読む。
 * 無い・壊れている場合はnull（呼び出し側はこれを「初回」として扱い、ベースライン記録のみ行う）。
 */
export async function readAnglesMeta(metaPath, { readFileFn = fsPromises.readFile } = {}) {
  try {
    const raw = await readFileFn(metaPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.caseCount !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** data/idea-angles-meta.json へ書き込む。 */
export async function writeAnglesMeta(metaPath, meta, { writeFileFn = fsPromises.writeFile } = {}) {
  await writeFileFn(metaPath, JSON.stringify(meta, null, 2) + "\n");
}

/**
 * studio/server/pipeline/generateIdeaAnglesCli.ts を子プロセス実行し、data/idea-angles.json を
 * 再生成する。studio/は編集対象外のため既存CLIをそのまま呼び出すだけに留める。Windowsタスク
 * スケジューラ環境はPATHが最小構成でnpx解決に失敗するため、
 * scripts/lib/run-idea-layouts-precompute.mjsと同じ「ローカルインストール済みtsxを
 * process.execPath経由で直接起動し、未インストール時のみnpxにフォールバックする」方針を踏襲する。
 * spawnFn/existsSyncFnを注入可能にし、実プロセス起動・実Claude呼び出しなしにコマンド選択・
 * 成功/失敗判定を単体検証できる（scripts/smoke-tuneup-angles.mjs参照）。
 */
export function runGenerateIdeaAnglesCli({
  rootDir,
  spawnFn = spawnSync,
  existsSyncFn = fs.existsSync,
  timeoutMs = DEFAULT_CLI_TIMEOUT_MS,
}) {
  const studioDir = path.join(rootDir, "studio");
  const localTsxCli = path.join(studioDir, "node_modules", "tsx", "dist", "cli.mjs");
  const cliScript = path.join("server", "pipeline", "generateIdeaAnglesCli.ts");
  const useLocalTsx = existsSyncFn(localTsxCli);
  const isWindows = process.platform === "win32";
  const [command, args, spawnOpts] = useLocalTsx
    ? [process.execPath, [localTsxCli, cliScript], {}]
    : [isWindows ? "npx.cmd" : "npx", ["tsx", cliScript], { shell: isWindows }];

  const result = spawnFn(command, args, {
    cwd: studioDir,
    encoding: "utf-8",
    stdio: "inherit",
    timeout: timeoutMs,
    env: process.env,
    ...spawnOpts,
  });
  return Boolean(result) && !result.error && result.status === 0;
}
