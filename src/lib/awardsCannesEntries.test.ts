// 手順①: Case.awardEntries（構造化受賞）による Cannes コレクション生成のテスト。
// (1) 変更前の実データ(__fixtures__/cannes-cases-snapshot.json = 2026-11 時点の cases.json から
//     Cannes を含む事例の id/award/year を抜粋)から作ったコレクションの slug とその件数が、
//     変更前のコード出力(cannes-collections-expected.json)と完全一致すること。
// (2) awardEntries を持つ合成 Case は、award が自由記述でも awardEntries 通りになること。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cases as realCases, type Case } from "./cases";
import {
  getAwardCollectionsFrom,
  getAwardCollections,
  getAwardLevelForCollection,
  compareByAwardForCollection,
  getCaseAwardRefs,
} from "./awards";

const dir = path.join(__dirname, "__fixtures__");
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, "cannes-cases-snapshot.json"), "utf8")) as Array<{ id: string; award: string; year: string }>;
const expected = JSON.parse(fs.readFileSync(path.join(dir, "cannes-collections-expected.json"), "utf8")) as Record<string, number>;

const mk = (o: Partial<Case> & { id: string; award: string; year: string }): Case =>
  ({ title: o.id, summary: "", client: "", agency: "", categories: [], regions: [], link: "", thumbnail: "", overview: "", background: "", execution: "", evaluationImpact: "", relatedWorks: [], ...o }) as Case;

test("既存の Cannes コレクション: slug 一覧と件数が変更前と完全一致", () => {
  const cols = getAwardCollectionsFrom(snapshot.map(mk), "cannes");
  const actual = Object.fromEntries(cols.map((c) => [`${c.slug}|${c.category}`, c.cases.length]));
  assert.deepEqual(actual, expected);
  assert.deepEqual(cols.map((c) => `${c.slug}|${c.category}`), Object.keys(expected));
});

// 前提: 「実データは増えるだけ」ではなく「awardEntries で Cannes 受賞を持つ事例が1件もない年については、
// fixture の slug を包含する」。awardEntries を適用した年（例: 2025）は、自由記述の award 由来の崩れた
// コレクション（"2025-|）" 等）が意図どおり消えるため、fixture（変更前の出力）との包含は求めない。
// slug の先頭 4 桁を年として判定する。
test("getAwardCollections('cannes') は awardEntries 未適用の年については fixture と同じ slug 集合を含む", () => {
  const appliedYears = new Set<string>();
  for (const c of realCases) {
    for (const e of c.awardEntries ?? []) if (e.org === "cannes") appliedYears.add(String(e.year));
  }
  const slugs = new Set(getAwardCollections("cannes").map((c) => `${c.slug}|${c.category}`));
  for (const k of Object.keys(expected)) {
    const year = k.slice(0, 4);
    if (appliedYears.has(year)) continue;
    assert.ok(slugs.has(k), `${k} が消えている`);
  }
});

test("awardEntries: 自由記述の award でも awardEntries 通りのコレクションとレベル", () => {
  const c = mk({
    id: "syn1",
    year: "2023",
    award: "カンヌ ライオンズ 2023 屋外部門 Finalist（詳細情報は確認中）",
    awardEntries: [
      { org: "cannes", year: 2023, category: "Outdoor", level: "Grand Prix" },
      { org: "cannes", year: 2023, category: "Entertainment Lions for Music", level: "Gold" },
    ],
  });
  const cols = getAwardCollectionsFrom([c], "cannes");
  assert.deepEqual(cols.map((x) => x.slug).sort(), ["2023-entertainment-lions-for-music", "2023-outdoor"]);
  assert.equal(getAwardLevelForCollection(c.award, "cannes", c.year, "2023", "Outdoor", c.awardEntries)?.label, "GRAND PRIX");
  assert.equal(getAwardLevelForCollection(c.award, "cannes", c.year, "2023", "Entertainment Lions for Music", c.awardEntries)?.label, "GOLD");
  assert.equal(getAwardLevelForCollection(c.award, "cannes", c.year, "2023", "Film", c.awardEntries), null);
});

test("awardEntries がある事例は award 文字列の Cannes 部分を解析しない（他 org は従来どおり）", () => {
  const c = mk({
    id: "syn2",
    year: "2024",
    award: "Cannes Lions 2024 Film Lions Gold / D&AD 2024 Design Yellow Pencil",
    awardEntries: [{ org: "cannes", year: 2024, category: "Design", level: "Silver" }],
  });
  const cannes = getAwardCollectionsFrom([c], "cannes");
  assert.deepEqual(cannes.map((x) => x.slug), ["2024-design"]);
  const dad = getAwardCollectionsFrom([c], "dad");
  assert.equal(dad.length, 1);
});

test("award に Cannes の記載が無くても awardEntries で Cannes コレクションに入る", () => {
  const c = mk({ id: "syn3", year: "2022", award: "", awardEntries: [{ org: "cannes", year: 2022, category: "Film Craft", level: "Bronze" }] });
  assert.deepEqual(getAwardCollectionsFrom([c], "cannes").map((x) => x.slug), ["2022-film-craft"]);
});

test("awardEntries の同一部門は正規化で畳まれ、既存事例と同じコレクションに合流する", () => {
  const legacy = mk({ id: "old", year: "2026", award: "Cannes Lions 2026 Film Lions Gold" });
  const entry = mk({ id: "new", year: "2026", award: "x", awardEntries: [{ org: "cannes", year: 2026, category: "Film", level: "Silver" }, { org: "cannes", year: 2026, category: "Film Lions", level: "Bronze" }] });
  const cols = getAwardCollectionsFrom([legacy, entry], "cannes");
  assert.equal(cols.length, 1);
  assert.equal(cols[0].slug, "2026-film");
  assert.equal(cols[0].cases.length, 2);
  // 同一事例の重複エントリは1件として数え、最上位レベルを採る
  assert.equal(getAwardLevelForCollection(entry.award, "cannes", entry.year, "2026", "Film", entry.awardEntries)?.label, "SILVER");
});

test("compareByAwardForCollection は awardEntries のレベルで並ぶ", () => {
  const a = mk({ id: "a", year: "2023", award: "free text", awardEntries: [{ org: "cannes", year: 2023, category: "Outdoor", level: "Bronze" }] });
  const b = mk({ id: "b", year: "2023", award: "free text", awardEntries: [{ org: "cannes", year: 2023, category: "Outdoor", level: "Gold" }] });
  assert.ok(compareByAwardForCollection(a, b, "cannes", "2023", "Outdoor") > 0);
});

test("getCaseAwardRefs: awardEntries 持ちでも org 名の無い他 org セグメントを落とさない", () => {
  const c = mk({
    id: "refs1",
    year: "2024",
    award: "Cannes Lions 2024 Film Lions Gold / D&AD 2024 Design Yellow Pencil / FWA / Clio Gold / 文化庁メディア芸術祭",
    awardEntries: [{ org: "cannes", year: 2024, category: "Design", level: "Gold" }],
  });
  const refs = getCaseAwardRefs(c);
  assert.deepEqual(refs, [
    "Cannes Lions 2024 Design Lions Gold",
    "D&AD 2024 Design Yellow Pencil",
    "FWA",
    "Clio Gold",
    "文化庁メディア芸術祭",
  ]);
});

test("Grand Prix for Good の awardEntries は旧 'for Good' コレクションに合流し slug を保つ", () => {
  const legacy = mk({ id: "g-old", year: "2021", award: "Cannes Lions 2021 Grand Prix for Good" });
  const legacyHealth = mk({ id: "h-old", year: "2026", award: "Cannes Lions 2026 Health Grand Prix for Good" });
  const e1 = mk({ id: "g-new", year: "2021", award: "x", awardEntries: [{ org: "cannes", year: 2021, category: "Grand Prix for Good", level: "Grand Prix" }] });
  const e2 = mk({ id: "h-new", year: "2026", award: "x", awardEntries: [{ org: "cannes", year: 2026, category: "Lions Health Grand Prix for Good", level: "Grand Prix" }] });
  const e3 = mk({ id: "g26", year: "2026", award: "x", awardEntries: [{ org: "cannes", year: 2026, category: "Grand Prix for Good", level: "Grand Prix" }] });
  const cols = getAwardCollectionsFrom([legacy, legacyHealth, e1, e2, e3], "cannes");
  const bySlug = Object.fromEntries(cols.map((x) => [x.slug, x.cases.map((k) => k.id).sort()]));
  assert.ok(bySlug["2021-for-good"]?.includes("g-old") && bySlug["2021-for-good"]?.includes("g-new"));
  assert.ok(bySlug["2026-health-for-good"]?.includes("h-new"));
  assert.ok(bySlug["2026-health-for-good"]?.includes("h-old"));
  assert.ok(!bySlug["2026-health-for-good"]?.includes("g26"), "Grand Prix for Good と Health は別コレクション");
  assert.equal(cols.length, 3);
});

test("上書きは年単位: awardEntries に無い年の award 文字列記載は従来どおり解析する", () => {
  const c = mk({
    id: "yr1",
    year: "2026",
    award: "Cannes Lions 2026 Outdoor Lions Gold",
    awardEntries: [{ org: "cannes", year: 2025, category: "Outdoor", level: "Gold" }],
  });
  const cols = getAwardCollectionsFrom([c], "cannes");
  assert.deepEqual(cols.map((x) => x.slug).sort(), ["2025-outdoor", "2026-outdoor"]);
  assert.equal(getAwardLevelForCollection(c.award, "cannes", c.year, "2026", "Outdoor", c.awardEntries)?.label, "GOLD");
  assert.equal(getAwardLevelForCollection(c.award, "cannes", c.year, "2025", "Outdoor", c.awardEntries)?.label, "GOLD");
  assert.ok(getCaseAwardRefs(c).some((r) => r.includes("2026")));
});

test("同年の award 文字列記載は awardEntries が優先される（年単位でも維持）", () => {
  const c = mk({
    id: "yr2",
    year: "2025",
    award: "Cannes Lions 2025 Film Lions Gold",
    awardEntries: [{ org: "cannes", year: 2025, category: "Outdoor", level: "Silver" }],
  });
  assert.deepEqual(getAwardCollectionsFrom([c], "cannes").map((x) => x.slug), ["2025-outdoor"]);
  assert.equal(getAwardLevelForCollection(c.award, "cannes", c.year, "2025", "Film", c.awardEntries), null);
  assert.deepEqual(getCaseAwardRefs(c), ["Cannes Lions 2025 Outdoor Lions Silver"]);
});

test("getCaseAwardRefs: org 名なし Cannes セグメントも上書きされた年なら落とす（collections と対称）", () => {
  const c = mk({
    id: "refs2",
    year: "2025",
    award: "Cannes Lions 2025 Film Gold / Design Lions Silver 2025",
    awardEntries: [{ org: "cannes", year: 2025, category: "Film", level: "Gold" }],
  });
  assert.deepEqual(getCaseAwardRefs(c), ["Cannes Lions 2025 Film Lions Gold"]);
});
