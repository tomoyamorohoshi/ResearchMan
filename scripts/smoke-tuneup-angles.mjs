// scripts/lib/tuneup-angles.mjs の単体検証（TDD: 実装前にこのテストを書き、失敗を確認してから実装した）。
// 週次チューンアップの「切り口語彙の自動リフレッシュ」（+50件条件判定・機械ガードレール・
// メタファイル読み書き・再生成CLI呼び出しラッパー）を、実プロセス起動・実Claude呼び出しなしに
// 純関数/注入可能な依存で検証する。
// 実行: node scripts/smoke-tuneup-angles.mjs
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  shouldRefreshAngles,
  computeAngleTurnoverRate,
  diffAngleLabels,
  checkAnglesGuardrail,
  readAnglesMeta,
  writeAnglesMeta,
  runGenerateIdeaAnglesCli,
} from "./lib/tuneup-angles.mjs";
import { maybeRefreshIdeaAngles } from "./biweekly-tuneup.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// ── shouldRefreshAngles: +50件条件の判定 ──
{
  assert(shouldRefreshAngles(150, null) === false, "meta未設定(初回)は再生成しない");
  assert(shouldRefreshAngles(150, { caseCount: 100 }) === true, "+50件以上でtrue");
  assert(shouldRefreshAngles(149, { caseCount: 100 }) === false, "+49件はfalse(閾値未達)");
  assert(shouldRefreshAngles(90, { caseCount: 100 }) === false, "件数が減っていてもfalse");
}

// ── computeAngleTurnoverRate: exemplarCaseIdsの重なりで生き残り判定 ──
{
  const oldAngles = [
    { id: "a", label: "A", exemplarCaseIds: ["c1", "c2", "c3"] },
    { id: "b", label: "B", exemplarCaseIds: ["c4", "c5"] },
  ];
  assert(computeAngleTurnoverRate([], []) === 0, "旧語彙が0件なら入れ替わり率0");

  const fullSurvive = [
    { id: "a2", label: "A2", exemplarCaseIds: ["c1", "c2", "c3", "c9"] },
    { id: "b2", label: "B2", exemplarCaseIds: ["c4", "c5"] },
  ];
  assert(computeAngleTurnoverRate(oldAngles, fullSurvive) === 0, "全て生き残れば入れ替わり率0");

  const fullTurnover = [
    { id: "x", label: "X", exemplarCaseIds: ["z1", "z2"] },
    { id: "y", label: "Y", exemplarCaseIds: ["z3", "z4"] },
  ];
  assert(computeAngleTurnoverRate(oldAngles, fullTurnover) === 1, "重なりが皆無なら入れ替わり率1");

  const partialSurvive = [
    { id: "a3", label: "A3", exemplarCaseIds: ["c1", "c2", "c3"] }, // aと一致
    { id: "z", label: "Z", exemplarCaseIds: ["z1", "z2"] },
  ];
  assert(computeAngleTurnoverRate(oldAngles, partialSurvive) === 0.5, `2件中1件生存で入れ替わり率0.5 (got ${computeAngleTurnoverRate(oldAngles, partialSurvive)})`);
}

// ── diffAngleLabels: 新規/削除labelの抽出 ──
{
  const oldAngles = [
    { id: "a", label: "見立て", exemplarCaseIds: ["c1", "c2"] },
    { id: "b", label: "引き算", exemplarCaseIds: ["c3", "c4"] },
  ];
  const newAngles = [
    { id: "a2", label: "見立て変換", exemplarCaseIds: ["c1", "c2", "c9"] }, // aと重なる→生存扱い
    { id: "c", label: "新概念", exemplarCaseIds: ["c10", "c11"] }, // 完全新規
  ];
  const diff = diffAngleLabels(oldAngles, newAngles);
  assert(JSON.stringify(diff.added) === JSON.stringify(["新概念"]), `新規labelを検出 (${JSON.stringify(diff.added)})`);
  assert(JSON.stringify(diff.removed) === JSON.stringify(["引き算"]), `削除labelを検出 (${JSON.stringify(diff.removed)})`);
}

// ── checkAnglesGuardrail: (a)件数15〜25 (b)実在id (c)入れ替わり率≤80% ──
{
  const validCaseIds = new Set(Array.from({ length: 30 }, (_, i) => `c${i}`));
  const makeAngles = (n, { exemplars = ["c0", "c1"] } = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: `L${i}`, exemplarCaseIds: exemplars }));

  const oldAngles = makeAngles(20);

  // 正常系: 件数20・実在id・旧語彙が空(入れ替わり率0)
  {
    const r = checkAnglesGuardrail({ oldAngles: [], newAngles: makeAngles(20), validCaseIds });
    assert(r.ok === true, `正常系は受理される (${JSON.stringify(r.errors)})`);
  }

  // (a) 件数が少なすぎる(10件)
  {
    const r = checkAnglesGuardrail({ oldAngles: [], newAngles: makeAngles(10), validCaseIds });
    assert(r.ok === false, "10件(下限15未満)は拒否される");
  }

  // (a) 件数が多すぎる(30件)
  {
    const r = checkAnglesGuardrail({ oldAngles: [], newAngles: makeAngles(30), validCaseIds });
    assert(r.ok === false, "30件(上限25超)は拒否される");
  }

  // (b) 実在しないexemplarCaseIdsを含む
  {
    const badAngles = makeAngles(20);
    badAngles[0] = { ...badAngles[0], exemplarCaseIds: ["not-a-real-id"] };
    const r = checkAnglesGuardrail({ oldAngles: [], newAngles: badAngles, validCaseIds });
    assert(r.ok === false, "実在しないexemplarCaseIdsを含むと拒否される");
  }

  // (b) exemplarCaseIdsが空
  {
    const badAngles = makeAngles(20);
    badAngles[0] = { ...badAngles[0], exemplarCaseIds: [] };
    const r = checkAnglesGuardrail({ oldAngles: [], newAngles: badAngles, validCaseIds });
    assert(r.ok === false, "exemplarCaseIdsが空だと拒否される");
  }

  // (c) 入れ替わり率が80%を超える(旧20件中、新語彙と全く重ならない→100%)
  {
    const newAngles = makeAngles(20, { exemplars: ["c20", "c21"] }); // oldAnglesの["c0","c1"]と重ならない
    const r = checkAnglesGuardrail({ oldAngles, newAngles, validCaseIds });
    assert(r.ok === false, `入れ替わり率100%は拒否される (turnoverRate=${r.turnoverRate})`);
  }

  // (c) 入れ替わり率が80%以下なら許容(旧20件中、一致するexemplarsを持つものを含める)
  {
    const newAngles = makeAngles(20, { exemplars: ["c0", "c1"] }); // oldAnglesと同じexemplars→全生存
    const r = checkAnglesGuardrail({ oldAngles, newAngles, validCaseIds });
    assert(r.ok === true, `入れ替わり率0%(全生存)は受理される (${JSON.stringify(r.errors)})`);
  }

  // newAnglesが配列でない
  {
    const r = checkAnglesGuardrail({ oldAngles: [], newAngles: "not-an-array", validCaseIds });
    assert(r.ok === false, "newAnglesが配列でなければ拒否される");
  }
}

// ── readAnglesMeta / writeAnglesMeta: メタファイルの読み書き(実temp fileで往復検証) ──
async function runMetaTests() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "researchman-angles-meta-"));
  const metaPath = path.join(tmpDir, "idea-angles-meta.json");

  const missing = await readAnglesMeta(metaPath);
  assert(missing === null, "存在しないメタファイルはnullを返す");

  const meta = { caseCount: 123, generatedAt: "2026-07-16T00:00:00.000Z" };
  await writeAnglesMeta(metaPath, meta);
  const roundTrip = await readAnglesMeta(metaPath);
  assert(roundTrip && roundTrip.caseCount === 123, `書き込んだメタを読み戻せる (${JSON.stringify(roundTrip)})`);

  await fs.writeFile(metaPath, "{ not valid json");
  const corrupted = await readAnglesMeta(metaPath);
  assert(corrupted === null, "壊れたJSONはnullを返す(throwしない)");

  await fs.rm(tmpDir, { recursive: true, force: true });
}

// ── runGenerateIdeaAnglesCli: spawn呼び出しの組み立て(注入したspawnFn/existsSyncFnで実プロセスなし検証) ──
{
  const ok = runGenerateIdeaAnglesCli({
    rootDir: "/fake/root",
    spawnFn: () => ({ error: null, status: 0 }),
    existsSyncFn: () => true,
  });
  assert(ok === true, "spawn成功(status=0)ならtrueを返す");

  const fail = runGenerateIdeaAnglesCli({
    rootDir: "/fake/root",
    spawnFn: () => ({ error: null, status: 1 }),
    existsSyncFn: () => true,
  });
  assert(fail === false, "spawn失敗(status非0)ならfalseを返す");

  const errored = runGenerateIdeaAnglesCli({
    rootDir: "/fake/root",
    spawnFn: () => ({ error: new Error("ENOENT"), status: null }),
    existsSyncFn: () => true,
  });
  assert(errored === false, "spawn自体がerrorを持てばfalseを返す");

  let captured = null;
  const capture = (command, args, opts) => {
    captured = { command, args, opts };
    return { error: null, status: 0 };
  };
  runGenerateIdeaAnglesCli({ rootDir: "/fake/root", spawnFn: capture, existsSyncFn: () => true });
  assert(captured.command === process.execPath, `ローカルtsx存在時はprocess.execPathを使う (got ${captured.command})`);
  assert(
    path.normalize(captured.opts.cwd) === path.normalize(path.join("/fake/root", "studio")),
    `cwdはstudio配下 (got ${captured.opts.cwd})`
  );

  let captured2 = null;
  const capture2 = (command, args, opts) => {
    captured2 = { command, args, opts };
    return { error: null, status: 0 };
  };
  runGenerateIdeaAnglesCli({ rootDir: "/fake/root", spawnFn: capture2, existsSyncFn: () => false });
  const expectedFallback = process.platform === "win32" ? "npx.cmd" : "npx";
  assert(captured2.command === expectedFallback, `ローカルtsx不在時はnpxにフォールバック (got ${captured2.command})`);
}

await runMetaTests();

// ── maybeRefreshIdeaAngles: meta不存在の初回パス(ベースライン記録)でも、
//    metaファイル自体はgit addされること(修正1: 初回パスのgit add漏れの回帰防止) ──
async function runMaybeRefreshBaselineTest() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "researchman-angles-baseline-"));
  const metaPath = path.join(tmpDir, "idea-angles-meta.json"); // 未作成 → meta不存在の初回パスを踏む

  let addedPaths = null;
  const spyGitAdd = (paths) => {
    addedPaths = paths;
  };

  const cases = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));
  const lines = await maybeRefreshIdeaAngles({ cases, metaPath, gitAddFn: spyGitAdd });

  assert(Array.isArray(lines) && lines.length === 0, "初回パスはLINE報告行を追加しない");
  assert(addedPaths !== null, "初回パス(meta不存在)でもgitAddが呼ばれる(修正1)");
  assert(
    Array.isArray(addedPaths) && addedPaths.includes(metaPath),
    `gitAddの引数にmetaPathを含む (got ${JSON.stringify(addedPaths)})`
  );

  const written = await readAnglesMeta(metaPath);
  assert(written && written.caseCount === 10, `ベースラインメタが書き込まれている (got ${JSON.stringify(written)})`);

  await fs.rm(tmpDir, { recursive: true, force: true });
}

await runMaybeRefreshBaselineTest();

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-angles");
}
