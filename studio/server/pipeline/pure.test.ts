/**
 * pipeline/pure.ts の純粋関数テスト（node:test）。
 * ネットワーク・Agent SDK・gitを触らないロジックだけを対象にする
 * （実収集/検証/commitはE2Eテストで検証。既存 jobs.test.ts と同じ方針）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAngles,
  buildCaseEntry,
  buildCommitMessage,
  buildExistingCaseIndex,
  dedupeCandidates,
  extractJsonArray,
  filterTagsByVocabulary,
  normalizeTitleKey,
  toCaseId,
  upsertOrderTagLine,
  validateResearchRequest,
} from "./pure.js";

// ── validateResearchRequest ──────────────────────────────────────
test("validateResearchRequest: Case Study + テーマありは valid", () => {
  const r = validateResearchRequest({ kind: "Case Study", theme: "新聞広告", count: "3" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.theme, "新聞広告");
    assert.equal(r.value.count, 3);
  }
});

test("validateResearchRequest: Technology + テーマありは valid（P2実装済み）", () => {
  const r = validateResearchRequest({ kind: "Technology", theme: "AI", count: "3" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "Technology");
    assert.equal(r.value.theme, "AI");
    assert.equal(r.value.count, 3);
  }
});

test("validateResearchRequest: 両方 + テーマありは valid（P2実装済み）", () => {
  const r = validateResearchRequest({ kind: "両方", theme: "AI" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "両方");
});

test("validateResearchRequest: 不正なkindはエラー", () => {
  const r = validateResearchRequest({ kind: "Nonsense", theme: "AI" });
  assert.equal(r.ok, false);
});

test("validateResearchRequest: kind未指定はエラー", () => {
  const r = validateResearchRequest({ theme: "AI" });
  assert.equal(r.ok, false);
});

test("validateResearchRequest: テーマ空白のみはエラー", () => {
  const r = validateResearchRequest({ kind: "Case Study", theme: "   " });
  assert.equal(r.ok, false);
});

test("validateResearchRequest: countは1〜10にクランプされる", () => {
  const r = validateResearchRequest({ kind: "Case Study", theme: "x", count: "999" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.count, 10);
});

// ── buildAngles ──────────────────────────────────────────────────
test("buildAngles: 観点なしは既定2角度", () => {
  const angles = buildAngles("新聞広告", "");
  assert.equal(angles.length, 2);
  assert.ok(angles.every((a) => a.includes("新聞広告")));
});

test("buildAngles: 観点ありは角度にも反映される", () => {
  const angles = buildAngles("新聞広告", "紙面の物理特性");
  assert.ok(angles.every((a) => a.includes("紙面の物理特性")));
});

// ── toCaseId / normalizeTitleKey ─────────────────────────────────
test("toCaseId: 英語タイトルはスラッグ化+年で構成", () => {
  assert.equal(toCaseId("The Blank Edition", "2018", "An-Nahar"), "the-blank-edition-2018");
});

test("toCaseId: 日本語のみのタイトルはクライアント名でid化", () => {
  const id = toCaseId("団らんランタン", "2023", "味の素");
  assert.match(id, /-2023$/);
  assert.ok(id.length > 4);
});

test("normalizeTitleKey: 年・記号・空白を無視して比較できる", () => {
  assert.equal(normalizeTitleKey("The Blank Edition (2018)"), normalizeTitleKey("the blank edition"));
});

// ── dedupeCandidates ──────────────────────────────────────────────
test("dedupeCandidates: 既存タイトルと重複する候補は除外される", () => {
  const existing = buildExistingCaseIndex([
    { id: "existing-case-2020", title: "Existing Case", link: "https://example.com/existing" },
  ]);
  const kept = dedupeCandidates(
    [
      { title: "Existing Case", year: "2020", link: "https://example.com/dup" },
      { title: "Brand New Case", year: "2026", link: "https://example.com/new" },
    ],
    existing,
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, "Brand New Case");
});

test("dedupeCandidates: 同一リンクの候補も除外される", () => {
  const existing = buildExistingCaseIndex([
    { id: "a-2020", title: "A", link: "https://example.com/same" },
  ]);
  const kept = dedupeCandidates(
    [{ title: "Totally Different Title", year: "2026", link: "https://example.com/same" }],
    existing,
  );
  assert.equal(kept.length, 0);
});

test("dedupeCandidates: 収集内での重複（角度違いで同じ事例）も1件に絞る", () => {
  const existing = buildExistingCaseIndex([]);
  const kept = dedupeCandidates(
    [
      { title: "Same Case", year: "2026", link: "https://example.com/a" },
      { title: "Same Case", year: "2026", link: "https://example.com/b" },
    ],
    existing,
  );
  assert.equal(kept.length, 1);
});

test("dedupeCandidates: title/year/linkのいずれか欠落した候補は捨てる", () => {
  const existing = buildExistingCaseIndex([]);
  const kept = dedupeCandidates(
    [
      { title: "", year: "2026", link: "https://example.com/a" },
      { title: "No Year", year: "", link: "https://example.com/b" },
      { title: "No Link", year: "2026", link: "" },
    ],
    existing,
  );
  assert.equal(kept.length, 0);
});

// ── extractJsonArray ────────────────────────────────────────────
test("extractJsonArray: 前後に説明文があってもJSON配列を抽出できる", () => {
  const text = 'ここに候補があります:\n[{"title":"A"}]\n以上です。';
  const arr = extractJsonArray(text);
  assert.deepEqual(arr, [{ title: "A" }]);
});

test("extractJsonArray: JSONが無ければnull", () => {
  assert.equal(extractJsonArray("該当なしでした"), null);
});

test("extractJsonArray: 壊れたJSONはnull", () => {
  assert.equal(extractJsonArray("[{title: broken}]"), null);
});

// ── filterTagsByVocabulary ────────────────────────────────────────
test("filterTagsByVocabulary: 語彙外タグは除外・5個まで", () => {
  const vocab = { Tech: ["Tech/AI"], Form: ["Form/Film"], Theme: ["Theme/Music"] };
  const tags = filterTagsByVocabulary(
    ["Tech/AI", "Nonexistent/Tag", "Form/Film", "Theme/Music", "Tech/AI", "Form/Film"],
    vocab,
  );
  assert.ok(tags.every((t) => ["Tech/AI", "Form/Film", "Theme/Music"].includes(t)));
});

test("filterTagsByVocabulary: 配列でない入力は空配列", () => {
  const vocab = { Tech: [], Form: [], Theme: [] };
  assert.deepEqual(filterTagsByVocabulary(undefined, vocab), []);
});

// ── buildCaseEntry ──────────────────────────────────────────────
test("buildCaseEntry: スキーマの全フィールドを組み立てる", () => {
  const entry = buildCaseEntry({
    id: "brand-new-case-2026",
    title: "Brand New Case",
    client: "Acme",
    agency: "",
    year: 2026,
    link: "https://example.com/new",
    thumbnail: "/thumbnails/brand-new-case-2026.jpg",
    videoId: "",
    sourceTag: "Album Promo",
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
  assert.equal(entry.id, "brand-new-case-2026");
  assert.equal(entry.year, "2026");
  assert.deepEqual(entry.categories, ["コンテンツ革新"]);
  assert.deepEqual(entry.regions, ["グローバル"]);
  assert.deepEqual(entry.sources, ["Album Promo"]);
  assert.deepEqual(entry.tags, ["Tech/AI"]);
});

// ── buildCommitMessage ────────────────────────────────────────────
test("buildCommitMessage: テーマと件数を含む", () => {
  const msg = buildCommitMessage("新聞広告", 5);
  assert.match(msg, /新聞広告/);
  assert.match(msg, /5件/);
});

// ── upsertOrderTagLine ────────────────────────────────────────────
const SAMPLE_SOURCES_FILE = `export const RESEARCH_SOURCES: ResearchSource[] = [
  { tag: "Cannes 2026", kind: "award", label: "Cannes 2026" },
  { tag: "Music", kind: "order", label: "Music" },
  { tag: "Radar", kind: "radar", label: "Radar" },
];
`;

test("upsertOrderTagLine: 新タグはRadar行の直前に挿入される", () => {
  const { content, changed, tag } = upsertOrderTagLine(SAMPLE_SOURCES_FILE, "Album Promo", "Album Promo");
  assert.equal(changed, true);
  assert.equal(tag, "Album Promo");
  assert.match(content, /"Album Promo".*\n.*"Radar"/s);
  const radarIndex = content.indexOf('tag: "Radar"');
  const newIndex = content.indexOf('tag: "Album Promo"');
  assert.ok(newIndex < radarIndex);
});

test("upsertOrderTagLine: 既存orderタグと同名なら再利用（変更しない）", () => {
  const { content, changed, tag } = upsertOrderTagLine(SAMPLE_SOURCES_FILE, "Music", "Music (different label)");
  assert.equal(changed, false);
  assert.equal(tag, "Music");
  assert.equal(content, SAMPLE_SOURCES_FILE);
});

test("upsertOrderTagLine: Radar行が見つからないフォーマットは例外", () => {
  assert.throws(() => upsertOrderTagLine("export const X = [];\n", "Foo", "Foo"));
});

// ── upsertOrderTagLine: kind衝突回避（adversarial-reviewer指摘#3） ─────────
// haiku生成のタグ名が既存の radar/award タグと同名だと、名前一致だけで
// changed:false を返して「既存タグの再利用」扱いにしてしまい、新規caseのsourcesに
// 入れた際にRadar/Cannes扱いとして誤分類されてしまう。kind==="order"の同名のみ
// 再利用を許可し、他kindと衝突したら確実に別名の新規orderタグを作る。

test("upsertOrderTagLine: 既存radarタグと同名なら衝突回避して新規orderタグを作る", () => {
  const { content, changed, tag } = upsertOrderTagLine(SAMPLE_SOURCES_FILE, "Radar", "Radar");
  assert.equal(changed, true);
  assert.notEqual(tag, "Radar", "Radar(既存radarタグ)をそのまま再利用してはいけない");
  assert.match(content, new RegExp(`tag: "${escapeForRegex(tag)}", kind: "order"`));
  // 既存のRadar(radar)行はそのまま残っている（書き換えられていない）こと
  assert.match(content, /\{ tag: "Radar", kind: "radar", label: "Radar" \}/);
});

test("upsertOrderTagLine: 既存awardタグと同名なら衝突回避して新規orderタグを作る", () => {
  const { content, changed, tag } = upsertOrderTagLine(SAMPLE_SOURCES_FILE, "Cannes 2026", "Cannes 2026");
  assert.equal(changed, true);
  assert.notEqual(tag, "Cannes 2026");
  assert.match(content, new RegExp(`tag: "${escapeForRegex(tag)}", kind: "order"`));
  assert.match(content, /\{ tag: "Cannes 2026", kind: "award", label: "Cannes 2026" \}/);
});

test("upsertOrderTagLine: 衝突回避名も既に別kindで使われていたら更に回避する", () => {
  const fileWithBoth = SAMPLE_SOURCES_FILE.replace(
    '{ tag: "Radar", kind: "radar", label: "Radar" },',
    '{ tag: "Radar", kind: "radar", label: "Radar" },\n  { tag: "Radar (2)", kind: "radar", label: "Radar (2)" },',
  );
  const { changed, tag } = upsertOrderTagLine(fileWithBoth, "Radar", "Radar");
  assert.equal(changed, true);
  assert.notEqual(tag, "Radar");
  assert.notEqual(tag, "Radar (2)");
});

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
