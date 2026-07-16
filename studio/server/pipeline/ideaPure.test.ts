/**
 * pipeline/ideaPure.ts の純粋関数テスト（node:test）。
 * ネットワーク・Agent SDK・gitを触らないロジックだけを対象にする
 * （実生成/検証はE2Eの領分。pure.test.tsと同じ方針）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IdeaAngle } from "./ideaAngles.js";
import {
  appendCountShortfallWarning,
  buildIdeaCommitMessage,
  buildIdeaLineText,
  endsWithKamo,
  IDEA_CRITIQUE_DISCARD_THRESHOLD,
  IDEA_CRITIQUE_REVISE_THRESHOLD,
  isAllowedPattern,
  isDuplicateIdea,
  nextStudioIdeaSeq,
  parseChewResult,
  parseCritiqueResult,
  parseReviseResult,
  computeAngleWeights,
  resolveIdeaRef,
  scoreTechCandidates,
  selectAngles,
  sumCritiqueScore,
  tallyIdeaSignalsByAngle,
  validateIdeaRequest,
  type CaseRecord,
  type IdeaEntry,
  type TechRecord,
} from "./ideaPure.js";

// ── validateIdeaRequest ────────────────────────────────────────────
test("validateIdeaRequest: お題ありは valid・件数は既定6", () => {
  const r = validateIdeaRequest({ theme: "空の描き方が美しいMVの企画と演出" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.theme, "空の描き方が美しいMVの企画と演出");
    assert.equal(r.value.count, 6);
    assert.equal(r.value.source, "全事例から");
  }
});

test("validateIdeaRequest: お題が空はエラー", () => {
  const r = validateIdeaRequest({ theme: "   " });
  assert.equal(r.ok, false);
});

test("validateIdeaRequest: sourceは指定値のみ通す（不正値は全事例からにフォールバック）", () => {
  const r1 = validateIdeaRequest({ theme: "x", source: "お気に入り中心" });
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.value.source, "お気に入り中心");

  const r2 = validateIdeaRequest({ theme: "x", source: "謎の値" });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.value.source, "全事例から");
});

test("validateIdeaRequest: countは1〜10にクランプされる", () => {
  const r = validateIdeaRequest({ theme: "x", count: "999" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.count, 10);
});

// ── scoreTechCandidates ────────────────────────────────────────────
const TECH_FIXTURE: TechRecord[] = [
  { id: "sky-render", title: "Sky Render AI", type: "Research", domains: ["Visual/Generative"], summary: "空の描写を生成する", point: "空" },
  { id: "unrelated-tech", title: "Unrelated Tech", type: "Research", domains: ["Audio"], summary: "音声処理", point: "" },
];

test("scoreTechCandidates: キーワード一致でスコアリングされる", () => {
  const result = scoreTechCandidates(TECH_FIXTURE, ["空"], 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "sky-render");
});

test("scoreTechCandidates: 1件もヒットしなければ一様サンプリングにフォールバック（0件にはしない）", () => {
  const result = scoreTechCandidates(TECH_FIXTURE, ["絶対に一致しない文字列xyz"], 5);
  assert.equal(result.length, 2);
});

// ── selectAngles ────────────────────────────────────────────────────
const ANGLES_FIXTURE: IdeaAngle[] = [
  { id: "a1", label: "見立て", description: "d1", exemplarCaseIds: ["case-fav"] },
  { id: "a2", label: "引き算", description: "d2", exemplarCaseIds: ["case-other"] },
  { id: "a3", label: "参加型", description: "d3", exemplarCaseIds: ["case-other2"] },
];

test("selectAngles: 指定件数を返す", () => {
  const picked = selectAngles(ANGLES_FIXTURE, 2, null);
  assert.equal(picked.length, 2);
});

test("selectAngles: countが語彙数を超えても指定件数分埋める", () => {
  const picked = selectAngles(ANGLES_FIXTURE, 5, null);
  assert.equal(picked.length, 5);
});

test("selectAngles: お気に入りに重なるexemplarを持つ切り口が選ばれやすい（重み付き・偏りを統計的に確認）", () => {
  const favorites = new Set(["case-fav"]);
  let a1Count = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const picked = selectAngles(ANGLES_FIXTURE, 1, favorites);
    if (picked[0].id === "a1") a1Count++;
  }
  // 重みなしなら期待値は約1/3(100回)。a1は重み4/(4+1+1)=2/3程度が期待値のため大幅に上回るはず
  assert.ok(a1Count > trials / 3, `a1が${a1Count}/${trials}回選ばれた（重み付けが効いていない）`);
});

// ── tallyIdeaSignalsByAngle（アイデア評価によるsignal集計） ────────────────
const ALLOWED_LABELS = new Set(["見立て", "引き算", "参加型"]);

test("tallyIdeaSignalsByAngle: いいねされたアイデアのpatternにlikesが加算される", () => {
  const ideas = [
    { id: "idea-1", pattern: "見立て" },
    { id: "idea-2", pattern: "見立て" },
    { id: "idea-3", pattern: "引き算" },
  ];
  const likes = new Set(["idea-1", "idea-2"]);
  const trash = new Set<string>();
  const result = tallyIdeaSignalsByAngle(ideas, likes, trash, ALLOWED_LABELS);
  assert.deepEqual(result.get("見立て"), { likes: 2, trash: 0 });
  assert.equal(result.get("引き算"), undefined);
});

test("tallyIdeaSignalsByAngle: ゴミ箱入りアイデアのpatternにtrashが加算される", () => {
  const ideas = [
    { id: "idea-1", pattern: "参加型" },
    { id: "idea-2", pattern: "参加型" },
  ];
  const likes = new Set<string>();
  const trash = new Set(["idea-1", "idea-2"]);
  const result = tallyIdeaSignalsByAngle(ideas, likes, trash, ALLOWED_LABELS);
  assert.deepEqual(result.get("参加型"), { likes: 0, trash: 2 });
});

test("tallyIdeaSignalsByAngle: いいね/ゴミ箱が同一patternに両方あれば両方カウントする", () => {
  const ideas = [
    { id: "idea-1", pattern: "見立て" },
    { id: "idea-2", pattern: "見立て" },
  ];
  const likes = new Set(["idea-1"]);
  const trash = new Set(["idea-2"]);
  const result = tallyIdeaSignalsByAngle(ideas, likes, trash, ALLOWED_LABELS);
  assert.deepEqual(result.get("見立て"), { likes: 1, trash: 1 });
});

test("tallyIdeaSignalsByAngle: A系統の切り口labelに一致しないpattern（B系統の種名等）は無視する", () => {
  const ideas = [{ id: "idea-1", pattern: "seed-xyz-b系統" }];
  const likes = new Set(["idea-1"]);
  const trash = new Set<string>();
  const result = tallyIdeaSignalsByAngle(ideas, likes, trash, ALLOWED_LABELS);
  assert.equal(result.size, 0);
});

test("tallyIdeaSignalsByAngle: いいね/ゴミ箱どちらでもないアイデアは集計されない", () => {
  const ideas = [{ id: "idea-1", pattern: "見立て" }];
  const result = tallyIdeaSignalsByAngle(ideas, new Set(), new Set(), ALLOWED_LABELS);
  assert.equal(result.size, 0);
});

test("tallyIdeaSignalsByAngle: id/patternが欠落したエントリは無視する", () => {
  const ideas = [{ pattern: "見立て" }, { id: "idea-1" }];
  const result = tallyIdeaSignalsByAngle(ideas, new Set(["idea-1"]), new Set(), ALLOWED_LABELS);
  assert.equal(result.size, 0);
});

// ── computeAngleWeights（重み計算。決定的なので実値で検証する） ────────────
test("computeAngleWeights: いいねで重みが増える（+いいね数×2）", () => {
  const signals = new Map([["見立て", { likes: 3, trash: 0 }]]);
  const weights = computeAngleWeights(ANGLES_FIXTURE, null, signals);
  assert.deepEqual(weights, [1 + 3 * 2, 1, 1]);
});

test("computeAngleWeights: ゴミ箱で重みが減る（×0.5^ゴミ箱数）", () => {
  const signals = new Map([["見立て", { likes: 0, trash: 2 }]]);
  const weights = computeAngleWeights(ANGLES_FIXTURE, null, signals);
  assert.deepEqual(weights, [1 * 0.5 ** 2, 1, 1]);
});

test("computeAngleWeights: いいねとゴミ箱が両方あれば加算してから減衰を乗じる", () => {
  const signals = new Map([["見立て", { likes: 3, trash: 2 }]]);
  const weights = computeAngleWeights(ANGLES_FIXTURE, null, signals);
  // (1 + 3*2) * 0.5^2 = 7 * 0.25 = 1.75
  assert.deepEqual(weights, [1.75, 1, 1]);
});

test("computeAngleWeights: 該当signalが無い切り口はお気に入り由来の重みのまま", () => {
  const favorites = new Set(["case-fav"]);
  const signals = new Map([["引き算", { likes: 5, trash: 0 }]]);
  const weights = computeAngleWeights(ANGLES_FIXTURE, favorites, signals);
  // a1(見立て)はfavorites経由で1+1*3=4、a2(引き算)はsignals経由で1+5*2=11、a3は1のまま
  assert.deepEqual(weights, [4, 11, 1]);
});

test("computeAngleWeights: ゴミ箱数が多くても倍率は下限0.2倍まで（0にはならない）", () => {
  const signals = new Map([["見立て", { likes: 0, trash: 10 }]]);
  const weights = computeAngleWeights(ANGLES_FIXTURE, null, signals);
  assert.deepEqual(weights, [1 * 0.2, 1, 1]);
});

test("computeAngleWeights: 縮退（signalsが空のMap）では従来（お気に入りのみ）と重みが完全に一致する", () => {
  const favorites = new Set(["case-fav"]);
  const legacyWeights = ANGLES_FIXTURE.map((a) => 1 + a.exemplarCaseIds.filter((id) => favorites.has(id)).length * 3);
  const weights = computeAngleWeights(ANGLES_FIXTURE, favorites, new Map());
  assert.deepEqual(weights, legacyWeights);

  const legacyWeightsNoFav = ANGLES_FIXTURE.map(() => 1);
  const weightsNoFav = computeAngleWeights(ANGLES_FIXTURE, null, new Map());
  assert.deepEqual(weightsNoFav, legacyWeightsNoFav);
});

// ── selectAngles（アイデア評価シグナルによる重み付け・配線の統合確認） ─────────
test("selectAngles: いいねされたアイデアのある切り口は重みが増え選ばれやすい（統計的に確認）", () => {
  const signals = new Map([["見立て", { likes: 3, trash: 0 }]]);
  let a1Count = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const picked = selectAngles(ANGLES_FIXTURE, 1, null, signals);
    if (picked[0].id === "a1") a1Count++;
  }
  // お気に入り未接続(favoriteCaseIds=null)でも重みなしの期待値1/3を大幅に上回るはず
  assert.ok(a1Count > trials / 3, `a1が${a1Count}/${trials}回選ばれた（いいね重み付けが効いていない）`);
});

test("selectAngles: ゴミ箱入りが多い切り口は重みが減り選ばれにくい（統計的に確認）", () => {
  const signals = new Map([["見立て", { likes: 0, trash: 5 }]]);
  let a1Count = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const picked = selectAngles(ANGLES_FIXTURE, 1, null, signals);
    if (picked[0].id === "a1") a1Count++;
  }
  // 重みなしの期待値1/3を大幅に下回るはず（下限0.2倍まで減衰）
  assert.ok(a1Count < trials / 3, `a1が${a1Count}/${trials}回選ばれた（ゴミ箱減衰が効いていない）`);
});

test("selectAngles: signalsを省略した場合は空Map扱いで従来と同一の一様分布になる", () => {
  const picked = selectAngles(ANGLES_FIXTURE, 3, null);
  assert.equal(picked.length, 3);
});

// ── endsWithKamo / isAllowedPattern ─────────────────────────────────
test("endsWithKamo: 「かも。」で終わればtrue", () => {
  assert.equal(endsWithKamo("こんなことができるかも。"), true);
  assert.equal(endsWithKamo("こんなことができるかもしれない"), false);
  assert.equal(endsWithKamo("こんなことができそう。"), false);
});

test("isAllowedPattern: 許可ラベル集合に含まれる文字列のみtrue", () => {
  const allowed = new Set(["見立て", "引き算"]);
  assert.equal(isAllowedPattern("見立て", allowed), true);
  assert.equal(isAllowedPattern("転用", allowed), false);
  assert.equal(isAllowedPattern(123, allowed), false);
});

// ── resolveIdeaRef ──────────────────────────────────────────────────
const CASE_BY_ID = new Map<string, CaseRecord>([
  ["case-1", { id: "case-1", title: "Case One", summary: "サマリー1" }],
]);
const TECH_BY_ID = new Map<string, TechRecord>([
  ["tech-1", { id: "tech-1", title: "Tech One", summary: "テックサマリー" }],
]);

test("resolveIdeaRef: 許可id集合内のcase参照を解決する", () => {
  const allowed = new Set(["case-1"]);
  const resolved = resolveIdeaRef({ type: "case", id: "case-1", desc: "モデル生成desc" }, allowed, CASE_BY_ID, TECH_BY_ID);
  assert.deepEqual(resolved, { type: "case", id: "case-1", title: "Case One", desc: "モデル生成desc" });
});

test("resolveIdeaRef: 許可id集合外のidはnull（未提示idの創作を防ぐ）", () => {
  const allowed = new Set(["tech-1"]); // case-1 は許可されていない
  const resolved = resolveIdeaRef({ type: "case", id: "case-1", desc: "x" }, allowed, CASE_BY_ID, TECH_BY_ID);
  assert.equal(resolved, null);
});

test("resolveIdeaRef: descが空ならsummaryにフォールバックする", () => {
  const allowed = new Set(["tech-1"]);
  const resolved = resolveIdeaRef({ type: "tech", id: "tech-1", desc: "" }, allowed, CASE_BY_ID, TECH_BY_ID);
  assert.equal(resolved?.desc, "テックサマリー");
});

test("resolveIdeaRef: 不正な形状はnull", () => {
  const allowed = new Set(["case-1"]);
  assert.equal(resolveIdeaRef(null, allowed, CASE_BY_ID, TECH_BY_ID), null);
  assert.equal(resolveIdeaRef({ type: "unknown", id: "case-1" }, allowed, CASE_BY_ID, TECH_BY_ID), null);
});

// ── isDuplicateIdea ─────────────────────────────────────────────────
test("isDuplicateIdea: タイトル正規化(大文字小文字・空白・記号)一致は重複扱い", () => {
  // normTitle（scripts/lib/norm-title.mjs）は大小文字・空白・全角/半角括弧等の記号のみ無視する
  // （年号は無視しない。normalizeTitleKeyとは別物 — pure.test.tsのnormalizeTitleKeyと混同しないこと）
  const existing = [{ title: "The Blank　Edition", seed: "seedA" }];
  assert.equal(isDuplicateIdea({ title: "the blank edition", seed: "seedB" }, existing), true);
});

test("isDuplicateIdea: seed完全一致は重複扱い", () => {
  const existing = [{ title: "Other Title", seed: "全く同じseedかも。" }];
  assert.equal(isDuplicateIdea({ title: "Different Title", seed: "全く同じseedかも。" }, existing), true);
});

test("isDuplicateIdea: 一致しなければfalse", () => {
  const existing = [{ title: "Other Title", seed: "他のseedかも。" }];
  assert.equal(isDuplicateIdea({ title: "New Title", seed: "新しいseedかも。" }, existing), false);
});

// ── nextStudioIdeaSeq ───────────────────────────────────────────────
test("nextStudioIdeaSeq: studio-プレフィックスの当日最大連番を返す", () => {
  const existing = [
    { id: "studio-2026-07-10-1", date: "2026-07-10" },
    { id: "studio-2026-07-10-3", date: "2026-07-10" }, // 欠番があっても最大値を見る
    { id: "2026-07-10-9", date: "2026-07-10" }, // デイリー採番は無視する
    { id: "studio-2026-07-09-5", date: "2026-07-09" }, // 別日は無視する
  ];
  assert.equal(nextStudioIdeaSeq(existing, "2026-07-10"), 3);
});

test("nextStudioIdeaSeq: 該当なしは0", () => {
  assert.equal(nextStudioIdeaSeq([], "2026-07-10"), 0);
});

// ── buildIdeaCommitMessage / buildIdeaLineText ───────────────────────
test("buildIdeaCommitMessage: お題と件数を含む", () => {
  const msg = buildIdeaCommitMessage("空の描き方が美しいMV", 6);
  assert.match(msg, /空の描き方が美しいMV/);
  assert.match(msg, /6案/);
});

test("buildIdeaLineText: お題・件数・切り口・seed・commitを含む", () => {
  const entries: IdeaEntry[] = [
    {
      id: "studio-2026-07-10-1",
      date: "2026-07-10",
      title: "空の余白演出",
      pattern: "引き算",
      seed: "空を映さないことで想像を掻き立てられるかも。",
      refs: [{ type: "case", id: "case-1", title: "Case One", desc: "説明" }],
      rationale: "余白があることで受け手の想像力を引き出せるから",
      scores: { discovery: 4, surprise: 3, conviction: 4 },
    },
  ];
  const text = buildIdeaLineText({ theme: "空の描き方", entries, verified: true, commitHash: "abcdef1234567890", site: "https://example.com" });
  assert.match(text, /空の描き方/);
  assert.match(text, /1案追加/);
  assert.match(text, /本番反映OK/);
  assert.match(text, /引き算/);
  assert.match(text, /空を映さないことで想像を掻き立てられるかも。/);
  assert.match(text, /Case One/);
  assert.match(text, /https:\/\/example\.com\/ideas/);
  assert.match(text, /abcdef12/);
});

test("buildIdeaLineText: verified=falseは時間切れ文言になる", () => {
  const text = buildIdeaLineText({ theme: "x", entries: [], verified: false, commitHash: null, site: "https://example.com" });
  assert.match(text, /反映確認は時間切れ/);
  assert.match(text, /unknown/);
});

// ── appendCountShortfallWarning ───────────────────────────────────
// adversarial-reviewer指摘: 検証通過数が依頼数未満でも従来は無警告でコミットしていた。
// DESIGN §6・caseResearch.ts(P1)と同じ「不足時はあるだけで進み、その旨を結果に明記」流儀。
test("appendCountShortfallWarning: 通過数が依頼数に届いていれば警告なし（既存警告もそのまま）", () => {
  assert.equal(appendCountShortfallWarning(6, 6, undefined), undefined);
  assert.equal(appendCountShortfallWarning(8, 6, undefined), undefined); // 依頼数超過も警告なし
  assert.equal(appendCountShortfallWarning(6, 6, "既存警告"), "既存警告");
});

test("appendCountShortfallWarning: 通過数が依頼数未満なら不足を明記した警告を返す", () => {
  const warning = appendCountShortfallWarning(1, 6, undefined);
  assert.match(warning ?? "", /1案/);
  assert.match(warning ?? "", /依頼6案/);
});

test("appendCountShortfallWarning: 既存警告(お気に入り未接続等)があれば連結する", () => {
  const warning = appendCountShortfallWarning(2, 6, "お気に入りデータ未接続のため全事例から生成しました");
  assert.match(warning ?? "", /お気に入りデータ未接続/);
  assert.match(warning ?? "", /2案でした（依頼6案）/);
});

// ── validateIdeaRequest: dryRun ──────────────────────────────────────
test("validateIdeaRequest: dryRunはtrueのみtrue、未指定・不正値はfalse", () => {
  const r1 = validateIdeaRequest({ theme: "x", dryRun: true });
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.value.dryRun, true);

  const r2 = validateIdeaRequest({ theme: "x" });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.value.dryRun, false);

  const r3 = validateIdeaRequest({ theme: "x", dryRun: "true" });
  assert.equal(r3.ok, true);
  if (r3.ok) assert.equal(r3.value.dryRun, false);
});

// ── parseChewResult（咀嚼フェーズのJSON解析） ─────────────────────────
test("parseChewResult: 正常なJSON配列をパースする", () => {
  const text = `前置き\n[{"angle": "見立て", "elements": ["要素1", "要素2"], "partials": ["部分アイデア1", "部分アイデア2"]}]\n後書き`;
  const result = parseChewResult(text);
  assert.deepEqual(result, [{ angle: "見立て", elements: ["要素1", "要素2"], partials: ["部分アイデア1", "部分アイデア2"] }]);
});

test("parseChewResult: JSONとして解釈できなければnull（呼び出し側が空配列にフォールバックする）", () => {
  assert.equal(parseChewResult("これはJSONではありません"), null);
});

test("parseChewResult: angle欠落の要素は捨て、elements/partialsの非文字列は除外する", () => {
  const text = `[{"elements": ["x"], "partials": ["y"]}, {"angle": "引き算", "elements": ["e1", 123, "e2"], "partials": [456, "p1"]}]`;
  const result = parseChewResult(text);
  assert.deepEqual(result, [{ angle: "引き算", elements: ["e1", "e2"], partials: ["p1"] }]);
});

// ── critique（採点）: 定数・sumCritiqueScore・parseCritiqueResult ──────────
test("IDEA_CRITIQUE_REVISE_THRESHOLD > IDEA_CRITIQUE_DISCARD_THRESHOLD（改稿閾値は破棄閾値より高い）", () => {
  assert.ok(IDEA_CRITIQUE_REVISE_THRESHOLD > IDEA_CRITIQUE_DISCARD_THRESHOLD);
  assert.ok(IDEA_CRITIQUE_REVISE_THRESHOLD <= 15);
  assert.ok(IDEA_CRITIQUE_DISCARD_THRESHOLD >= 3);
});

test("sumCritiqueScore: 3軸の合計を返す", () => {
  assert.equal(sumCritiqueScore({ discovery: 4, surprise: 3, conviction: 5 }), 12);
});

test("parseCritiqueResult: 正常なJSON配列をパースする", () => {
  const text = `[{"id": "studio-2026-07-10-1", "discovery": 4, "surprise": 3, "conviction": 5, "note": "もう少し具体を"}]`;
  const result = parseCritiqueResult(text);
  assert.deepEqual(result, [{ id: "studio-2026-07-10-1", discovery: 4, surprise: 3, conviction: 5, note: "もう少し具体を" }]);
});

test("parseCritiqueResult: 範囲外・小数はクランプ・四捨五入する", () => {
  const text = `[{"id": "x", "discovery": 0, "surprise": 7.6, "conviction": 3.4}]`;
  const result = parseCritiqueResult(text);
  assert.deepEqual(result, [{ id: "x", discovery: 1, surprise: 5, conviction: 3 }]);
});

test("parseCritiqueResult: idや数値が欠落した要素は捨てる", () => {
  const text = `[{"discovery": 4, "surprise": 3, "conviction": 5}, {"id": "ok", "discovery": 4, "surprise": "abc", "conviction": 5}]`;
  const result = parseCritiqueResult(text);
  assert.deepEqual(result, []);
});

test("parseCritiqueResult: JSONとして解釈できなければnull", () => {
  assert.equal(parseCritiqueResult("not json"), null);
});

// ── parseReviseResult（改稿結果のJSON解析） ────────────────────────────
test("parseReviseResult: 正常なJSON配列をパースする", () => {
  const text = `[{"id": "studio-1", "title": "新タイトル", "seed": "改稿後のseedかも。", "rationale": "理由", "refs": [{"type": "case", "id": "case-1", "desc": "d"}]}]`;
  const result = parseReviseResult(text);
  assert.deepEqual(result, [
    { id: "studio-1", title: "新タイトル", seed: "改稿後のseedかも。", rationale: "理由", refs: [{ type: "case", id: "case-1", desc: "d" }] },
  ]);
});

test("parseReviseResult: id/title/seedが欠落した要素は捨てる", () => {
  const text = `[{"title": "x", "seed": "yかも。"}, {"id": "ok", "seed": "zかも。"}]`;
  const result = parseReviseResult(text);
  assert.deepEqual(result, []);
});

test("parseReviseResult: refs/rationale省略時は空配列/空文字で補う", () => {
  const text = `[{"id": "studio-1", "title": "t", "seed": "sかも。"}]`;
  const result = parseReviseResult(text);
  assert.deepEqual(result, [{ id: "studio-1", title: "t", seed: "sかも。", rationale: "", refs: [] }]);
});

test("parseReviseResult: JSONとして解釈できなければnull", () => {
  assert.equal(parseReviseResult("not json"), null);
});
