// scripts/lib/case-gate.mjs + auto-research-cc.mjs のプロンプト生成の単体テスト（node:test）。
// 実行: node --test scripts/lib/case-gate.test.mjs
//
// 関門のリトマステスト（docs/RADAR_V2_DESIGN.md 追補§B）は、LLMを実呼び出しせずに
//   (1) 判定プロンプトにリトマス例・基準文言・4類型が実際に入っていること
//   (2) 「モデルが基準どおり判定した出力」を正規化・分割するロジックが accept/reject を正しく運ぶこと
//   (3) 「モデルが崩れた出力（楽観・欠落・矛盾）」を安全側(reject)に倒すこと
// の3点で担保する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_CRITERIA_TEXT, GATE_LITMUS_TEXT } from "./case-gate-criteria.mjs";
import {
  TASTE_TYPES_TEXT,
  ANNOUNCEMENT_TYPES,
  discoveryGatePromptSection,
  articleGatePromptSection,
  normalizeDiscoveryGate,
  normalizeArticleGate,
  partitionByGate,
  gateRejectionDetail,
} from "./case-gate.mjs";
import { buildDiscoveryPrompt, buildArticlePrompt } from "../auto-research-cc.mjs";

const vocab = { Tech: ["Tech/AI"], Form: ["Form/Event"], Theme: ["Theme/Art"] };
const foci = [
  { label: "テーマA", sources: "legacy-a.com / legacy-b.com", diversity: "多様に。" },
  { label: "テーマB", sources: "legacy-c.com", diversity: "多様に。" },
];
const baseArgs = {
  lastRunDate: new Date("2026-09-27T00:00:00+09:00"),
  existingTitles: "（既存なし）",
  seenThisRun: [],
  round: 1,
  roundFoci: foci,
};

// ── リトマス候補（モデルが基準どおり判定した想定の出力） ──
const LITMUS = {
  auspicious: {
    title: "Auspicious Art 北京公共キネティックアート",
    year: "2026",
    gateVerdict: "accept",
    gateCriterion: "B",
    gateReason: "風という無償の素材で生き物のような動きを作る",
  },
  hinatazaka: { title: "日向坂46 18thシングルMV公開", year: "2026", gateVerdict: "reject", gateCriterion: "none", gateReason: "MV公開のみ" },
  kh4: { title: "Kingdom Hearts IV 発売決定", year: "2026", gateVerdict: "reject", gateCriterion: "none", gateReason: "発売告知のみ" },
  vket: { title: "VketReal 2026 開催", year: "2026", gateVerdict: "reject", gateCriterion: "none", gateReason: "開催告知のみ" },
  awwwards: { title: "awwwards掲載の建築事務所サイト", year: "2026", gateVerdict: "reject", gateCriterion: "none", gateReason: "きれいなサイトにとどまる" },
};

test("プロンプト: 発見・記事化の両方に 基準A/B/C・リトマス例・4類型が入る（文言は共有定数）", () => {
  const disc = buildDiscoveryPrompt(baseArgs);
  const art = buildArticlePrompt({ title: "T", client: "C", agency: "", year: "2026", link: "https://e.com", note: "" }, vocab);
  for (const [name, p] of [["discovery", disc], ["article", art]]) {
    assert.ok(p.includes(GATE_CRITERIA_TEXT), `${name}: GATE_CRITERIA_TEXT をそのまま含む（二重定義しない）`);
    assert.ok(p.includes(GATE_LITMUS_TEXT), `${name}: GATE_LITMUS_TEXT をそのまま含む`);
    for (const needle of ["Auspicious Art", "日向坂46", "Kingdom Hearts IV", "VketReal 2026", "awwwards"]) {
      assert.ok(p.includes(needle), `${name}: リトマス例「${needle}」を含む`);
    }
  }
  assert.ok(disc.includes(TASTE_TYPES_TEXT), "discovery: 4類型を含む");
  for (const t of ["読み替え", "生成的ブランドID", "素材", "AI"]) assert.ok(TASTE_TYPES_TEXT.includes(t), `4類型に「${t}」`);
});

test("発見プロンプト: ノルマ撤廃・固定ジャンルリスト削除・0件許容・関門出力指示", () => {
  const p = buildDiscoveryPrompt(baseArgs);
  assert.ok(!/5〜7件/.test(p), "「5〜7件」が残っていない");
  assert.ok(!/最低4件/.test(p), "国内最低4件が残っていない");
  assert.ok(!p.includes("VTuber・SNS発カルチャー"), "固定ジャンルリストが残っていない");
  assert.ok(!p.includes("## 利用者の関心"), "「利用者の関心」節が残っていない");
  assert.match(p, /0件の日があってよい/);
  assert.match(p, /空配列/);
  for (const f of ["gateVerdict", "gateCriterion", "gateReason", "sourceId"]) assert.ok(p.includes(f), `出力指示に${f}`);
});

test("記事化プロンプト: 2回目の関門（最終判定）の出力指示を含む", () => {
  const p = buildArticlePrompt({ title: "T", client: "C", agency: "", year: "2026", link: "https://e.com", note: "" }, vocab);
  for (const f of ["gateVerdict", "gateCriterion", "gateScore", "gateReason", "announcementType"]) assert.ok(p.includes(f), `出力指示に${f}`);
  for (const t of ANNOUNCEMENT_TYPES) assert.ok(p.includes(t), `告知種別「${t}」を提示`);
  assert.ok(articleGatePromptSection().includes(GATE_CRITERIA_TEXT));
  assert.ok(discoveryGatePromptSection().includes(GATE_CRITERIA_TEXT));
});

test("リトマス: Auspicious Art相当は accept、告知・MV・awwwards系は reject（基準どおりの出力を運べる）", () => {
  const a = normalizeDiscoveryGate(LITMUS.auspicious);
  assert.equal(a.gateVerdict, "accept");
  assert.equal(a.gateCriterion, "B");
  for (const k of ["hinatazaka", "kh4", "vket", "awwwards"]) {
    const g = normalizeDiscoveryGate(LITMUS[k]);
    assert.equal(g.gateVerdict, "reject", k);
    assert.equal(g.gateCriterion, "none", k);
  }
});

test("partitionByGate: リトマス5件が accept1・reject4 に分かれ、reject には却下ログ用detailが付く", () => {
  const { accepted, rejected } = partitionByGate(Object.values(LITMUS));
  assert.deepEqual(accepted.map((c) => c.title), [LITMUS.auspicious.title]);
  assert.equal(accepted[0].gateCriterion, "B");
  assert.equal(rejected.length, 4);
  for (const r of rejected) {
    assert.match(r.detail, /^none:/);
    assert.ok(r.cand.title);
  }
  assert.equal(rejected.find((r) => r.cand.title.includes("VketReal")).detail, "none:開催告知のみ");
});

test("安全側フォールバック（発見）: 欠落・不正値・criterion無しacceptは reject", () => {
  const cases = [
    { title: "a" }, // 判定フィールド無し
    { title: "b", gateVerdict: "maybe", gateCriterion: "A" },
    { title: "c", gateVerdict: "accept" }, // criterion無し
    { title: "d", gateVerdict: "accept", gateCriterion: "none" },
    { title: "e", gateVerdict: "accept", gateCriterion: "Z" },
    { title: "f", gateVerdict: null, gateCriterion: null, gateReason: 3 },
  ];
  for (const c of cases) assert.equal(normalizeDiscoveryGate(c).gateVerdict, "reject", c.title);
  assert.equal(normalizeDiscoveryGate(undefined).gateVerdict, "reject");
  // 大文字小文字・空白ゆれは許容
  const ok = normalizeDiscoveryGate({ gateVerdict: " Accept ", gateCriterion: "c ", gateReason: " r " });
  assert.deepEqual(ok, { gateVerdict: "accept", gateCriterion: "C", gateReason: "r", invalidOutput: false });
});

test("記事化の関門: accept は criterion・score(1〜5)・告知でないことが揃った時のみ", () => {
  const good = { gateVerdict: "accept", gateCriterion: "A", gateScore: 4, gateReason: "読み替え一手", announcementType: "" };
  assert.deepEqual(normalizeArticleGate(good), { gateVerdict: "accept", gateCriterion: "A", gateScore: 4, gateReason: "読み替え一手", announcementType: "", invalidOutput: false });
  // 数値文字列は許容
  assert.equal(normalizeArticleGate({ ...good, gateScore: "3" }).gateScore, 3);
  // score 範囲外・欠落は reject
  // scoreは採否に使わない: 範囲外・非整数・不正でも accept のまま（丸め/クランプ、解釈不能は0）
  for (const [raw, want] of [[4.5, 5], ["4/5", 4], ["4点", 4], [0, 1], [6, 5], [2.4, 2], ["x", 0], [undefined, 0], [null, 0]]) {
    const g = normalizeArticleGate({ ...good, gateScore: raw });
    assert.equal(g.gateVerdict, "accept", `score=${raw}`);
    assert.equal(g.gateScore, want, `score=${raw}`);
  }
  // acceptと告知種別の矛盾（告知のみと言いつつaccept）は reject
  for (const t of ["発売", "開催", "発表", "買収", "コンテスト", "other"]) {
    const g = normalizeArticleGate({ ...good, announcementType: t });
    assert.equal(g.gateVerdict, "reject", t);
    assert.equal(g.announcementType, t);
  }
  // 不正な告知種別は other 扱い（reject側）
  assert.equal(normalizeArticleGate({ ...good, announcementType: "謎" }).gateVerdict, "reject");
  // "none" は告知なし
  assert.equal(normalizeArticleGate({ ...good, announcementType: "none" }).gateVerdict, "accept");
  // reject の criterion は none に揃う
  const rej = normalizeArticleGate({ gateVerdict: "reject", gateCriterion: "A", gateScore: 1, gateReason: "告知のみ", announcementType: "発売" });
  assert.equal(rej.gateVerdict, "reject");
  assert.equal(rej.gateCriterion, "none");
  assert.equal(normalizeArticleGate(undefined).gateVerdict, "reject");
});

test("リトマス（記事化）: 告知型の出力は reject、Auspicious相当は accept", () => {
  const aus = normalizeArticleGate({ gateVerdict: "accept", gateCriterion: "B", gateScore: 5, gateReason: "風で生き物のような動き", announcementType: "" });
  assert.equal(aus.gateVerdict, "accept");
  const kh = normalizeArticleGate({ gateVerdict: "reject", gateCriterion: "none", gateScore: 1, gateReason: "発売告知のみ", announcementType: "発売" });
  assert.equal(kh.gateVerdict, "reject");
  assert.match(gateRejectionDetail(kh, "article"), /^article:発売:発売告知のみ$/);
});

test("sourceIdFor: モデルの自己申告(実在id)を優先、無ければURLから推定、不明は空文字", async () => {
  const { sourceIdFor } = await import("../auto-research-cc.mjs");
  const reg = [
    { id: "itsnicethat", kind: "web", locator: "https://www.itsnicethat.com/latest" },
    { id: "bpando", kind: "web", locator: "https://bpando.org/" },
  ];
  assert.equal(sourceIdFor({ sourceId: "bpando", link: "https://www.itsnicethat.com/a" }, reg), "bpando");
  assert.equal(sourceIdFor({ sourceId: "bogus", link: "https://www.itsnicethat.com/a" }, reg), "itsnicethat");
  assert.equal(sourceIdFor({ link: "https://brand.example/x" }, reg), "");
  assert.equal(sourceIdFor({}, []), "");
});

test("複数記号のcriterion（A+B / A, B / A/B / A、B）は最初の記号で accept（発見・記事化とも）", () => {
  for (const c of ["A+B", "A, B", "A/B", "A、B", "B and C", "A&B", " b, c "]) {
    const d = normalizeDiscoveryGate({ gateVerdict: "accept", gateCriterion: c, gateReason: "r" });
    assert.equal(d.gateVerdict, "accept", c);
    assert.equal(d.gateCriterion, c.trim().toUpperCase().match(/[ABC]/)[0], c);
    assert.equal(d.invalidOutput, false, c);
    const a = normalizeArticleGate({ gateVerdict: "accept", gateCriterion: c, gateScore: 4, announcementType: "" });
    assert.equal(a.gateVerdict, "accept", c);
  }
  assert.equal(normalizeDiscoveryGate({ gateVerdict: "accept", gateCriterion: "none" }).gateVerdict, "reject");
  assert.ok(discoveryGatePromptSection().includes("最も強い1記号"));
  assert.ok(articleGatePromptSection().includes("最も強い1記号"));
});

test("announcementTypeのnull風トークンは空扱い（acceptを潰さない）", () => {
  for (const t of ["なし", "無し", "該当なし", "null", "NULL", "N/A", "n/a", "-", "—", "none", "None", "undefined", "  "]) {
    const g = normalizeArticleGate({ gateVerdict: "accept", gateCriterion: "B", gateScore: 4, announcementType: t });
    assert.equal(g.gateVerdict, "accept", `「${t}」`);
    assert.equal(g.announcementType, "", `「${t}」`);
  }
  assert.equal(normalizeArticleGate({ gateVerdict: "accept", gateCriterion: "B", gateScore: 4, announcementType: "謎" }).gateVerdict, "reject");
});

test("観測性: 正規化による強制rejectは invalid-output: を付ける（モデル自身のrejectには付けない）", () => {
  const forced = normalizeDiscoveryGate({ gateVerdict: "accept", gateCriterion: "none", gateReason: "r" });
  assert.equal(forced.invalidOutput, true);
  assert.match(gateRejectionDetail(forced, "discovery"), /^invalid-output:none:/);
  const missing = normalizeDiscoveryGate({ title: "x" });
  assert.equal(missing.invalidOutput, true);
  const legit = normalizeDiscoveryGate(LITMUS.kh4);
  assert.equal(legit.invalidOutput, false);
  assert.equal(gateRejectionDetail(legit, "discovery"), "none:発売告知のみ");
  const conflict = normalizeArticleGate({ gateVerdict: "accept", gateCriterion: "A", gateScore: 4, gateReason: "r", announcementType: "発売" });
  assert.equal(conflict.invalidOutput, true);
  assert.match(gateRejectionDetail(conflict, "article"), /^invalid-output:article:発売:/);
  const legitArt = normalizeArticleGate({ gateVerdict: "reject", gateCriterion: "none", gateScore: 1, gateReason: "告知", announcementType: "発売" });
  assert.equal(legitArt.invalidOutput, false);
  assert.equal(gateRejectionDetail(legitArt, "article"), "article:発売:告知");
});
