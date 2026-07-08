/**
 * scripts/lib/deploy-health.mjs のスモークテスト。
 *
 * 実際の vercel CLI・git revert・git push は一切呼ばない。`vercel ls` / `vercel inspect --logs`
 * の実出力サンプル（researchman-ops-routine.md に掲載）を fixture 文字列として埋め込み、
 * パース・分類ロジックのみを検証する（ユニットテスト）。
 *
 * 使い方: node scripts/smoke-watchdog-deploy-health.mjs
 */
import assert from "assert";
import {
  parseVercelLsOutput,
  extractCommitFromInspectLogs,
  extractBuildErrorLines,
  classifyDeployHealth,
} from "./lib/deploy-health.mjs";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

// ── fixture: 正常系（vercel ls research-man の実出力サンプル） ──
const VERCEL_LS_OK = `
  Age     Project                           Deployment                                                 Status      Environment     Duration     Username

  2m      tomoyamorohoshii/research-man     https://research-kb9jf86en-tomoyamorohoshii.vercel.app     ● Ready     Production      1m           tomoyamorohoshi
  57m     tomoyamorohoshii/research-man     https://research-euig19pes-tomoyamorohoshii.vercel.app     ● Ready     Production      1m           tomoyamorohoshi
  6h      tomoyamorohoshii/research-man     https://research-d0wj7akvn-tomoyamorohoshii.vercel.app     ● Error     Production      27m          tomoyamorohoshi
`;

// ── fixture: 異常系（最新Productionが Error） ──
const VERCEL_LS_ERROR_LATEST = `
  Age     Project                           Deployment                                                 Status      Environment     Duration     Username

  2m      tomoyamorohoshii/research-man     https://research-abc123xyz-tomoyamorohoshii.vercel.app     ● Error     Production      27m          tomoyamorohoshi
  1h      tomoyamorohoshii/research-man     https://research-def456uvw-tomoyamorohoshii.vercel.app     ● Ready     Production      1m           tomoyamorohoshi
`;

// ── fixture: vercel inspect <url> --logs の実出力サンプル（ビルド失敗時） ──
const VERCEL_INSPECT_LOGS_FAIL = `2026-07-08T06:54:09.695Z  Build machine configuration: 2 cores, 8 GB
2026-07-08T06:54:09.796Z  Cloning github.com/tomoyamorohoshi/ResearchMan (Branch: main, Commit: 68fd009)
2026-07-08T06:54:12.001Z  Running "npm run build"
2026-07-08T06:59:09.001Z  Failed to build /ideas/page: /ideas after 3 attempts.
2026-07-08T06:59:09.100Z  Error: Command "npm run build" exited with 1
`;

check("parseVercelLsOutput: 正常系で3行を正しくパースする", () => {
  const rows = parseVercelLsOutput(VERCEL_LS_OK);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].status, "Ready");
  assert.strictEqual(rows[0].environment, "Production");
  assert.strictEqual(rows[0].url, "https://research-kb9jf86en-tomoyamorohoshii.vercel.app");
  assert.strictEqual(rows[2].status, "Error");
});

check("parseVercelLsOutput: 最新Productionの判定は先頭行", () => {
  const rows = parseVercelLsOutput(VERCEL_LS_OK);
  const latestProd = rows.filter((r) => r.environment === "Production")[0];
  assert.strictEqual(latestProd.status, "Ready");
  assert.strictEqual(latestProd.age, "2m");
});

check("extractCommitFromInspectLogs: Cloning行からコミットハッシュを抽出", () => {
  const commit = extractCommitFromInspectLogs(VERCEL_INSPECT_LOGS_FAIL);
  assert.strictEqual(commit, "68fd009");
});

check("extractCommitFromInspectLogs: マッチしない場合はnull", () => {
  assert.strictEqual(extractCommitFromInspectLogs("no commit info here"), null);
  assert.strictEqual(extractCommitFromInspectLogs(""), null);
  assert.strictEqual(extractCommitFromInspectLogs(null), null);
});

check("extractBuildErrorLines: Failed to build行とError: Command行を抽出", () => {
  const lines = extractBuildErrorLines(VERCEL_INSPECT_LOGS_FAIL, 10);
  assert.ok(lines.some((l) => /Failed to build/.test(l)), `Failed to build行が見つからない: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => /Error: Command "npm run build" exited with 1/.test(l)), `Error: Command行が見つからない: ${JSON.stringify(lines)}`);
});

check("extractBuildErrorLines: maxで件数制限される", () => {
  const bigText = Array.from({ length: 20 }, (_, i) => `Error: Command "step${i}" exited with 1`).join("\n");
  const lines = extractBuildErrorLines(bigText, 5);
  assert.strictEqual(lines.length, 5);
});

check("classifyDeployHealth: latestDeploymentがnullならunknown・anomaly false", () => {
  const r = classifyDeployHealth({ latestDeployment: null, vercelBin: null, localOriginHead: null });
  assert.strictEqual(r.status, "unknown");
  assert.strictEqual(r.anomaly, false);
});

check("classifyDeployHealth: 最新ProductionがErrorならanomaly true（vercel CLI呼び出しなし）", () => {
  const rows = parseVercelLsOutput(VERCEL_LS_ERROR_LATEST);
  const latest = rows.filter((r) => r.environment === "Production")[0];
  assert.strictEqual(latest.status, "Error");
  // vercelBin/localOriginHeadがあってもError判定はgetDeploymentCommitを呼ばずに即anomalyになる
  // （実CLI呼び出しゼロでこのテストが成立することがポイント）
  const r = classifyDeployHealth({ latestDeployment: latest, vercelBin: null, localOriginHead: "deadbeef" });
  assert.strictEqual(r.status, "error");
  assert.strictEqual(r.anomaly, true);
});

check("classifyDeployHealth: ReadyでvercelBin未指定ならok（stale判定をスキップ）", () => {
  const rows = parseVercelLsOutput(VERCEL_LS_OK);
  const latest = rows.filter((r) => r.environment === "Production")[0];
  const r = classifyDeployHealth({ latestDeployment: latest, vercelBin: null, localOriginHead: null });
  assert.strictEqual(r.status, "ok");
  assert.strictEqual(r.anomaly, false);
});

console.log(`\n${passed}件PASS`);
if (process.exitCode) {
  console.error("FAIL: 上記のテストが失敗しました");
} else {
  console.log("ALL PASS");
}
