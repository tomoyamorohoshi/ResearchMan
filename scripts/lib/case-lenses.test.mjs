// scripts/lib/case-lenses.mjs（Case Study v3 §2・§4: 4レンズ×多言語・鮮度14日・採用枠・追加ラウンド）の単体テスト。
// 実行: node --test scripts/lib/case-lenses.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FRESHNESS_DAYS,
  LENS_COUNT,
  ROTATING_LANG_IDS,
  freshnessWindow,
  lensLanguagePlan,
  languageSection,
  lensOrderForDay,
  decideFinalTier,
  selectAdoptions,
  shouldRunExtraRound,
  planExtraRound,
  articleBudgetCheck,
  takeBorderlineToTry,
  ARTICLE_BUDGET_MS,
  MAX_ARTICLE_ATTEMPTS_ACCEPT,
  MAX_ARTICLE_ATTEMPTS_BORDERLINE,
  MAX_ACCEPT,
  MAX_BORDERLINE,
  MIN_ACCEPT_BEFORE_EXTRA,
  MAX_EXTRA_ROUNDS,
} from "./case-lenses.mjs";

test("定数: 鮮度14日・accept最大10・borderline最大3・accept5件未満で追加・追加最大2", () => {
  assert.equal(FRESHNESS_DAYS, 14);
  assert.equal(LENS_COUNT, 4);
  assert.equal(MAX_ACCEPT, 10);
  assert.equal(MAX_BORDERLINE, 3);
  assert.equal(MIN_ACCEPT_BEFORE_EXTRA, 5);
  assert.equal(MAX_EXTRA_ROUNDS, 2);
});

test("freshnessWindow: 前回調査日ではなく固定14日前〜今日", () => {
  const now = new Date("2026-10-20T10:00:00+09:00");
  const w = freshnessWindow(now);
  assert.equal(w.days, 14);
  assert.equal(w.cutoffYmd, "2026-10-06");
  assert.equal(w.todayYmd, "2026-10-20");
});

test("lensLanguagePlan: 各レンズに en/ja が常に入り、回転枠は2言語で重複しない", () => {
  for (let day = 20000; day < 20020; day++) {
    const plan = lensLanguagePlan(day);
    assert.equal(plan.length, 4);
    for (const langs of plan) {
      assert.equal(langs.length, 4);
      assert.deepEqual(langs.slice(0, 2), ["en", "ja"]);
      const rot = langs.slice(2);
      assert.equal(new Set(rot).size, 2, `重複: day=${day} ${rot}`);
      for (const l of rot) assert.ok(ROTATING_LANG_IDS.includes(l));
    }
  }
});

test("lensLanguagePlan: どの日でも4レンズ合計で5言語（zh/ko/es-pt/fr/de）が全部どこかで使われる", () => {
  assert.deepEqual([...ROTATING_LANG_IDS].sort(), ["de", "es", "fr", "ko", "zh"]);
  for (let day = 20000; day < 20030; day++) {
    const used = new Set(lensLanguagePlan(day).flatMap((l) => l.slice(2)));
    assert.equal(used.size, 5, `day=${day}: ${[...used]}`);
  }
});

test("lensLanguagePlan: 日が変わると割り当てがずれる（同じ言語が同じレンズに固定されない）", () => {
  const a = lensLanguagePlan(20000)[0].slice(2).join();
  const seen = new Set();
  for (let d = 20000; d < 20005; d++) seen.add(lensLanguagePlan(d)[0].slice(2).join());
  assert.ok(seen.size >= 4, `5日で ${seen.size} 通り`);
  assert.ok(seen.has(a));
});

test("languageSection: 指定言語の検索語例を含み、記事は日本語と明記", () => {
  const s = languageSection(["en", "ja", "zh", "ko"], 0);
  assert.match(s, /英語/);
  assert.match(s, /日本語/);
  assert.match(s, /中国語/);
  assert.match(s, /韓国語/);
  assert.ok(!/スペイン語/.test(s));
  assert.match(s, /記事|出力は日本語/);
  assert.match(s, /検索語/);
});

test("lensOrderForDay: 4レンズを毎日1回ずつ（順列）、開始位置は日替わり", () => {
  for (let d = 0; d < 8; d++) {
    const o = lensOrderForDay(20000 + d);
    assert.deepEqual([...o].sort(), [0, 1, 2, 3]);
  }
  assert.notDeepEqual(lensOrderForDay(20000), lensOrderForDay(20001));
});

test("decideFinalTier: 最終判定は関門2。関門1が reject なら記事化に進まない（null）", () => {
  assert.equal(decideFinalTier("accept", "accept"), "accept");
  assert.equal(decideFinalTier("borderline", "accept"), "accept");
  assert.equal(decideFinalTier("accept", "borderline"), "borderline");
  assert.equal(decideFinalTier("borderline", "borderline"), "borderline");
  assert.equal(decideFinalTier("accept", "reject"), null);
  assert.equal(decideFinalTier("borderline", "reject"), null);
  assert.equal(decideFinalTier("reject", "accept"), null);
  assert.equal(decideFinalTier("reject", "borderline"), null);
  assert.equal(decideFinalTier("accept", undefined), null);
  assert.equal(decideFinalTier(undefined, "accept"), null);
});

test("selectAdoptions: accept12+borderline5 → accept10+borderline3、borderlineはgateScore降順で選ぶ", () => {
  const items = [];
  for (let i = 1; i <= 12; i++) items.push({ id: `a${i}`, tier: "accept", gateScore: 5 });
  const bs = [3, 9, 6, 9, 1];
  bs.forEach((s, i) => items.push({ id: `b${i + 1}`, tier: "borderline", gateScore: s }));
  const { adopted, dropped } = selectAdoptions(items);
  const acc = adopted.filter((x) => x.tier === "accept");
  const bor = adopted.filter((x) => x.tier === "borderline");
  assert.equal(acc.length, 10);
  assert.deepEqual(acc.map((x) => x.id), ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10"]);
  assert.deepEqual(bor.map((x) => x.id), ["b2", "b4", "b3"], "9(b2),9(b4,同点は先着),6(b3)");
  assert.equal(adopted.length, 13);
  assert.equal(dropped.length, 4);
  const dAcc = dropped.filter((d) => d.item.tier === "accept");
  const dBor = dropped.filter((d) => d.item.tier === "borderline");
  assert.deepEqual(dAcc.map((d) => d.item.id), ["a11", "a12"]);
  assert.ok(dAcc.every((d) => d.reason === "accept-over-cap"));
  assert.deepEqual(dBor.map((d) => d.item.id).sort(), ["b1", "b5"]);
  assert.ok(dBor.every((d) => d.reason === "borderline-over-cap"));
});

test("selectAdoptions: accept が0でも borderline 枠は3件まで、accept が多くても borderline 枠は維持", () => {
  const onlyB = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, tier: "borderline", gateScore: i + 1 }));
  assert.equal(selectAdoptions(onlyB).adopted.length, 3);
  const many = [
    ...Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, tier: "accept", gateScore: 5 })),
    { id: "b0", tier: "borderline", gateScore: 4 },
  ];
  const r = selectAdoptions(many);
  assert.equal(r.adopted.filter((x) => x.tier === "borderline").length, 1);
  assert.equal(r.adopted.filter((x) => x.tier === "accept").length, 10);
});

test("selectAdoptions: gateScore 欠損は最低扱い・入力を破壊しない", () => {
  const items = [
    { id: "x", tier: "borderline" },
    { id: "y", tier: "borderline", gateScore: 2 },
    { id: "z", tier: "borderline", gateScore: 2 },
    { id: "w", tier: "borderline", gateScore: 1 },
  ];
  const copy = JSON.stringify(items);
  const r = selectAdoptions(items);
  assert.deepEqual(r.adopted.map((i) => i.id), ["y", "z", "w"]);
  assert.deepEqual(r.dropped.map((d) => d.item.id), ["x"]);
  assert.equal(JSON.stringify(items), copy);
});

test("shouldRunExtraRound: accept 5件未満・追加2回未満・時間内のときだけ", () => {
  const base = { acceptCount: 4, extraDone: 0, elapsedMs: 10 * 60000, budgetMs: 90 * 60000 };
  assert.equal(shouldRunExtraRound(base), true);
  assert.equal(shouldRunExtraRound({ ...base, acceptCount: 5 }), false);
  assert.equal(shouldRunExtraRound({ ...base, acceptCount: 0, extraDone: 1 }), true);
  assert.equal(shouldRunExtraRound({ ...base, extraDone: 2 }), false);
  assert.equal(shouldRunExtraRound({ ...base, elapsedMs: 90 * 60000 }), false);
});

test("planExtraRound: accept の少ないレンズを選び、その日そのレンズで未使用の言語を割り当てる", () => {
  const day = 20100;
  const plan = lensLanguagePlan(day);
  const used = plan.map((l) => new Set(l));
  const r = planExtraRound({ dayIndex: day, acceptByLens: [3, 0, 2, 1], usedLangsByLens: used, extraByLens: [0, 0, 0, 0] });
  assert.equal(r.lensIndex, 1);
  assert.ok(r.langs.length >= 1 && r.langs.length <= 2);
  for (const l of r.langs) {
    assert.ok(!used[1].has(l), `${l} は当日使用済み`);
    assert.ok(ROTATING_LANG_IDS.includes(l));
  }
  assert.equal(new Set(r.langs).size, r.langs.length);
  assert.equal(r.variant, 1);
});

test("planExtraRound: 同数なら追加回数の少ないレンズ→番号順。2回目は使用済み言語を除く", () => {
  const day = 20100;
  const used = lensLanguagePlan(day).map((l) => new Set(l));
  const r1 = planExtraRound({ dayIndex: day, acceptByLens: [1, 1, 1, 1], usedLangsByLens: used, extraByLens: [0, 0, 0, 0] });
  assert.equal(r1.lensIndex, 0);
  for (const l of r1.langs) used[r1.lensIndex].add(l);
  const r2 = planExtraRound({ dayIndex: day, acceptByLens: [1, 1, 1, 1], usedLangsByLens: used, extraByLens: [1, 0, 0, 0] });
  assert.equal(r2.lensIndex, 1, "追加済みのレンズは後回し");
  // 同じレンズに2回目が来た場合は未使用言語が尽きていく
  const r3 = planExtraRound({ dayIndex: day, acceptByLens: [0, 5, 5, 5], usedLangsByLens: used, extraByLens: [1, 0, 0, 0] });
  assert.equal(r3.lensIndex, 0);
  for (const l of r3.langs) assert.ok(!used[0].has(l));
  assert.equal(r3.variant, 2);
});

test("planExtraRound: 未使用言語が尽きていれば langs は空（別の検索語のみで追加）", () => {
  const used = [0, 1, 2, 3].map(() => new Set(["en", "ja", ...ROTATING_LANG_IDS]));
  const r = planExtraRound({ dayIndex: 1, acceptByLens: [0, 0, 0, 0], usedLangsByLens: used, extraByLens: [0, 0, 0, 0] });
  assert.deepEqual(r.langs, []);
});

test("記事化の上限: 累積60分・accept系20件・borderline系5件（MAX_BORDERLINE+2）", () => {
  assert.equal(ARTICLE_BUDGET_MS, 60 * 60 * 1000);
  assert.equal(MAX_ARTICLE_ATTEMPTS_ACCEPT, 20);
  assert.equal(MAX_ARTICLE_ATTEMPTS_BORDERLINE, MAX_BORDERLINE + 2);
});

test("articleBudgetCheck: 時間超過・件数超過で理由を返し、枠内なら null", () => {
  const ok = { kind: "accept", acceptAttempts: 19, borderlineAttempts: 0, elapsedMs: 59 * 60000 };
  assert.equal(articleBudgetCheck(ok), null);
  assert.match(articleBudgetCheck({ ...ok, elapsedMs: 60 * 60000 }), /time/);
  assert.match(articleBudgetCheck({ ...ok, acceptAttempts: 20 }), /count/);
  // borderline 系は別カウント: accept系が上限でも borderline は試せる
  assert.equal(articleBudgetCheck({ kind: "borderline", acceptAttempts: 20, borderlineAttempts: 4, elapsedMs: 0 }), null);
  assert.match(articleBudgetCheck({ kind: "borderline", acceptAttempts: 0, borderlineAttempts: 5, elapsedMs: 0 }), /count/);
  assert.match(articleBudgetCheck({ kind: "borderline", acceptAttempts: 0, borderlineAttempts: 0, elapsedMs: 61 * 60000 }), /time/);
});

test("takeBorderlineToTry: 発見時gateScore上位から、試行済みを除いた残り枠(5件)まで", () => {
  const pending = [2, 9, 5, 7, 7, 1, 8].map((s, i) => ({ id: i, gate1: { gateScore: s } }));
  const r = takeBorderlineToTry(pending, 0);
  assert.deepEqual(r.take.map((x) => x.gate1.gateScore), [9, 8, 7, 7, 5]);
  assert.equal(r.rest.length, 2);
  const r2 = takeBorderlineToTry(pending, 3);
  assert.deepEqual(r2.take.map((x) => x.gate1.gateScore), [9, 8]);
  assert.equal(takeBorderlineToTry(pending, 5).take.length, 0);
  // 由来に関わらず枠を先取りしない: 試行数は関門1 borderline の記事化回数のみ
  assert.equal(pending.length, 7);
});

// ── 検証用の短縮モード（週次見直しの cc dry-run 検証。45分タイムアウト回避）──
import { CC_VERIFY_ENV_KEY, VERIFY_MAX_ARTICLE_ATTEMPTS, isVerifyMode, planDiscoveryQueue } from "./case-lenses.mjs";

test("isVerifyMode: dry-run との併用時のみ有効（本番では無視）", () => {
  assert.equal(isVerifyMode({ env: { [CC_VERIFY_ENV_KEY]: "1" }, argv: ["--dry-run"] }), true);
  assert.equal(isVerifyMode({ env: {}, argv: ["--dry-run", "--verify"] }), true);
  assert.equal(isVerifyMode({ env: { [CC_VERIFY_ENV_KEY]: "1" }, argv: [] }), false);
  assert.equal(isVerifyMode({ env: {}, argv: ["--verify"] }), false);
  assert.equal(isVerifyMode({ env: { [CC_VERIFY_ENV_KEY]: "0" }, argv: ["--dry-run"] }), false);
  assert.equal(isVerifyMode({ env: {}, argv: ["--dry-run"] }), false);
});

test("planDiscoveryQueue: 通常は4レンズ全部、短縮モードは最初のレンズ1ラウンドのみ", () => {
  const order = [2, 0, 3, 1];
  assert.deepEqual(planDiscoveryQueue(order), [
    { kind: "base", lens: 2, round: 1 },
    { kind: "base", lens: 0, round: 2 },
    { kind: "base", lens: 3, round: 3 },
    { kind: "base", lens: 1, round: 4 },
  ]);
  assert.equal(planDiscoveryQueue(order, { verify: false }).length, 4);
  assert.deepEqual(planDiscoveryQueue(order, { verify: true }), [{ kind: "base", lens: 2, round: 1 }]);
});

test("articleBudgetCheck: 短縮モードは accept+borderline 合計2件で打ち切り、通常は不変", () => {
  assert.equal(VERIFY_MAX_ARTICLE_ATTEMPTS, 2);
  const base = { kind: "accept", acceptAttempts: 1, borderlineAttempts: 1, elapsedMs: 0 };
  assert.match(articleBudgetCheck({ ...base, verify: true }), /verify/);
  assert.equal(articleBudgetCheck({ ...base, borderlineAttempts: 0, verify: true }), null);
  assert.equal(articleBudgetCheck(base), null);
  assert.equal(articleBudgetCheck({ ...base, verify: false }), null);
});
