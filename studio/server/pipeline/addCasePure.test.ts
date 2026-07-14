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
  buildWriterFieldsFromAgentOutput,
  ensureUniqueCaseId,
  extractJsonObject,
  findDuplicateCase,
  isUsableCandidate,
  isXLink,
  normalizeYear,
  parseExtractedCandidate,
  validateAddCaseRequest,
} from "./addCasePure.js";

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
