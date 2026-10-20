// data/case-gate.json の読み込み・検証・3段階判定・プロンプト節の単体テスト（node:test）。
// 実行: node --test scripts/lib/case-gate-data.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadCaseGate,
  validateCaseGate,
  buildCriteriaText,
  buildLitmusText,
  buildTasteTypesText,
  normalizeGateItem,
  summarizeBakeoff,
  buildBakeoffPrompt,
  GATE_CRITERIA_TEXT,
} from "./case-gate-criteria.mjs";
import {
  normalizeDiscoveryGate,
  normalizeArticleGate,
  partitionByGate,
  gateRejectionDetail,
  discoveryGatePromptSection,
  articleGatePromptSection,
} from "./case-gate.mjs";

const clone = (o) => JSON.parse(JSON.stringify(o));
const good = () => clone(loadCaseGate());
const tmpJson = (obj) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cg-")), "case-gate.json");
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
};

test("loadCaseGate: 既定ファイルが読め、検証エラー無し・基準A〜D・類型a〜f・例各8件以下", () => {
  const d = loadCaseGate();
  assert.deepEqual(validateCaseGate(d), []);
  assert.deepEqual(d.criteria.map((c) => c.id), ["A", "B", "C", "D"]);
  assert.deepEqual(d.tasteTypes.map((t) => t.id), ["a", "b", "c", "d", "e", "f"]);
  assert.ok(d.litmus.accept.length >= 1 && d.litmus.accept.length <= 8);
  assert.ok(d.litmus.reject.length >= 1 && d.litmus.reject.length <= 8);
  assert.ok(d.version && d.updatedAt);
});

test("loadCaseGate: 不正なJSON・存在しないパスは例外（既定値に黙って戻さない）", () => {
  assert.throws(() => loadCaseGate(tmpJson("{broken")));
  assert.throws(() => loadCaseGate(path.join(os.tmpdir(), "no-such-dir-xyz", "x.json")));
});

test("loadCaseGate: 検証エラーのあるファイルは例外", () => {
  const d = good();
  d.criteria = d.criteria.filter((c) => c.id !== "D");
  assert.throws(() => loadCaseGate(tmpJson(d)), /D/);
});

test("validateCaseGate: 基準欠落・具体例9件・空文字・必須キー欠落・不正origin を検出", () => {
  let d = good();
  d.criteria = d.criteria.filter((c) => c.id !== "B");
  assert.ok(validateCaseGate(d).some((e) => e.includes("B")));

  d = good();
  d.litmus.accept = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, why: "w", origin: "seed", addedAt: "2026-10-20" }));
  assert.ok(validateCaseGate(d).some((e) => /accept/.test(e) && /8/.test(e)));

  d = good();
  d.criteria[0].text = "  ";
  assert.ok(validateCaseGate(d).length > 0);

  d = good();
  d.litmus.reject[0].why = "";
  assert.ok(validateCaseGate(d).length > 0);

  d = good();
  delete d.rejectTypical;
  assert.ok(validateCaseGate(d).length > 0);

  d = good();
  d.litmus.accept[0].origin = "";
  assert.ok(validateCaseGate(d).length > 0);

  assert.ok(validateCaseGate(null).length > 0);
});

test("文面組み立て: 基準節にA〜D、類型節にe/f、具体例節に正例・逆例", () => {
  const c = buildCriteriaText(loadCaseGate());
  for (const s of ["- A:", "- B:", "- C:", "- D:", "転用"]) assert.ok(c.includes(s), s);
  assert.equal(c, GATE_CRITERIA_TEXT);
  const t = buildTasteTypesText(loadCaseGate());
  assert.match(t, /\(e\) 手法の発明/);
  assert.match(t, /\(f\) 新しいメディアの発明/);
  const l = buildLitmusText(loadCaseGate());
  assert.match(l, /Auspicious Art/);
  assert.match(l, /VketReal 2026/);
});

test("3段階: borderline は criterion(A〜D)と reason が揃った時のみ。欠けたら reject＋invalid", () => {
  const b = normalizeGateItem({ verdict: "borderline", criterion: "c", reason: "手法は面白いが新規性が弱い" });
  assert.equal(b.verdict, "borderline");
  assert.equal(b.criterion, "C");
  assert.equal(b.invalid, false);
  const noReason = normalizeGateItem({ verdict: "borderline", criterion: "A", reason: " " });
  assert.equal(noReason.verdict, "reject");
  assert.equal(noReason.invalid, true);
  assert.equal(noReason.criterion, "none");
  const noCrit = normalizeGateItem({ verdict: "borderline", criterion: "none", reason: "r" });
  assert.equal(noCrit.verdict, "reject");
  assert.equal(noCrit.invalid, true);
  const d = normalizeGateItem({ verdict: "accept", criterion: "D", reason: "r" });
  assert.equal(d.verdict, "accept");
  assert.equal(d.criterion, "D");
  assert.equal(normalizeGateItem({ verdict: "maybe", criterion: "A", reason: "r" }).verdict, "reject");
});

test("normalizeDiscoveryGate / normalizeArticleGate: borderline と D を運ぶ", () => {
  const g = normalizeDiscoveryGate({ gateVerdict: "borderline", gateCriterion: "D", gateReason: "転用できそうだが検証が浅い" });
  assert.deepEqual(g, { gateVerdict: "borderline", gateCriterion: "D", gateScore: 1, gateReason: "転用できそうだが検証が浅い", invalidOutput: false });
  assert.equal(normalizeDiscoveryGate({ gateVerdict: "borderline", gateCriterion: "A" }).gateVerdict, "reject");
  assert.equal(normalizeDiscoveryGate({ gateVerdict: "borderline", gateCriterion: "A" }).invalidOutput, true);
  assert.equal(normalizeDiscoveryGate({ gateVerdict: "accept", gateCriterion: "D", gateReason: "r" }).gateCriterion, "D");
  const a = normalizeArticleGate({ gateVerdict: "borderline", gateCriterion: "B", gateScore: 2, gateReason: "あと一歩", announcementType: "" });
  assert.equal(a.gateVerdict, "borderline");
  assert.equal(a.gateCriterion, "B");
  const ann = normalizeArticleGate({ gateVerdict: "borderline", gateCriterion: "B", gateScore: 2, gateReason: "r", announcementType: "発売" });
  assert.equal(ann.gateVerdict, "reject");
  assert.equal(ann.invalidOutput, true);
  assert.equal(normalizeArticleGate({ gateVerdict: "accept", gateCriterion: "D", gateScore: 4, gateReason: "r" }).gateVerdict, "accept");
});

test("gateRejectionDetail: borderline は borderline: を前置して却下ログで区別できる", () => {
  const g = normalizeDiscoveryGate({ gateVerdict: "borderline", gateCriterion: "C", gateReason: "惜しい" });
  assert.equal(gateRejectionDetail(g, "discovery"), "borderline:C:惜しい");
  const a = normalizeArticleGate({ gateVerdict: "borderline", gateCriterion: "C", gateScore: 2, gateReason: "惜しい" });
  assert.equal(gateRejectionDetail(a, "article"), "borderline:article:-:惜しい");
});

test("partitionByGate: accepted / borderline / rejected の3分割", () => {
  const { accepted, borderline, rejected } = partitionByGate([
    { title: "a", gateVerdict: "accept", gateCriterion: "D", gateReason: "r" },
    { title: "b", gateVerdict: "borderline", gateCriterion: "A", gateReason: "惜しい" },
    { title: "c", gateVerdict: "reject", gateCriterion: "none", gateReason: "告知" },
    { title: "d", gateVerdict: "borderline", gateCriterion: "A" },
  ]);
  assert.deepEqual(accepted.map((c) => c.title), ["a"]);
  assert.deepEqual(borderline.map((c) => c.title), ["b"]);
  assert.equal(borderline[0].gateCriterion, "A");
  assert.deepEqual(rejected.map((r) => r.cand.title), ["c", "d"]);
  assert.equal(rejected[1].invalidOutput, true);
});

test("summarizeBakeoff: byCriterion に D、borderline 件数を集計。acceptRate は accept のみ", () => {
  const s = summarizeBakeoff([
    { verdict: "accept", criterion: "D", url: "1" },
    { verdict: "accept", criterion: "A", url: "2" },
    { verdict: "borderline", criterion: "B", url: "3" },
    { verdict: "reject", criterion: "none", url: "4" },
  ]);
  assert.deepEqual(s.byCriterion, { A: 1, B: 0, C: 0, D: 1 });
  assert.equal(s.borderline, 1);
  assert.equal(s.accepted, 2);
  assert.equal(s.acceptRate, 0.5);
});

test("プロンプト節: D・borderline の定義・出力形式・具体例・『基準は下げない』を含む", () => {
  const bake = buildBakeoffPrompt({ id: "x", locator: "https://e.com" }, 5);
  for (const [name, p] of [["discovery", discoveryGatePromptSection()], ["article", articleGatePromptSection()], ["bakeoff", bake]]) {
    assert.ok(p.includes("- D:"), `${name}: D`);
    assert.match(p, /borderline/, `${name}: borderline`);
    assert.match(p, /accept \| borderline \| reject/, `${name}: verdict形式`);
    assert.match(p, /A \| B \| C \| D \| none/, `${name}: criterion形式`);
    assert.match(p, /基準を緩める枠ではない/, `${name}: 緩めない明記`);
    assert.match(p, /Auspicious Art/, `${name}: 具体例`);
  }
  assert.match(discoveryGatePromptSection(), /\(e\) 手法の発明/);
});

test("firstCriterion: 単語中の大文字・N/A は基準扱いしない。単独トークンは先頭の基準を採る", () => {
  for (const c of ["Design", "Does not apply", "N/A", "n/a"]) {
    const g = normalizeDiscoveryGate({ gateVerdict: "accept", gateCriterion: c, gateReason: "r" });
    assert.equal(g.gateVerdict, "reject", c);
    assert.equal(g.gateCriterion, "none", c);
  }
  for (const [c, want] of [["A", "A"], ["b", "B"], ["A, C", "A"], ["基準D", "D"], ["B and C", "B"]]) {
    const g = normalizeDiscoveryGate({ gateVerdict: "accept", gateCriterion: c, gateReason: "r" });
    assert.equal(g.gateVerdict, "accept", c);
    assert.equal(g.gateCriterion, want, c);
  }
});

test("発見プロンプト冒頭: 採用基準は A〜D と書かれ、A/B/C のみの記述が残っていない", async () => {
  const { buildDiscoveryPrompt } = await import("../auto-research-cc.mjs");
  const p = buildDiscoveryPrompt({
    lastRunDate: new Date("2026-09-27T00:00:00+09:00"),
    existingTitles: "（既存なし）",
    seenThisRun: [],
    round: 1,
    roundFoci: [{ label: "L", sources: "s", diversity: "d" }],
  });
  assert.ok(!/A\/B\/C(?!\/D)/.test(p), "A/B/C のみの記述なし");
  assert.match(p, /A〜D/);
});
