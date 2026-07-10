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
  isAllowedPattern,
  isDuplicateIdea,
  nextStudioIdeaSeq,
  resolveIdeaRef,
  scoreTechCandidates,
  selectAngles,
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
