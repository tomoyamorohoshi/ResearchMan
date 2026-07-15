import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAwardCommitMessage,
  buildAwardEntryString,
  classifyAwardJobForStartup,
  computePhaseProgress,
  dedupeNewCaseEntries,
  DEFAULT_AWARD_BUDGET_USD,
  emptyAwardCheckpoint,
  groupWinnersByWork,
  isPriorityRunningJob,
  meetsMinLevel,
  parseAwardCheckpoint,
  parseCategoriesText,
  parseMinLevel,
  resolveAwardBudgetUsd,
  validateAwardRequest,
  type AwardCheckpoint,
  type AwardCheckpointWinner,
} from "./awardPure.js";

// ── レベル下限パース ──────────────────────────────────────────────

test("parseMinLevel: 「ブロンズ以上」→ Bronze", () => {
  assert.equal(parseMinLevel("ブロンズ以上"), "Bronze");
});

test("parseMinLevel: 「Gold以上」→ Gold", () => {
  assert.equal(parseMinLevel("Gold以上"), "Gold");
});

test("parseMinLevel: 「全レベル」→ Shortlist（全て含む=最下位ランク）", () => {
  assert.equal(parseMinLevel("全レベル"), "Shortlist");
});

test("parseMinLevel: 「全部門(ブロンズ以上)」のような複合文からも抽出できる", () => {
  assert.equal(parseMinLevel("全部門(ブロンズ以上)"), "Bronze");
});

test("parseMinLevel: 「Grand Prix以上」→ Grand Prix", () => {
  assert.equal(parseMinLevel("Grand Prix以上"), "Grand Prix");
});

test("parseMinLevel: 未指定・認識不能はBronzeにフォールバック（安全側の既定）", () => {
  assert.equal(parseMinLevel(""), "Bronze");
  assert.equal(parseMinLevel("よくわからない"), "Bronze");
});

test("meetsMinLevel: 上位レベルはminLevel以上を満たす", () => {
  assert.equal(meetsMinLevel("Gold", "Bronze"), true);
  assert.equal(meetsMinLevel("Grand Prix", "Gold"), true);
});

test("meetsMinLevel: 下位レベルはminLevelを満たさない", () => {
  assert.equal(meetsMinLevel("Bronze", "Gold"), false);
  assert.equal(meetsMinLevel("Shortlist", "Bronze"), false);
});

test("meetsMinLevel: 未知のレベル文字列は安全側でfalse", () => {
  assert.equal(meetsMinLevel("参加賞", "Shortlist"), false);
});

// ── 部門テキストのパース ────────────────────────────────────────

test("parseCategoriesText: 「全部門」系は\"all\"", () => {
  assert.equal(parseCategoriesText("全部門(ブロンズ以上)"), "all");
  assert.equal(parseCategoriesText("全て"), "all");
});

test("parseCategoriesText: 個別部門名はカンマ・読点・スラッシュ区切りで配列化", () => {
  assert.deepEqual(parseCategoriesText("Film、Digital Design"), ["Film", "Digital Design"]);
  assert.deepEqual(parseCategoriesText("Film/Digital Design"), ["Film", "Digital Design"]);
});

// ── 進捗%計算 ────────────────────────────────────────────────────

test("computePhaseProgress: P1は常に0〜5%レンジ", () => {
  assert.equal(computePhaseProgress("P1", 0, 1), 0);
  assert.equal(computePhaseProgress("P1", 1, 1), 5);
});

test("computePhaseProgress: P2は5〜40%レンジを部門進捗で按分", () => {
  assert.equal(computePhaseProgress("P2", 0, 4), 5);
  assert.equal(computePhaseProgress("P2", 2, 4), 5 + 35 / 2);
  assert.equal(computePhaseProgress("P2", 4, 4), 40);
});

test("computePhaseProgress: P4は45〜90%レンジ", () => {
  assert.equal(computePhaseProgress("P4", 0, 10), 45);
  assert.equal(computePhaseProgress("P4", 10, 10), 90);
});

test("computePhaseProgress: P5は90〜100%レンジ", () => {
  assert.equal(computePhaseProgress("P5", 0, 1), 90);
  assert.equal(computePhaseProgress("P5", 1, 1), 100);
});

test("computePhaseProgress: total=0はフェーズ開始%を返す（0除算防止）", () => {
  assert.equal(computePhaseProgress("P2", 0, 0), 5);
});

// ── checkpoint round-trip ───────────────────────────────────────

test("emptyAwardCheckpoint: 初期値はP1・空配列群", () => {
  const cp = emptyAwardCheckpoint();
  assert.equal(cp.phase, "P1");
  assert.deepEqual(cp.categoriesDone, []);
  assert.deepEqual(cp.collectedWinners, []);
  assert.deepEqual(cp.writtenEntries, []);
});

test("checkpoint round-trip: JSON経由で往復しても内容が保たれる", () => {
  const cp: AwardCheckpoint = {
    phase: "P4",
    officialSourceUrl: "https://example.com/winners",
    structureNote: "部門ごとに別ページ",
    resolvedCategories: ["Film", "Digital Design", "Print"],
    categoriesDone: ["Film", "Digital Design"],
    categoriesFailed: ["Print"],
    collectedWinners: [
      { category: "Film", subcategory: "", level: "Gold", title: "Work A", brand: "Brand A", agency: "Agency A", sourceUrl: "https://x" },
    ],
    writtenEntries: [{ entry: { id: "work-a-2026", title: "Work A" }, thumbnailPath: "public/thumbnails/work-a-2026.jpg" }],
    writtenTitleKeys: ["worka"],
    p5: "files-written",
  };
  const roundTripped = parseAwardCheckpoint(JSON.parse(JSON.stringify(cp)));
  assert.deepEqual(roundTripped, cp);
});

test("checkpoint round-trip: 壊れた/部分的なJSONは欠損フィールドを安全な既定値で補う", () => {
  const roundTripped = parseAwardCheckpoint({ phase: "P2" });
  assert.equal(roundTripped.phase, "P2");
  assert.deepEqual(roundTripped.resolvedCategories, []);
  assert.deepEqual(roundTripped.categoriesDone, []);
  assert.deepEqual(roundTripped.categoriesFailed, []);
  assert.deepEqual(roundTripped.collectedWinners, []);
  assert.deepEqual(roundTripped.writtenEntries, []);
  assert.deepEqual(roundTripped.writtenTitleKeys, []);
  assert.equal(roundTripped.officialSourceUrl, "");
  assert.equal(roundTripped.p5, "pending");
});

test("checkpoint round-trip: nullや非オブジェクトはempty checkpointにフォールバックする", () => {
  assert.deepEqual(parseAwardCheckpoint(null), emptyAwardCheckpoint());
  assert.deepEqual(parseAwardCheckpoint(undefined), emptyAwardCheckpoint());
  assert.deepEqual(parseAwardCheckpoint("garbage"), emptyAwardCheckpoint());
});

// ── P5冪等性: checkpoint.p5（指摘1【重大】再発防止） ──────────────────
// P5でcommit/push済みかを示すフラグがcheckpointに無いと、P5途中またはcommit直後にプロセスが
// 落ちて再開した際、cases.jsonに同一エントリが重複prependされ二重コミットされる
// （runAwardResearchPipeline再開はcheckpoint.phase到達済みのフェーズを常に再実行するため、
// P5だけは「もうcommit済みか」を自己申告する状態を持たないと区別できない）。

test("emptyAwardCheckpoint: p5は初期値 pending", () => {
  assert.equal(emptyAwardCheckpoint().p5, "pending");
});

test("parseAwardCheckpoint: p5がfiles-written/committedならそのまま保持する", () => {
  assert.equal(parseAwardCheckpoint({ p5: "files-written" }).p5, "files-written");
  assert.equal(parseAwardCheckpoint({ p5: "committed" }).p5, "committed");
});

test("parseAwardCheckpoint: p5が不正な値/欠損はpendingにフォールバックする（fail-safe）", () => {
  assert.equal(parseAwardCheckpoint({ p5: "bogus" }).p5, "pending");
  assert.equal(parseAwardCheckpoint({}).p5, "pending");
});

// ── 冪等ガード: cases.jsonへのprependで既存idと重複するエントリを除外する ──────────
// 多重防御（checkpoint.p5による再実行スキップに加え、万一P5本体が再実行された場合でも
// 同一idの二重prependを防ぐ）。

test("dedupeNewCaseEntries: 既存idと重複するエントリはprepend対象から除外される", () => {
  const existingIds = new Set(["already-there-2026"]);
  const newEntries = [
    { id: "already-there-2026", title: "Already There" },
    { id: "brand-new-2026", title: "Brand New" },
  ];
  const result = dedupeNewCaseEntries(existingIds, newEntries);
  assert.deepEqual(result, [{ id: "brand-new-2026", title: "Brand New" }]);
});

test("dedupeNewCaseEntries: 重複が無ければ全件そのまま返す", () => {
  const existingIds = new Set<string>([]);
  const newEntries = [{ id: "a-2026", title: "A" }];
  assert.deepEqual(dedupeNewCaseEntries(existingIds, newEntries), newEntries);
});

// ── 重複連結（複数部門受賞のaward文字列組み立て） ─────────────────

const winnersSameWork: AwardCheckpointWinner[] = [
  { category: "Film", subcategory: "", level: "Gold", title: "Same Work", brand: "Acme", agency: "Agency X", sourceUrl: "https://a" },
  { category: "Digital Design", subcategory: "", level: "Bronze", title: "Same Work", brand: "Acme", agency: "Agency X", sourceUrl: "https://b" },
];

test("groupWinnersByWork: 同一タイトルは1つのworkにまとめられる", () => {
  const grouped = groupWinnersByWork(winnersSameWork);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].records.length, 2);
});

test("groupWinnersByWork: 別タイトルは別workになる", () => {
  const grouped = groupWinnersByWork([
    ...winnersSameWork,
    { category: "Film", subcategory: "", level: "Silver", title: "Other Work", brand: "Beta", agency: "", sourceUrl: "https://c" },
  ]);
  assert.equal(grouped.length, 2);
});

// ── 指摘3【中】同名タイトル・別ブランドは誤統合されない ────────────────────
// タイトルのみでグルーピングすると、同名タイトルの別ブランド作品（実務上ありうる:
// 同名キャンペーンを別ブランドが別年/別市場で展開するケースなど）が1エントリに誤統合される。

test("groupWinnersByWork: 同タイトルでもブランドが異なれば別workになる", () => {
  const grouped = groupWinnersByWork([
    { category: "Film", subcategory: "", level: "Gold", title: "Same Title", brand: "Brand A", agency: "Agency A", sourceUrl: "https://a" },
    { category: "Print", subcategory: "", level: "Silver", title: "Same Title", brand: "Brand B", agency: "Agency B", sourceUrl: "https://b" },
  ]);
  assert.equal(grouped.length, 2, "ブランドが異なるのに1つのworkに統合されている");
  assert.deepEqual(
    grouped.map((g) => g.brand).sort(),
    ["Brand A", "Brand B"],
  );
});

test("groupWinnersByWork: 同タイトル・同ブランドの複数部門受賞は1workに連結される", () => {
  const grouped = groupWinnersByWork(winnersSameWork);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].brand, "Acme");
  assert.equal(grouped[0].records.length, 2);
});

test("buildAwardEntryString: 複数部門受賞は「 / 」で連結される", () => {
  const grouped = groupWinnersByWork(winnersSameWork);
  const award = buildAwardEntryString("D&AD", "2026", grouped[0].records);
  assert.equal(award, "D&AD 2026 Film Gold / D&AD 2026 Digital Design Bronze");
});

test("buildAwardEntryString: 単一部門はそのまま1セグメント", () => {
  const award = buildAwardEntryString("D&AD", "2026", [{ category: "Film", level: "Gold" }]);
  assert.equal(award, "D&AD 2026 Film Gold");
});

// ── リクエスト検証 ────────────────────────────────────────────────

test("validateAwardRequest: 必須項目が揃っていればok", () => {
  const r = validateAwardRequest({ awardName: "D&AD", year: "2026", categories: "all", minLevel: "Bronze" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.awardName, "D&AD");
    assert.equal(r.value.year, "2026");
    assert.equal(r.value.categories, "all");
    assert.equal(r.value.minLevel, "Bronze");
    assert.equal(r.value.dryRun, false);
    assert.equal(r.value.lineUserId, "");
  }
});

test("validateAwardRequest: awardNameが空ならエラー", () => {
  const r = validateAwardRequest({ awardName: "", year: "2026", categories: "all", minLevel: "Bronze" });
  assert.equal(r.ok, false);
});

test("validateAwardRequest: 部門配列・dryRun・lineUserIdも通す", () => {
  const r = validateAwardRequest({
    awardName: "One Show",
    year: "2026",
    categories: ["Film", "Digital Design"],
    minLevel: "Gold",
    dryRun: true,
    lineUserId: "U1",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.categories, ["Film", "Digital Design"]);
    assert.equal(r.value.dryRun, true);
    assert.equal(r.value.lineUserId, "U1");
  }
});

test("validateAwardRequest: minLevelが語彙外ならエラー", () => {
  const r = validateAwardRequest({ awardName: "D&AD", year: "2026", categories: "all", minLevel: "Diamond" });
  assert.equal(r.ok, false);
});

// ── コスト予算 ────────────────────────────────────────────────────

test("resolveAwardBudgetUsd: 未設定は既定値$30", () => {
  assert.equal(resolveAwardBudgetUsd({}), DEFAULT_AWARD_BUDGET_USD);
});

test("resolveAwardBudgetUsd: 数値化できる設定はそれを使う", () => {
  assert.equal(resolveAwardBudgetUsd({ STUDIO_AWARD_BUDGET_USD: "50" }), 50);
});

test("resolveAwardBudgetUsd: 0以下・数値化不能は既定値にフォールバック", () => {
  assert.equal(resolveAwardBudgetUsd({ STUDIO_AWARD_BUDGET_USD: "0" }), DEFAULT_AWARD_BUDGET_USD);
  assert.equal(resolveAwardBudgetUsd({ STUDIO_AWARD_BUDGET_USD: "abc" }), DEFAULT_AWARD_BUDGET_USD);
});

// ── commitメッセージ ────────────────────────────────────────────

test("buildAwardCommitMessage: アワード名・年・件数を含む", () => {
  const msg = buildAwardCommitMessage("D&AD", "2026", 3);
  assert.match(msg, /D&AD/);
  assert.match(msg, /2026/);
  assert.match(msg, /3件/);
});

// ── listRunningPriorityJobs の判定（isPriorityRunningJob） ────────

test("isPriorityRunningJob: research/add-caseのrunningジョブはtrue", () => {
  assert.equal(isPriorityRunningJob({ id: "a", tab: "research", status: "running" }, "self"), true);
  assert.equal(isPriorityRunningJob({ id: "b", tab: "add-case", status: "running" }, "self"), true);
});

test("isPriorityRunningJob: 自分自身のidは除外", () => {
  assert.equal(isPriorityRunningJob({ id: "self", tab: "research", status: "running" }, "self"), false);
});

test("isPriorityRunningJob: idea/awardsやrunning以外は対象外", () => {
  assert.equal(isPriorityRunningJob({ id: "c", tab: "idea", status: "running" }, "self"), false);
  assert.equal(isPriorityRunningJob({ id: "d", tab: "awards", status: "running" }, "self"), false);
  assert.equal(isPriorityRunningJob({ id: "e", tab: "research", status: "done" }, "self"), false);
});

// ── サーバ起動時の復帰分類 ────────────────────────────────────────

test("classifyAwardJobForStartup: running（プロセス死で孤児化）→ mark-restart-and-resume", () => {
  assert.equal(classifyAwardJobForStartup({ tab: "awards", status: "running" }), "mark-restart-and-resume");
});

test("classifyAwardJobForStartup: paused pausedReason=restart/priority-job → auto-resume", () => {
  assert.equal(classifyAwardJobForStartup({ tab: "awards", status: "paused", pausedReason: "restart" }), "auto-resume");
  assert.equal(classifyAwardJobForStartup({ tab: "awards", status: "paused", pausedReason: "priority-job" }), "auto-resume");
});

test("classifyAwardJobForStartup: paused pausedReason=budget → wait-budget", () => {
  assert.equal(classifyAwardJobForStartup({ tab: "awards", status: "paused", pausedReason: "budget" }), "wait-budget");
});

test("classifyAwardJobForStartup: awards以外・done/errorはignore", () => {
  assert.equal(classifyAwardJobForStartup({ tab: "research", status: "running" }), "ignore");
  assert.equal(classifyAwardJobForStartup({ tab: "awards", status: "done" }), "ignore");
  assert.equal(classifyAwardJobForStartup({ tab: "awards", status: "error" }), "ignore");
});
