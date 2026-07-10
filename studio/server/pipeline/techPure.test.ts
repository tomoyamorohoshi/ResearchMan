/**
 * pipeline/techPure.ts の純粋関数テスト（node:test）。
 * pure.test.ts（Case Study）と同じ方針: ネットワーク・Agent SDK・gitを触らない
 * ロジックのみを対象にする（一次ソース死活・サムネイル取得はtechResearch.tsのE2E領分）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExistingTechIndex,
  buildTechCommitMessage,
  buildTechEntry,
  findPrimaryLink,
  isProxyUrl,
  isValidDateFormat,
  filterValidDomains,
  toTechId,
  validateAndDedupeTechCandidates,
  type TechVocab,
} from "./techPure.js";

const VOCAB: TechVocab = {
  Domain: ["Spatial/3D", "GenVideo", "CreatorTools"],
  Type: ["Research", "Prototype", "Tool"],
};

// ── toTechId ────────────────────────────────────────────────────
test("toTechId: 英語名は小文字スラッグ化される", () => {
  assert.equal(toTechId("Wild3R"), "wild3r");
});

test("toTechId: 括弧・コロン以降は除去される", () => {
  assert.equal(toTechId("SpatialClaw (NVIDIA)"), "spatialclaw");
  assert.equal(toTechId("Foo: A New Method"), "foo");
});

test("toTechId: 60文字で切り詰められる", () => {
  const long = "A".repeat(100);
  assert.ok(toTechId(long).length <= 60);
});

// ── isValidDateFormat ─────────────────────────────────────────────
test("isValidDateFormat: YYYY-MM形式はtrue", () => {
  assert.equal(isValidDateFormat("2026-06"), true);
});

test("isValidDateFormat: 不正な形式はfalse", () => {
  assert.equal(isValidDateFormat("2026/06"), false);
  assert.equal(isValidDateFormat("2026"), false);
  assert.equal(isValidDateFormat(""), false);
  assert.equal(isValidDateFormat(undefined), false);
});

// ── isProxyUrl ──────────────────────────────────────────────────
test("isProxyUrl: t.co / r.jina.ai はプロキシURL扱い", () => {
  assert.equal(isProxyUrl("https://t.co/abc123"), true);
  assert.equal(isProxyUrl("https://r.jina.ai/https://example.com"), true);
});

test("isProxyUrl: 通常ドメインはfalse（部分一致で誤爆しない）", () => {
  assert.equal(isProxyUrl("https://github.com/foo/bar"), false);
  assert.equal(isProxyUrl("https://producthunt.com/posts/x"), false);
  assert.equal(isProxyUrl("not a url"), false);
});

// ── findPrimaryLink ─────────────────────────────────────────────
test("findPrimaryLink: github/project/productの先頭を返す", () => {
  const link = findPrimaryLink([
    { kind: "post", url: "https://x.com/a" },
    { kind: "github", url: "https://github.com/a/b" },
  ]);
  assert.equal(link?.url, "https://github.com/a/b");
});

test("findPrimaryLink: 一次ソースが無ければundefined", () => {
  const link = findPrimaryLink([{ kind: "post", url: "https://x.com/a" }]);
  assert.equal(link, undefined);
});

// ── filterValidDomains ────────────────────────────────────────────
test("filterValidDomains: 語彙内のみ残す", () => {
  const domains = filterValidDomains(["Spatial/3D", "Nonexistent", "GenVideo"], VOCAB);
  assert.deepEqual(domains, ["Spatial/3D", "GenVideo"]);
});

test("filterValidDomains: 配列でなければ空配列", () => {
  assert.deepEqual(filterValidDomains(undefined, VOCAB), []);
});

// ── buildExistingTechIndex ─────────────────────────────────────────
test("buildExistingTechIndex: id/正規化タイトルを集める", () => {
  const idx = buildExistingTechIndex([{ id: "wild3r", title: "Wild3R" }]);
  assert.ok(idx.ids.has("wild3r"));
  assert.ok(idx.titleKeys.size === 1);
});

// ── validateAndDedupeTechCandidates ────────────────────────────────
function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    techName: "Brand New Tech",
    org: "Acme Labs",
    type: "Research",
    domains: ["Spatial/3D"],
    date: "2026-06",
    links: [{ kind: "github", url: "https://github.com/acme/brand-new-tech" }],
    license: { spdx: "MIT", commercial: "ok" },
    summaryJa: "概要です。",
    pointJa: "ポイントです。",
    detailJa: "詳細です。",
    relatedWorks: [],
    thumbnailSource: "https://example.com/thumb.jpg",
    verdict: "adopt",
    ...overrides,
  };
}

test("validateAndDedupeTechCandidates: 有効な候補は採用される", () => {
  const existingTech = buildExistingTechIndex([]);
  const existingCaseTitleKeys = new Set<string>();
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate()],
    VOCAB,
    existingTech,
    existingCaseTitleKeys,
  );
  assert.equal(rejected.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, "brand-new-tech");
  assert.equal(accepted[0].title, "Brand New Tech");
  assert.deepEqual(accepted[0].domains, ["Spatial/3D"]);
});

test("validateAndDedupeTechCandidates: verdictがadopt以外は却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ verdict: "reject" })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 1);
});

test("validateAndDedupeTechCandidates: 既存tech.jsonとid一致は却下", () => {
  const existingTech = buildExistingTechIndex([{ id: "brand-new-tech", title: "Something Else" }]);
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate()],
    VOCAB,
    existingTech,
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 1);
});

test("validateAndDedupeTechCandidates: 既存tech.jsonと正規化タイトル一致は却下", () => {
  const existingTech = buildExistingTechIndex([{ id: "other-id-2026", title: "Brand New Tech!!" }]);
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate()],
    VOCAB,
    existingTech,
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 1);
});

test("validateAndDedupeTechCandidates: Case Studyとタイトル重複は却下", () => {
  const existingCaseTitleKeys = new Set(["brandnewtech"]);
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate()],
    VOCAB,
    buildExistingTechIndex([]),
    existingCaseTitleKeys,
  );
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /Case Study/);
});

test("validateAndDedupeTechCandidates: バッチ内の自己重複は1件に絞る", () => {
  const { accepted } = validateAndDedupeTechCandidates(
    [baseCandidate(), baseCandidate()],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 1);
});

test("validateAndDedupeTechCandidates: 不正typeは却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ type: "Nonsense" })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /type/);
});

test("validateAndDedupeTechCandidates: domainsが全て語彙外なら却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ domains: ["Nonexistent"] })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /domain/i);
});

test("validateAndDedupeTechCandidates: 不正なdate形式は却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ date: "2026" })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /date/i);
});

test("validateAndDedupeTechCandidates: 一次ソース（github/project/product）が無ければ却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ links: [{ kind: "post", url: "https://x.com/a" }] })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /一次ソース/);
});

test("validateAndDedupeTechCandidates: プロキシURL混入は却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ links: [{ kind: "github", url: "https://r.jina.ai/https://github.com/a/b" }] })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /プロキシ/);
});

test("validateAndDedupeTechCandidates: summary/pointが欠落していれば却下", () => {
  const { accepted, rejected } = validateAndDedupeTechCandidates(
    [baseCandidate({ summaryJa: "" })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 0);
  assert.ok(rejected.length === 1);
});

test("validateAndDedupeTechCandidates: detailJaは無くても採用される（任意項目）", () => {
  const { accepted } = validateAndDedupeTechCandidates(
    [baseCandidate({ detailJa: "" })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].detail, undefined);
});

test("validateAndDedupeTechCandidates: licenseが無ければcommercial=noneでデフォルト補完", () => {
  const { accepted } = validateAndDedupeTechCandidates(
    [baseCandidate({ license: undefined })],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].license.commercial, "none");
  assert.equal(accepted[0].license.spdx, null);
});

// ── buildTechEntry ──────────────────────────────────────────────
test("buildTechEntry: tech.jsonスキーマの全フィールドを組み立てる", () => {
  const { accepted } = validateAndDedupeTechCandidates(
    [baseCandidate()],
    VOCAB,
    buildExistingTechIndex([]),
    new Set(),
  );
  const entry = buildTechEntry(accepted[0], "/thumbnails/tech/brand-new-tech.jpg", "Batch Research");
  assert.equal(entry.id, "brand-new-tech");
  assert.equal(entry.thumbnail, "/thumbnails/tech/brand-new-tech.jpg");
  assert.deepEqual(entry.sources, ["Batch Research"]);
  assert.equal(entry.year, "2026");
  assert.equal(entry.detail, "詳細です。");
});

// ── buildTechCommitMessage ────────────────────────────────────────
test("buildTechCommitMessage: テーマと件数とTechnologyラベルを含む", () => {
  const msg = buildTechCommitMessage("MV映像テクノロジー", 3);
  assert.match(msg, /MV映像テクノロジー/);
  assert.match(msg, /3件/);
  assert.match(msg, /Technology/);
});
