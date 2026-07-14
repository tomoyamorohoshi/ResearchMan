// scripts/audit-award.mjs（汎用アワード監査エンジン）の単体検証（TDD: 実装前にこのテストを書き、
// audit-award.mjsが存在しない/未実装の状態で失敗することを確認してから実装した）。
// runAudit を refWinners/caseRecords（インメモリ配列）で直接呼び出す。ディスクI/Oは使わない。
// 実行: node scripts/smoke-audit-award.mjs
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import { spawnSync } from "child_process";
import { runAudit } from "./audit-award.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const AWARD_PREFIX = "TestAward 2099";

// ── 1. 網羅性FAIL: refにあってcasesに無いwinnerがあるとmissing検出・exitCode 1 ──
{
  const refWinners = [{ category: "Film", level: "Gold", title: "Missing Movie", brand: "BrandX" }];
  const caseRecords = [];
  const r = runAudit({ refWinners, caseRecords, awardPrefix: AWARD_PREFIX, label: AWARD_PREFIX });
  assert(r.report.missing.length === 1, `missingに1件検出される (got ${r.report.missing.length})`);
  assert(r.exitCode === 1, `網羅性FAILでexitCode=1 (got ${r.exitCode})`);
}

// ── 2. レベル不一致FAIL: verifiedCategories内の部門でref側とcases側のレベルが食い違うとFAIL ──
{
  const refWinners = [{ category: "Film", level: "Gold", title: "Matched Ad", brand: "BrandY" }];
  const caseRecords = [
    { id: "case-1", title: "Matched Ad", client: "BrandY", award: `${AWARD_PREFIX} Film Silver` },
  ];
  const r = runAudit({
    refWinners,
    caseRecords,
    awardPrefix: AWARD_PREFIX,
    verifiedCategories: ["Film"],
    label: AWARD_PREFIX,
  });
  assert(r.report.missing.length === 0, `一致した事例はmissingにならない (got ${r.report.missing.length})`);
  assert(r.report.levelMismatches.length === 1, `levelMismatchesに1件検出される (got ${r.report.levelMismatches.length})`);
  assert(r.exitCode === 1, `公式照合済み部門のレベル不一致でexitCode=1 (got ${r.exitCode})`);
}

// ── 3. 未検証部門WARN: verifiedCategoriesに含まれない部門でのレベル不一致はexitCode 0のまま ──
{
  const refWinners = [{ category: "Design", level: "Gold", title: "Matched Design Ad", brand: "BrandW" }];
  const caseRecords = [
    { id: "case-2", title: "Matched Design Ad", client: "BrandW", award: `${AWARD_PREFIX} Design Bronze` },
  ];
  const r = runAudit({
    refWinners,
    caseRecords,
    awardPrefix: AWARD_PREFIX,
    verifiedCategories: ["Film"], // Designは未検証部門
    label: AWARD_PREFIX,
  });
  assert(r.report.levelMismatches.length === 1, `未検証部門でもlevelMismatchesは検出される (got ${r.report.levelMismatches.length})`);
  assert(r.exitCode === 0, `未検証部門のレベル不一致はWARN止まりでexitCode=0 (got ${r.exitCode})`);
}

// ── 4. --strict昇格: 3のケースでstrict:trueにするとexitCode 1になる ──
{
  const refWinners = [{ category: "Design", level: "Gold", title: "Matched Design Ad", brand: "BrandW" }];
  const caseRecords = [
    { id: "case-2", title: "Matched Design Ad", client: "BrandW", award: `${AWARD_PREFIX} Design Bronze` },
  ];
  const r = runAudit({
    refWinners,
    caseRecords,
    awardPrefix: AWARD_PREFIX,
    verifiedCategories: ["Film"],
    strict: true,
    label: AWARD_PREFIX,
  });
  assert(r.exitCode === 1, `strict:trueで未検証部門のレベル不一致もexitCode=1に昇格 (got ${r.exitCode})`);
}

// ── 5. 全PASS: 矛盾なしのフィクスチャでexitCode 0・missing/levelMismatches/extraSegments全て空 ──
{
  const refWinners = [{ category: "Film", level: "Gold", title: "Perfect Ad", brand: "BrandZ" }];
  const caseRecords = [
    { id: "case-p", title: "Perfect Ad", client: "BrandZ", award: `${AWARD_PREFIX} Film Gold` },
  ];
  const r = runAudit({
    refWinners,
    caseRecords,
    awardPrefix: AWARD_PREFIX,
    verifiedCategories: ["Film"],
    label: AWARD_PREFIX,
  });
  assert(r.report.missing.length === 0, `全PASSでmissingが空 (got ${r.report.missing.length})`);
  assert(r.report.levelMismatches.length === 0, `全PASSでlevelMismatchesが空 (got ${r.report.levelMismatches.length})`);
  assert(r.report.extraSegments.length === 0, `全PASSでextraSegmentsが空 (got ${r.report.extraSegments.length})`);
  assert(r.exitCode === 0, `全PASSでexitCode=0 (got ${r.exitCode})`);
}

// ── 6. CLI経由でref JSON側verifiedCategoriesフォールバックが実際に発火する ──
// (レビュー指摘: CLIブロックが--verified-categories未指定時に空配列[]を明示的に渡すと、
//  runAudit内の`options.verifiedCategories !== undefined`が常にtrueになりフォールバックが
//  永久に発火しない。--verified-categoriesを付けずにCLIを実行し、ref JSON側の
//  verifiedCategoriesフィールド経由でレベル不一致がFAIL(exitCode 1)に昇格することを確認する)
{
  const tmpDir = os.tmpdir();
  const refPath = path.join(tmpDir, `audit-award-smoke-ref-${process.pid}.json`);
  const casesPath = path.join(tmpDir, `audit-award-smoke-cases-${process.pid}.json`);
  const cliAwardPrefix = "TestAward 2099";
  fs.writeFileSync(
    refPath,
    JSON.stringify({
      winners: [{ category: "Film", level: "Gold", title: "Matched Ad CLI", brand: "BrandCLI" }],
      verifiedCategories: ["Film"],
    })
  );
  fs.writeFileSync(
    casesPath,
    JSON.stringify([
      { id: "case-cli-1", title: "Matched Ad CLI", client: "BrandCLI", award: `${cliAwardPrefix} Film Silver` },
    ])
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "audit-award.mjs"), "--ref", refPath, "--award-prefix", cliAwardPrefix, "--cases", casesPath],
      { encoding: "utf8" }
    );
    assert(
      result.status === 1,
      `--verified-categories未指定でもref JSON側verifiedCategories経由でレベル不一致がFAIL(exitCode 1)になる (got ${result.status})`
    );
  } finally {
    fs.unlinkSync(refPath);
    fs.unlinkSync(casesPath);
  }
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: audit-award");
}
