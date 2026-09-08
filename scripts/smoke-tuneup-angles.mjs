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

// tuneup-angles.mjs内部のTURNOVER_RATE_MAX(0.8)と同じ値。importできない定数のためテスト側で
// 独立に保持する（tuneup-angles.mjs自身がstudio側のMIN_ANGLES/MAX_ANGLESを独立保持するのと同じ方針）。
const TURNOVER_RATE_MAX_FOR_TEST = 0.8;

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

  // lastAttemptCaseCountがあればcaseCountではなくそちらを基準点にする（デッドロック解消の核）。
  assert(
    shouldRefreshAngles(704, { caseCount: 605, lastAttemptCaseCount: 655 }) === false,
    "lastAttemptCaseCount基準(655)からは+49件でfalse"
  );
  assert(
    shouldRefreshAngles(705, { caseCount: 605, lastAttemptCaseCount: 655 }) === true,
    "lastAttemptCaseCount基準(655)からは+50件でtrue"
  );
  // 後方互換: lastAttemptCaseCountが無い旧形式metaはcaseCountにフォールバック
  assert(
    shouldRefreshAngles(654, { caseCount: 605 }) === false,
    "lastAttemptCaseCount無し(旧形式)はcaseCount基準(605)で+49件false"
  );
  assert(
    shouldRefreshAngles(655, { caseCount: 605 }) === true,
    "lastAttemptCaseCount無し(旧形式)はcaseCount基準(605)で+50件true"
  );
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

// ── computeAngleTurnoverRate: idベース判定の拡張（本修正の本体） ──
{
  // (1) idが一致すればexemplarCaseIdsが完全に入れ替わっていても生存と判定される
  const oldById = [{ id: "mitate", label: "見立て", exemplarCaseIds: ["c1", "c2"] }];
  const newByIdSameId = [{ id: "mitate", label: "見立て(改訂)", exemplarCaseIds: ["c99", "c100"] }]; // exemplar totally different
  assert(
    computeAngleTurnoverRate(oldById, newByIdSameId) === 0,
    `id一致ならexemplarCaseIdsが完全入替でも生存(入れ替わり率0) (got ${computeAngleTurnoverRate(oldById, newByIdSameId)})`
  );

  // (2) idが違ってもexemplarが重なれば生存と判定される（従来挙動の維持）
  const oldByExemplar = [{ id: "old-slug", label: "L", exemplarCaseIds: ["c1", "c2", "c3"] }];
  const newByExemplar = [{ id: "new-slug", label: "L2", exemplarCaseIds: ["c1", "c2", "c9"] }]; // jaccard = 2/4 = 0.5 >= threshold
  assert(
    computeAngleTurnoverRate(oldByExemplar, newByExemplar) === 0,
    `idが違ってもexemplar重なり(jaccard>=0.5)があれば生存 (got ${computeAngleTurnoverRate(oldByExemplar, newByExemplar)})`
  );

  // (3) idもexemplarも全く一致しない語彙（生成が壊れたケース）は従来どおり入れ替わりと判定される
  const oldBroken = [{ id: "old-slug", label: "L", exemplarCaseIds: ["c1", "c2"] }];
  const newBroken = [{ id: "totally-unrelated", label: "無関係", exemplarCaseIds: ["z1", "z2"] }];
  assert(
    computeAngleTurnoverRate(oldBroken, newBroken) === 1,
    `idもexemplarも無関係なら入れ替わり率1(ガードレール本務が生きている) (got ${computeAngleTurnoverRate(oldBroken, newBroken)})`
  );
}

// ── computeAngleTurnoverRate: 実データ(2026-08-17生成・棄却分)によるガードレール検証 ──
// data/idea-angles.json現行22個 と 2026-08-17生成24個(棄却済み)のidリスト。
// id完全一致は mitate, function-repurposing, data-as-material, constraint-as-weapon の4個のみで、
// 残り18個は概念として対応するもの(fictional-world-real→fictional-world-as-real 等)を含め
// id/labelが変わっている。exemplarCaseIdsは実データでは不明なため、ここでは意図的に
// 新旧で全く重ならないダミーidを与え、「idベース判定のみ」の効果を単離して検証する。
{
  const OLD_ANGLE_IDS_2026_08_16 = [
    "mitate", "medium-physicality", "function-repurposing", "subtraction-absence",
    "ugc-participatory", "data-as-material", "constraint-as-weapon", "fictional-world-real",
    "physical-digital-chain", "hidden-truth-reveal", "stakeholder-led-design", "taboo-confrontation",
    "hijack-competitor", "live-proof-stunt", "archive-revival", "anonymity-strategy",
    "body-tech-augmentation", "space-takeover", "policy-system-change", "scan-cg-craft",
    "ironic-context-reversal", "game-real-world-link",
  ];
  const NEW_ANGLE_IDS_2026_08_17_REJECTED = [
    "real-time-data-driven", "physical-paper-mechanism", "material-as-message", "mitate",
    "function-repurposing", "absence-as-statement", "generative-identity", "responsive-identity",
    "custom-typeface-identity", "staged-reveal-arg", "fictional-world-as-real", "participatory-cocreation",
    "embodied-perspective", "constraint-as-weapon", "self-mockery-jujitsu", "anonymous-persona",
    "space-repurposing", "multi-piece-assembly", "data-as-material", "waste-upcycling",
    "ai-mass-personalization", "game-reality-crossover", "accessibility-by-design", "tradition-remix",
  ];
  assert(OLD_ANGLE_IDS_2026_08_16.length === 22, "旧語彙idリストは22個(実データと一致)");
  assert(NEW_ANGLE_IDS_2026_08_17_REJECTED.length === 24, "新語彙idリストは24個(実データと一致)");

  const oldAnglesReal = OLD_ANGLE_IDS_2026_08_16.map((id, i) => ({
    id,
    label: id,
    exemplarCaseIds: [`old-ex-${i}`], // 新旧で重ならないダミー(id一致のみを検証対象にするため)
  }));
  const newAnglesReal = NEW_ANGLE_IDS_2026_08_17_REJECTED.map((id, i) => ({
    id,
    label: id,
    exemplarCaseIds: [`new-ex-${i}`],
  }));

  const rate = computeAngleTurnoverRate(oldAnglesReal, newAnglesReal);
  const expectedRate = 1 - 4 / 22; // id完全一致4個のみ生存 = 18/22 ≈ 0.818181...
  assert(
    Math.abs(rate - expectedRate) < 1e-9,
    `id完全一致4個/22個のみ生存で入れ替わり率18/22(${expectedRate}) (got ${rate})`
  );
  assert(
    rate > TURNOVER_RATE_MAX_FOR_TEST,
    `実データの入れ替わり率(${rate})は閾値0.8を超える(=idベース判定だけでは閾値内に収まらない。` +
      `差分生成(修正1)でidが維持されて初めて閾値内に収まる想定であり、修正2単独では不十分であることの証明) (got ${rate})`
  );

  // checkAnglesGuardrail経由でも同じ理由で棄却されることを確認する（ガードレール全体としての挙動）。
  const validCaseIdsReal = new Set([
    ...oldAnglesReal.map((a) => a.exemplarCaseIds[0]),
    ...newAnglesReal.map((a) => a.exemplarCaseIds[0]),
  ]);
  const guardrailResult = checkAnglesGuardrail({
    oldAngles: oldAnglesReal,
    newAngles: newAnglesReal,
    validCaseIds: validCaseIdsReal,
  });
  assert(
    guardrailResult.ok === false,
    `実データ相当のケースはcheckAnglesGuardrail経由でも棄却される(id完全一致4個のみでは閾値超過) (${JSON.stringify(guardrailResult.errors)})`
  );
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
  const makeAngles = (n, { exemplars = ["c0", "c1"], idPrefix = "a" } = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: `${idPrefix}${i}`, label: `L${i}`, exemplarCaseIds: exemplars }));

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

  // (c) 入れ替わり率が80%を超える(旧20件中、新語彙とid・exemplarsとも全く重ならない→100%)
  {
    // idベース判定を追加した本修正後は、idも旧語彙(a0..a19)と衝突しないよう別プレフィックスにする
    // (idも重なってしまうとid一致による生存判定が働き、このテストの意図(概念総入れ替わり)が壊れる)。
    const newAngles = makeAngles(20, { exemplars: ["c20", "c21"], idPrefix: "b" }); // oldAnglesの["c0","c1"]と重ならない
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

// ── maybeRefreshIdeaAngles: 入れ替わり率80%以下 → 採用され、caseCount/lastAttemptCaseCount
//    両方が最新に更新される（回帰防止） ──
async function runMaybeRefreshAcceptedTest() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "researchman-angles-accept-"));
  const metaPath = path.join(tmpDir, "idea-angles-meta.json");
  const anglesPath = path.join(tmpDir, "idea-angles.json");

  const oldAngles = Array.from({ length: 20 }, (_, i) => ({
    id: `a${i}`,
    label: `L${i}`,
    exemplarCaseIds: [`c${i}`],
  }));
  await fs.writeFile(anglesPath, JSON.stringify(oldAngles));
  await writeAnglesMeta(metaPath, { caseCount: 100, lastAttemptCaseCount: 100, generatedAt: "2026-01-01T00:00:00.000Z" });

  // 新語彙は全件旧語彙とexemplarCaseIdsが一致(=全生存=入れ替わり率0%)。CLI呼び出しの代わりに
  // anglesPathへ直接書き込む(実CLI/実Agent SDKは呼ばない)。
  const newAngles = oldAngles.map((a) => ({ ...a, label: `${a.label}v2` }));
  const runGenerateIdeaAnglesCliFn = async () => {
    await fs.writeFile(anglesPath, JSON.stringify(newAngles));
    return true;
  };
  let revertCalled = false;
  const gitCheckoutRevertFn = () => {
    revertCalled = true;
  };
  const addedPaths = [];
  const gitAddFn = (paths) => addedPaths.push(...paths);

  const cases = Array.from({ length: 160 }, (_, i) => ({ id: `c${i}` }));
  const lines = await maybeRefreshIdeaAngles({
    cases,
    metaPath,
    anglesPath,
    gitAddFn,
    runGenerateIdeaAnglesCliFn,
    gitCheckoutRevertFn,
  });

  assert(revertCalled === false, "採用時はgitCheckoutRevertFnを呼ばない");
  assert(lines.some((l) => l.includes("切り口語彙を更新")), `採用時はLINE報告に更新メッセージを含む (${JSON.stringify(lines)})`);
  assert(addedPaths.includes(anglesPath) && addedPaths.includes(metaPath), "採用時はangles/meta両方をgit addする");

  const written = await readAnglesMeta(metaPath);
  assert(written.caseCount === 160, `採用時caseCountが最新化される (got ${written.caseCount})`);
  assert(written.lastAttemptCaseCount === 160, `採用時lastAttemptCaseCountも最新化される (got ${written.lastAttemptCaseCount})`);

  await fs.rm(tmpDir, { recursive: true, force: true });
}

await runMaybeRefreshAcceptedTest();

// ── maybeRefreshIdeaAngles: 入れ替わり率80%超 → 旧語彙を維持しつつ、
//    caseCountは据え置き・lastAttemptCaseCountだけ今回のcases件数に更新される（本修正の本体） ──
async function runMaybeRefreshRejectedTest() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "researchman-angles-reject-"));
  const metaPath = path.join(tmpDir, "idea-angles-meta.json");
  const anglesPath = path.join(tmpDir, "idea-angles.json");

  const oldAngles = Array.from({ length: 20 }, (_, i) => ({
    id: `a${i}`,
    label: `L${i}`,
    exemplarCaseIds: [`c${i}`],
  }));
  await fs.writeFile(anglesPath, JSON.stringify(oldAngles));
  await writeAnglesMeta(metaPath, { caseCount: 605, lastAttemptCaseCount: 605, generatedAt: "2026-07-19T23:30:01.755Z" });

  // 新語彙は旧語彙とexemplarCaseIdsが一切重ならない(=入れ替わり率100%>80%)ため棄却される想定。
  const cases = Array.from({ length: 655 }, (_, i) => ({ id: `c${i}` }));
  const newAngles = Array.from({ length: 20 }, (_, i) => ({
    id: `b${i}`,
    label: `M${i}`,
    exemplarCaseIds: [`c${600 + i}`], // oldAnglesのc0..c19とは重ならない実在id
  }));
  const runGenerateIdeaAnglesCliFn = async () => {
    await fs.writeFile(anglesPath, JSON.stringify(newAngles));
    return true;
  };
  let revertedPaths = null;
  const gitCheckoutRevertFn = (paths) => {
    revertedPaths = paths;
  };
  const addedPaths = [];
  const gitAddFn = (paths) => addedPaths.push(...paths);

  const lines = await maybeRefreshIdeaAngles({
    cases,
    metaPath,
    anglesPath,
    gitAddFn,
    runGenerateIdeaAnglesCliFn,
    gitCheckoutRevertFn,
  });

  assert(
    Array.isArray(revertedPaths) && revertedPaths.includes(anglesPath),
    `ガードレール違反時はgitCheckoutRevertFn([anglesPath])が呼ばれる (got ${JSON.stringify(revertedPaths)})`
  );
  assert(
    lines.some((l) => l.includes("旧語彙を維持")),
    `ガードレール違反時はLINE報告に「旧語彙を維持」を含む (${JSON.stringify(lines)})`
  );

  const written = await readAnglesMeta(metaPath);
  assert(written.caseCount === 605, `ガードレール違反時caseCountは据え置き (got ${written.caseCount})`);
  assert(
    written.lastAttemptCaseCount === 655,
    `ガードレール違反時lastAttemptCaseCountは今回のcases件数に更新される (got ${written.lastAttemptCaseCount})`
  );
  assert(addedPaths.includes(metaPath), "ガードレール違反時もmetaPathはgit addされる(次回反映のため)");

  // ── デッドロック解消の確認: 次回のshouldRefreshAnglesが今回の時点からの増分50件で判定される ──
  assert(
    shouldRefreshAngles(704, written) === false,
    `棄却後、655件基準で+49件(704件)はfalse (got baseline=${written.lastAttemptCaseCount})`
  );
  assert(
    shouldRefreshAngles(705, written) === true,
    `棄却後、655件基準で+50件(705件)はtrue (got baseline=${written.lastAttemptCaseCount})`
  );

  // ── 実測値相当: 2週連続棄却してもlastAttemptCaseCountが単調に前進し、caseCountは据え置かれる ──
  const cases2 = Array.from({ length: 705 }, (_, i) => ({ id: `c${i}` }));
  const newAngles2 = Array.from({ length: 20 }, (_, i) => ({
    id: `d${i}`,
    label: `N${i}`,
    exemplarCaseIds: [`c${650 + i}`], // 前回のnewAnglesとも旧語彙とも重ならない
  }));
  const runGenerateIdeaAnglesCliFn2 = async () => {
    await fs.writeFile(anglesPath, JSON.stringify(newAngles2));
    return true;
  };
  let reverted2 = null;
  const gitCheckoutRevertFn2 = (paths) => {
    reverted2 = paths;
  };
  const lines2 = await maybeRefreshIdeaAngles({
    cases: cases2,
    metaPath,
    anglesPath,
    gitAddFn,
    runGenerateIdeaAnglesCliFn: runGenerateIdeaAnglesCliFn2,
    gitCheckoutRevertFn: gitCheckoutRevertFn2,
  });
  assert(Array.isArray(reverted2) && reverted2.includes(anglesPath), "2回目の棄却でもgitCheckoutRevertFnが呼ばれる");
  assert(lines2.some((l) => l.includes("旧語彙を維持")), "2回目も旧語彙維持のLINE報告文言を返す");

  const written2 = await readAnglesMeta(metaPath);
  assert(written2.caseCount === 605, `2回連続棄却してもcaseCountは初回棄却前のまま据え置き (got ${written2.caseCount})`);
  assert(
    written2.lastAttemptCaseCount === 705,
    `2回目棄却でlastAttemptCaseCountがさらに前進する(655→705) (got ${written2.lastAttemptCaseCount})`
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
}

await runMaybeRefreshRejectedTest();

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: tuneup-angles");
}
