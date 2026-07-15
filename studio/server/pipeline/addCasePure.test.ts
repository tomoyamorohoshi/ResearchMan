/**
 * pipeline/addCasePure.ts の純粋関数テスト（node:test）。
 * ネットワーク・Agent SDK・gitを触らないロジックだけを対象にする
 * （実URL取得/検証/commitはE2Eテストで検証。既存 pure.test.ts と同じ方針）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAddCaseCommitMessage,
  buildAddCaseEntry,
  buildAddTechCommitMessage,
  buildWriterFieldsFromAgentOutput,
  ensureUniqueCaseId,
  ensureUniqueTechId,
  extractJsonObject,
  findDuplicateCase,
  findExistingCaseTitleForTech,
  findExistingTechTitle,
  isUsableCandidate,
  isXLink,
  normalizeYear,
  parseContentKind,
  parseExtractedCandidate,
  parseExtractedTechCandidate,
  validateAddCaseRequest,
  validateTechCandidateAllowingFallbackSource,
} from "./addCasePure.js";
import { buildExistingTechIndex, type TechVocab } from "./techPure.js";

// ── validateAddCaseRequest ──────────────────────────────────────

test("validateAddCaseRequest: 有効なurlはvalid（context/lineUserId/dryRunは既定値）", () => {
  const r = validateAddCaseRequest({ url: "https://example.com/article" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.url, "https://example.com/article");
    assert.equal(r.value.context, "");
    assert.equal(r.value.lineUserId, "");
    assert.equal(r.value.dryRun, false);
  }
});

test("validateAddCaseRequest: context/lineUserId/dryRunを受け取れる", () => {
  const r = validateAddCaseRequest({
    url: "https://example.com/article",
    context: "音楽視点で",
    lineUserId: "U123",
    dryRun: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.context, "音楽視点で");
    assert.equal(r.value.lineUserId, "U123");
    assert.equal(r.value.dryRun, true);
  }
});

test("validateAddCaseRequest: urlが空はエラー", () => {
  const r = validateAddCaseRequest({});
  assert.equal(r.ok, false);
});

test("validateAddCaseRequest: http(s)以外のurlはエラー", () => {
  const r = validateAddCaseRequest({ url: "ftp://example.com/x" });
  assert.equal(r.ok, false);
});

// ── isXLink ────────────────────────────────────────────────────

test("isXLink: x.com/twitter.comはtrue", () => {
  assert.equal(isXLink("https://x.com/user/status/123"), true);
  assert.equal(isXLink("https://twitter.com/user/status/123"), true);
  assert.equal(isXLink("https://www.x.com/user/status/123"), true);
});

test("isXLink: それ以外のドメインはfalse", () => {
  assert.equal(isXLink("https://example.com/article"), false);
});

test("isXLink: 不正なURLはfalse（例外を投げない）", () => {
  assert.equal(isXLink("not a url"), false);
});

// ── extractJsonObject ────────────────────────────────────────────

test("extractJsonObject: 前後に説明文があってもJSONオブジェクトを抽出できる", () => {
  const text = 'わかりました:\n{"found":true,"title":"A"}\n以上です。';
  assert.deepEqual(extractJsonObject(text), { found: true, title: "A" });
});

test("extractJsonObject: オブジェクトを含まない配列（プリミティブのみ）はnull", () => {
  assert.equal(extractJsonObject("[1, 2, 3]"), null);
});

test("extractJsonObject: JSONが無ければnull", () => {
  assert.equal(extractJsonObject("該当なし"), null);
});

test("extractJsonObject: 壊れたJSONはnull", () => {
  assert.equal(extractJsonObject("{title: broken}"), null);
});

// ── parseExtractedCandidate / isUsableCandidate ──────────────────

test("parseExtractedCandidate: foundが明示的にtrueかつ必須項目ありは使用可能", () => {
  const c = parseExtractedCandidate({
    found: true,
    title: "AI事例",
    client: "Acme",
    agency: "",
    year: "2026",
    link: "https://example.com/a",
    award: "",
    summary: "概要",
    youtubeId: "",
  });
  assert.equal(isUsableCandidate(c), true);
  assert.equal(c.title, "AI事例");
  assert.equal(c.year, "2026");
});

test("parseExtractedCandidate: found未指定はfalse扱い（見切り発車で埋めない）", () => {
  const c = parseExtractedCandidate({ title: "何か", year: "2026", link: "https://example.com/a" });
  assert.equal(c.found, false);
  assert.equal(isUsableCandidate(c), false);
});

test("parseExtractedCandidate: found:falseはreasonを保持する", () => {
  const c = parseExtractedCandidate({ found: false, reason: "一次ソースが見つかりませんでした" });
  assert.equal(c.found, false);
  assert.equal(c.reason, "一次ソースが見つかりませんでした");
  assert.equal(isUsableCandidate(c), false);
});

test("isUsableCandidate: foundがtrueでもtitle/year/linkが欠落していれば使用不可", () => {
  const c = parseExtractedCandidate({ found: true, title: "", year: "2026", link: "https://example.com/a" });
  assert.equal(isUsableCandidate(c), false);
});

// ── parseContentKind（要件1: case/tech/neitherの自動振り分け） ───────────

test("parseContentKind: 'case'はそのまま'case'", () => {
  assert.equal(parseContentKind({ contentKind: "case" }), "case");
});

test("parseContentKind: 'tech'はそのまま'tech'", () => {
  assert.equal(parseContentKind({ contentKind: "tech" }), "tech");
});

test("parseContentKind: 未指定はneither扱い（fail-closed）", () => {
  assert.equal(parseContentKind({}), "neither");
});

test("parseContentKind: 想定外の値もneither扱い（見切り発車で倒さない）", () => {
  assert.equal(parseContentKind({ contentKind: "something-else" }), "neither");
});

// ── parseExtractedTechCandidate（contentKind:"tech"時のtechPure.RawTechCandidate変換） ──

test("parseExtractedTechCandidate: 各フィールドをRawTechCandidateへ写し、verdictは常にadopt", () => {
  const raw = parseExtractedTechCandidate({
    techName: "SuperTool",
    org: "Acme Labs",
    type: "Tool",
    domains: ["CreatorTools"],
    date: "2026-05",
    links: [{ kind: "github", url: "https://github.com/acme/supertool" }],
    license: { spdx: "MIT", commercial: "ok" },
    summaryJa: "概要",
    pointJa: "ポイント",
    detailJa: "詳細",
    relatedWorks: [],
    thumbnailSource: "https://github.com/acme/supertool",
  });
  assert.equal(raw.techName, "SuperTool");
  assert.equal(raw.org, "Acme Labs");
  assert.equal(raw.type, "Tool");
  assert.deepEqual(raw.domains, ["CreatorTools"]);
  assert.equal(raw.date, "2026-05");
  assert.equal(raw.verdict, "adopt");
});

test("parseExtractedTechCandidate: verdictはAgent出力に何があっても常にadoptで上書き", () => {
  const raw = parseExtractedTechCandidate({ techName: "X", verdict: "reject" });
  assert.equal(raw.verdict, "adopt");
});

// ── findExistingTechTitle（tech重複時の既存タイトル表示） ─────────────────

test("findExistingTechTitle: idが一致すれば既存タイトルを返す", () => {
  const existing = [{ id: "supertool", title: "SuperTool 公式" }];
  assert.equal(findExistingTechTitle("SuperTool", existing), "SuperTool 公式");
});

test("findExistingTechTitle: 正規化タイトルが一致すれば既存タイトルを返す", () => {
  const existing = [{ id: "other-id", title: "Super Tool (2024)" }];
  assert.equal(findExistingTechTitle("super tool", existing), "Super Tool (2024)");
});

test("findExistingTechTitle: 一致しなければnull", () => {
  const existing = [{ id: "other-id", title: "全然違う技術" }];
  assert.equal(findExistingTechTitle("SuperTool", existing), null);
});

// ── findExistingCaseTitleForTech（修正2: Case Study衝突時の既存タイトル探索） ─────

test("findExistingCaseTitleForTech: cases.json側の正規化タイトルが一致すれば既存タイトルを返す", () => {
  const existingCases = [{ id: "brand-tool-2026", title: "Brand Tool (2026)" }];
  assert.equal(findExistingCaseTitleForTech("brand tool", existingCases), "Brand Tool (2026)");
});

test("findExistingCaseTitleForTech: 一致しなければnull", () => {
  const existingCases = [{ id: "other-case-2026", title: "全然違う事例" }];
  assert.equal(findExistingCaseTitleForTech("SuperTool", existingCases), null);
});

// ── ensureUniqueTechId（要件5: id衝突ガードをtech側にも適用） ───────────────

test("ensureUniqueTechId: 衝突がなければbaseIdをそのまま返す", () => {
  const existing = new Set(["other-tech"]);
  assert.equal(ensureUniqueTechId("supertool", existing), "supertool");
});

test("ensureUniqueTechId: 1件衝突していれば-2サフィックスを付ける", () => {
  const existing = new Set(["supertool"]);
  assert.equal(ensureUniqueTechId("supertool", existing), "supertool-2");
});

test("ensureUniqueTechId: ちょうど60字のbaseIdが衝突していれば60字以内に収めて一意化する", () => {
  const baseId = "b".repeat(60);
  const existing = new Set([baseId]);
  const result = ensureUniqueTechId(baseId, existing);
  assert.ok(result.length <= 60, `expected length<=60, got ${result.length}`);
  assert.notEqual(result, baseId);
  assert.ok(!existing.has(result));
});

// ── findDuplicateCase ────────────────────────────────────────────

test("findDuplicateCase: idが既存と一致すれば重複", () => {
  const existing = [{ id: "same-id-2026", title: "既存タイトル", link: "https://example.com/existing" }];
  const dup = findDuplicateCase({ id: "same-id-2026", title: "別タイトル", link: "https://example.com/new" }, existing);
  assert.deepEqual(dup, { id: "same-id-2026", title: "既存タイトル" });
});

test("findDuplicateCase: 正規化タイトルが一致すれば重複", () => {
  const existing = [{ id: "existing-2026", title: "The Blank Edition (2018)", link: "https://example.com/existing" }];
  const dup = findDuplicateCase(
    { id: "new-id-2026", title: "the blank edition", link: "https://example.com/new" },
    existing,
  );
  assert.deepEqual(dup, { id: "existing-2026", title: "The Blank Edition (2018)" });
});

test("findDuplicateCase: 正規化リンクが一致すれば重複（末尾スラッシュ・大文字小文字の差異を無視）", () => {
  const existing = [{ id: "existing-2026", title: "既存", link: "https://Example.com/article/" }];
  const dup = findDuplicateCase(
    { id: "new-id-2026", title: "別タイトル", link: "https://example.com/article" },
    existing,
  );
  assert.deepEqual(dup, { id: "existing-2026", title: "既存" });
});

test("findDuplicateCase: 一致しなければnull", () => {
  const existing = [{ id: "existing-2026", title: "既存", link: "https://example.com/existing" }];
  const dup = findDuplicateCase({ id: "new-2026", title: "新規", link: "https://example.com/new" }, existing);
  assert.equal(dup, null);
});

// ── buildAddCaseEntry ────────────────────────────────────────────

test("buildAddCaseEntry: sourcesは常に['User']固定", () => {
  const entry = buildAddCaseEntry({
    id: "brand-new-case-2026",
    title: "Brand New Case",
    client: "Acme",
    agency: "",
    year: 2026,
    link: "https://example.com/new",
    thumbnail: "/thumbnails/brand-new-case-2026.jpg",
    videoId: "",
    writer: {
      summary: "summary",
      categories: [],
      award: "",
      regions: [],
      tags: ["Tech/AI"],
      overview: "overview",
      background: "background",
      execution: "execution",
      evaluationImpact: "impact",
      relatedWorks: [],
    },
  });
  assert.deepEqual(entry.sources, ["User"]);
  assert.equal(entry.id, "brand-new-case-2026");
  assert.equal(entry.year, "2026");
  assert.deepEqual(entry.categories, ["コンテンツ革新"]);
  assert.deepEqual(entry.regions, ["グローバル"]);
});

// ── buildAddCaseCommitMessage ─────────────────────────────────────

test("buildAddCaseCommitMessage: タイトルを含む", () => {
  const msg = buildAddCaseCommitMessage("Brand New Case");
  assert.match(msg, /Brand New Case/);
});

// ── buildAddTechCommitMessage（修正1: tech振り分け時専用のcommit文言） ────────

test("buildAddTechCommitMessage: タイトルを含み、日次バッチ（techPure.buildTechCommitMessage）の文言と異なる", () => {
  const msg = buildAddTechCommitMessage("SuperTool");
  assert.match(msg, /SuperTool/);
  assert.match(msg, /Studio\(LINE\) 技術追加/);
  assert.doesNotMatch(msg, /Studio research:/);
  assert.doesNotMatch(msg, /\(Technology\)/);
});

// ── normalizeYear（指摘1: yearのサニタイズ） ─────────────────────

test("normalizeYear: 「2024/25」のようなスラッシュ混じりは最初の4桁を抽出する", () => {
  assert.equal(normalizeYear("2024/25"), "2024");
});

test("normalizeYear: 数値はそのまま文字列化して返す", () => {
  assert.equal(normalizeYear(2026), "2026");
});

test("normalizeYear: 4桁の連続数字が無ければnull", () => {
  assert.equal(normalizeYear("unknown"), null);
});

test("normalizeYear: 「'24年」のように4桁が取れないケースもnull", () => {
  assert.equal(normalizeYear("'24年"), null);
});

// ── buildWriterFieldsFromAgentOutput（指摘2: 未照合awardの復活防止） ────────

const TAG_VOCAB = { Tech: ["AI"], Form: ["動画"], Theme: ["音楽"] };

test("buildWriterFieldsFromAgentOutput: writerItemの自己申告awardは無視し、verifiedAwardが空なら空になる", () => {
  const writer = buildWriterFieldsFromAgentOutput(
    {
      summary: "概要",
      categories: ["A"],
      award: "カンヌ金賞（未確認）",
      regions: ["日本"],
      tags: ["AI"],
      overview: "overview",
      background: "background",
      execution: "execution",
      evaluationImpact: "impact",
      relatedWorks: [],
    },
    TAG_VOCAB,
    "",
  );
  assert.equal(writer.award, "");
});

test("buildWriterFieldsFromAgentOutput: verifiedAwardが非空ならその値がそのまま採用される（writerItem.awardの値に関わらず）", () => {
  const writer = buildWriterFieldsFromAgentOutput(
    {
      summary: "概要",
      categories: [],
      award: "自己申告の受賞（無視されるべき）",
      regions: [],
      tags: [],
      overview: "",
      background: "",
      execution: "",
      evaluationImpact: "",
      relatedWorks: [],
    },
    TAG_VOCAB,
    "カンヌライオンズ 金賞",
  );
  assert.equal(writer.award, "カンヌライオンズ 金賞");
});

// ── ensureUniqueCaseId（id衝突時の連番一意化） ────────────────────

test("ensureUniqueCaseId: 衝突がなければbaseIdをそのまま返す", () => {
  const existing = new Set(["other-id-2026"]);
  assert.equal(ensureUniqueCaseId("tvcm-2026", existing), "tvcm-2026");
});

test("ensureUniqueCaseId: 1件衝突していれば-2サフィックスを付ける", () => {
  const existing = new Set(["tvcm-2026"]);
  assert.equal(ensureUniqueCaseId("tvcm-2026", existing), "tvcm-2026-2");
});

test("ensureUniqueCaseId: 連番衝突している場合は空いている最小番号を付ける", () => {
  const existing = new Set(["tvcm-2026", "tvcm-2026-2", "tvcm-2026-3"]);
  assert.equal(ensureUniqueCaseId("tvcm-2026", existing), "tvcm-2026-4");
});

test("ensureUniqueCaseId: ちょうど60字のbaseIdが衝突していれば60字以内に収めて一意化する", () => {
  const baseId = "a".repeat(60);
  const existing = new Set([baseId]);
  const result = ensureUniqueCaseId(baseId, existing);
  assert.ok(result.length <= 60, `expected length<=60, got ${result.length}`);
  assert.notEqual(result, baseId);
  assert.ok(!existing.has(result));
});

test("ensureUniqueCaseId: 60字境界で切り詰めた候補も衝突する場合はさらに連番を進める", () => {
  const baseId = "a".repeat(60);
  const truncatedWithSuffix2 = `${baseId.slice(0, 58)}-2`; // 60字
  const existing = new Set([baseId, truncatedWithSuffix2]);
  const result = ensureUniqueCaseId(baseId, existing);
  assert.ok(result.length <= 60, `expected length<=60, got ${result.length}`);
  assert.ok(!existing.has(result));
  assert.notEqual(result, truncatedWithSuffix2);
});

// ── validateTechCandidateAllowingFallbackSource ──────────────────
// 実際に起きた失敗: Xポスト（ソフトロボット研究紹介動画）を送ったが、case-adder Agentが
// Web検索しても一次ソース（github/project/product）を見つけられず、
// techPure.validateAndDedupeTechCandidatesの「一次ソースが無ければ却下」で失敗していた。
// add-case（LINE単発URL）に限り、一次ソースが見つからない場合は失敗にせず、送信されたURLを
// kind:"post"のリンクとして採用してエントリを成立させる（techPure.ts/techResearch.tsは無改変）。

const TECH_VOCAB: TechVocab = {
  Domain: ["Spatial/3D", "GenVideo", "CreatorTools"],
  Type: ["Research", "Prototype", "Tool"],
};

function baseRawTechCandidate(overrides: Record<string, unknown> = {}) {
  return {
    techName: "Soft Robot Demo",
    org: "Some Lab",
    type: "Research",
    domains: ["Spatial/3D"],
    date: "2026-07",
    links: [],
    license: { spdx: null, commercial: "none" },
    summaryJa: "概要です。",
    pointJa: "ポイントです。",
    detailJa: "",
    relatedWorks: [],
    thumbnailSource: "",
    verdict: "adopt",
    ...overrides,
  };
}

test("validateTechCandidateAllowingFallbackSource: 一次ソースが無ければ却下せず、fallbackUrlをpostリンクとして採用する", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate(),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/clankrmedia/status/2076593164744376707",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.primarySourceFound, false);
    assert.deepEqual(result.value.links, [
      { kind: "post", url: "https://x.com/clankrmedia/status/2076593164744376707" },
    ]);
    assert.equal(result.value.title, "Soft Robot Demo");
    assert.equal(result.value.id, "soft-robot-demo");
  }
});

test("validateTechCandidateAllowingFallbackSource: 一次ソースが見つかっていれば採用し、fallbackリンクは追加しない", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ links: [{ kind: "github", url: "https://github.com/acme/soft-robot" }] }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/clankrmedia/status/2076593164744376707",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.primarySourceFound, true);
    assert.deepEqual(result.value.links, [{ kind: "github", url: "https://github.com/acme/soft-robot" }]);
  }
});

test("validateTechCandidateAllowingFallbackSource: fallbackUrlが既にlinksに含まれていれば重複追加しない", () => {
  const url = "https://x.com/clankrmedia/status/2076593164744376707";
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ links: [{ kind: "post", url }] }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    url,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.links.length, 1);
  }
});

test("validateTechCandidateAllowingFallbackSource: verdictがadopt以外は却下（縮退の対象外）", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ verdict: "reject" }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
});

test("validateTechCandidateAllowingFallbackSource: 既存tech.jsonとタイトル重複は一次ソース欠如でも却下される", () => {
  const existingTech = buildExistingTechIndex([{ id: "other-id", title: "Soft Robot Demo" }]);
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate(),
    TECH_VOCAB,
    existingTech,
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /タイトルが重複/);
});

test("validateTechCandidateAllowingFallbackSource: Case Studyとタイトル重複は却下される", () => {
  const existingCaseTitleKeys = new Set(["softrobotdemo"]);
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate(),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    existingCaseTitleKeys,
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /Case Study/);
});

test("validateTechCandidateAllowingFallbackSource: 不正typeは一次ソース欠如でも却下される", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ type: "Nonsense" }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /type/);
});

test("validateTechCandidateAllowingFallbackSource: domainsが全て語彙外なら却下される", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ domains: ["Nonexistent"] }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /domain/i);
});

test("validateTechCandidateAllowingFallbackSource: 不正なdate形式は却下される", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ date: "2026" }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /date/i);
});

test("validateTechCandidateAllowingFallbackSource: org/summary/pointのいずれかが空なら却下される", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ summaryJa: "" }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
});

test("validateTechCandidateAllowingFallbackSource: プロキシURL混入は一次ソース欠如の判定より先に却下される", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ links: [{ kind: "github", url: "https://r.jina.ai/https://github.com/a/b" }] }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /プロキシ/);
});

test("validateTechCandidateAllowingFallbackSource: thumbnailSource未指定時、一次ソースが無ければfallbackUrlをthumbnailSourceにも使う", () => {
  const url = "https://x.com/clankrmedia/status/2076593164744376707";
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ thumbnailSource: "" }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    url,
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.thumbnailSource, url);
});

test("validateTechCandidateAllowingFallbackSource: licenseが無ければcommercial=noneでデフォルト補完される", () => {
  const result = validateTechCandidateAllowingFallbackSource(
    baseRawTechCandidate({ license: undefined }),
    TECH_VOCAB,
    buildExistingTechIndex([]),
    new Set(),
    "https://x.com/a/status/1",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.license.commercial, "none");
    assert.equal(result.value.license.spdx, null);
  }
});
