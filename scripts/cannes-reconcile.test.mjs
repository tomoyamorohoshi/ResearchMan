import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseWinners, buildPlan, applyPlan, checkCounts } from "./cannes-reconcile.mjs";

const W = (category, level, title, brand = "Brand", extra = {}) => ({ category, level, title, brand, agency: "AG", country: "JP", sources: ["s1"], ...extra });
const C = (id, title, client = "", award = "") => ({ id, title, client, award });
const plan = (winners, cases, aliases) => buildPlan({ year: 2025, winners, cases, aliases, generatedAt: "t" });

test("畳み込み: 同部門・同レベルの重複行は1エントリ、別部門は別エントリ、sources は和集合", () => {
  const works = collapseWinners([
    W("Film", "Gold", "Big Idea", "Acme", { sources: ["a"] }),
    W("Film Lions", "Gold", "Big Idea!", "ACME", { sources: ["b"] }),
    W("Outdoor", "Silver", "Big Idea", "Acme"),
    W("Film", "Silver", "Other", "Acme"),
  ], 2025);
  assert.equal(works.length, 2);
  const w = works.find((x) => x.title.startsWith("Big"));
  assert.equal(w.entries.length, 2);
  assert.deepEqual(w.sources, ["a", "b", "s1"]);
});

test("matched / ambiguous / new の分類と件数", () => {
  const p = plan(
    [W("Film", "Gold", "Alpha"), W("Film", "Gold", "Beta", "Zeta Corp"), W("Film", "Gold", "Gamma")],
    [C("c1", "Alpha"), C("c2", "Beta Campaign", "Zeta Corp Japan"), C("c3", "Beta Story", "Zeta Corp")],
  );
  assert.deepEqual([p.counts.matched, p.counts.ambiguous, p.counts.new], [1, 1, 1]);
  assert.equal(p.matched[0].caseId, "c1");
  assert.deepEqual(p.ambiguous[0].candidateCaseIds.sort(), ["c2", "c3"]);
  assert.equal(p.new[0].award, "Cannes Lions 2025 Film Lions Gold");
});

test("alias が最優先（通常照合では一致しない作品も指定事例に付く）", () => {
  const p = plan([W("Film", "Gold", "Alpha")], [C("c1", "Alpha"), C("c9", "Unrelated")], { 2025: { alpha: "c9" } });
  assert.equal(p.matched[0].caseId, "c9");
  assert.equal(p.counts.ambiguous, 0);
});

test("unmatchedExisting: 当該年の Cannes 記載があるのに一致しなかった事例（他年は対象外）", () => {
  const p = plan(
    [W("Film", "Gold", "Alpha")],
    [C("c1", "Alpha", "", "Cannes Lions 2025 Film Lions Gold"), C("c2", "Lost", "", "Cannes Lions 2025 Design"), C("c3", "JP", "", "カンヌ 2025 屋外"), C("c4", "Old", "", "Cannes Lions 2024 Film")],
  );
  assert.deepEqual(p.unmatchedExisting.map((x) => x.caseId).sort(), ["c2", "c3"]);
});

test("件数不一致なら失敗", () => {
  assert.throws(() => checkCounts({ works: 3, matched: 1, ambiguous: 1, new: 0 }, 3), /件数不一致/);
  assert.doesNotThrow(() => checkCounts({ works: 3, matched: 1, ambiguous: 1, new: 1 }, 3));
});

test("適用: awardEntries は重複なし、award は当該年記載が無いときだけ末尾追記", () => {
  const cases = [
    C("c1", "Alpha", "", "Cannes Lions 2025 Film Lions Gold"),
    C("c2", "Beta", "", "D&AD 2025 Pencil"),
    C("c3", "Gamma", "", ""),
  ];
  cases[0].awardEntries = [{ org: "cannes", year: 2025, category: "Film", level: "Gold" }];
  const p = plan([W("Film Lions", "Gold", "Alpha"), W("Outdoor", "Silver", "Beta"), W("Film", "Gold", "Gamma")], cases);
  applyPlan(cases, p);
  applyPlan(cases, p); // 2回適用しても増えない
  assert.equal(cases[0].awardEntries.length, 1);
  assert.equal(cases[0].award, "Cannes Lions 2025 Film Lions Gold");
  assert.equal(cases[1].award, "D&AD 2025 Pencil / Cannes Lions 2025 Outdoor Lions Silver");
  assert.deepEqual(cases[1].awardEntries, [{ org: "cannes", year: 2025, category: "Outdoor", level: "Silver" }]);
  assert.equal(cases[2].award, "Cannes Lions 2025 Film Lions Gold");
});

// --- 照合規則の厳格化（2025 dry-run の誤一致を再現する fixture） ---
const CY = (id, year, title, client, award = "") => ({ id, year: String(year), title, client, award });

test("誤一致の抑止: brand 一致＋Jaccard 0.3〜0.5 は当該年の Cannes 記載が無ければ一致しない", () => {
  const p = plan(
    [W("Outdoor", "Gold", "Pub Succession", "Heineken"), W("Direct", "Gold", "Oreo Empire", "Oreo"), W("Audio & Radio", "Gold", "Boxed Ads", "Mercado Libre")],
    [
      CY("pub-museums-2024", 2024, "Pub Museums", "Heineken (Heineken Ireland)", "Cannes Lions 2024 Outdoor Lions Gold"),
      CY("oreo-cows", 2026, "Oreo Cows", "Oreo", "Cannes Lions 2026 Direct Lions Gold"),
      CY("doorbell", 2026, "Doorbell Ads", "Mercado Libre", "Cannes Lions 2026 Audio & Radio Lions Silver"),
    ],
  );
  assert.equal(p.counts.matched, 0);
  assert.equal(p.counts.new, 3);
});

test("brand 一致＋Jaccard 0.3〜0.5 でも当該年の Cannes 記載があれば一致、0.5 以上なら記載不問で一致", () => {
  const p = plan(
    [W("Outdoor", "Gold", "Pub Succession", "Heineken"), W("Film", "Gold", "Red Blue Green Sky", "Acme")],
    [
      CY("hk", 2025, "Pub Museums", "Heineken", "Cannes Lions 2025 Outdoor"),
      CY("ac", 2020, "Red Blue Green Moon", "Acme", ""), // jac 3/5=0.6
    ],
  );
  assert.deepEqual(p.matched.map((m) => m.caseId).sort(), ["ac", "hk"]);
});

test("title 完全一致は brand 一致か case.year が対象年±1 のときだけ一致", () => {
  const p = plan(
    [W("Design", "Gold", "Found In Translation", "Medalla Light"), W("Film", "Gold", "Same Name", "Other Brand")],
    [CY("old", 2021, "Found in Translation", "Google"), CY("near", 2026, "Same Name", "Unrelated")],
  );
  assert.deepEqual(p.matched.map((m) => m.caseId), ["near"]);
  assert.equal(p.counts.new, 1);
});

test("複数候補のとき完全一致がちょうど1件ならそれを採る。完全一致が複数なら ambiguous", () => {
  const p = plan(
    [W("Outdoor", "Gold", "Shot On Iphone", "Apple"), W("Film", "Gold", "Sounds Right", "Spotify")],
    [
      CY("shot", 2015, "SHOT ON iPHONE", "Apple"), CY("bigman", 2026, "Big Man, Shot on iPhone", "Apple", "Cannes Lions 2025 Film"),
      CY("sr1", 2025, "SOUNDS RIGHT", "Spotify"), CY("sr2", 2024, "Sounds Right", "Spotify"),
    ],
  );
  assert.deepEqual(p.matched.map((m) => m.caseId), ["shot"]);
  assert.equal(p.counts.ambiguous, 1);
  assert.deepEqual(p.ambiguous[0].candidateCaseIds.sort(), ["sr1", "sr2"]);
});

test("1事例に複数作品が当たる場合は許可し、casesWithMultipleWorks に列挙する", () => {
  const p = plan(
    [W("Film", "Gold", "Campaign", "Acme"), W("Film", "Silver", "Campaign Part Two", "Acme")],
    [CY("camp", 2025, "Campaign", "Acme")],
  );
  assert.equal(p.counts.casesWithMultipleWorks, 1);
  assert.equal(p.casesWithMultipleWorks[0].caseId, "camp");
  assert.equal(p.casesWithMultipleWorks[0].works.length, 2);
});
