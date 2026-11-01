import test from "node:test";
import assert from "node:assert/strict";
import { runCannesAudit, caseAwardForYear, cannesAwardHasCategory } from "./audit-cannes.mjs";

const quiet = (fn) => {
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  try { return { ...fn(), lines }; } finally { console.log = orig; }
};

const w = (category, level, title, brand = "Brand") => ({ category, level, title, brand });
const cs = (id, title, award, extra = {}) => ({ id, title, client: "Brand", award, ...extra });

test("reference year: missing winner is WARN only, exit 0", () => {
  const r = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "reference" },
    refs: { 2023: [w("Outdoor", "Gold", "Alpha Campaign")] }, caseRecords: [],
  }));
  assert.equal(r.exitCode, 0);
  assert.ok(r.lines.some((l) => /WARN/.test(l)));
  assert.ok(!r.lines.some((l) => /FAIL/.test(l)));
});

test("complete year: missing winner is FAIL, exit 1", () => {
  const r = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "complete" },
    refs: { 2023: [w("Outdoor", "Gold", "Alpha Campaign")] }, caseRecords: [],
  }));
  assert.equal(r.exitCode, 1);
  assert.ok(r.lines.some((l) => /FAIL/.test(l)));
});

test("complete year: matched case passes, level mismatch in complete year fails", () => {
  const ref = [w("Outdoor", "Gold", "Alpha Campaign")];
  const ok = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "complete" }, refs: { 2023: ref },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2023 Outdoor Lions Gold")],
  }));
  assert.equal(ok.exitCode, 0);
  const bad = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "complete" }, refs: { 2023: ref },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2023 Outdoor Lions Silver")],
  }));
  assert.equal(bad.exitCode, 1);
});

test("reference year level mismatch is WARN, exit 0", () => {
  const r = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "reference" },
    refs: { 2023: [w("Outdoor", "Gold", "Alpha Campaign")] },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2023 Outdoor Lions Silver")],
  }));
  assert.equal(r.exitCode, 0);
});

test("strict makes a reference year fail", () => {
  const r = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "reference" }, strict: true,
    refs: { 2023: [w("Outdoor", "Gold", "Alpha Campaign")] }, caseRecords: [],
  }));
  assert.equal(r.exitCode, 1);
});

test("awardEntries decide the year instead of the award string", () => {
  const ref = [w("Outdoor", "Gold", "Alpha Campaign")];
  // award 文字列は誤り（Film）だが awardEntries が正 → 通る
  const good = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "complete" }, refs: { 2023: ref },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2023 Film Lions Gold",
      { awardEntries: [{ org: "cannes", year: 2023, category: "Outdoor", level: "Gold" }] })],
  }));
  assert.equal(good.exitCode, 0);
  // award 文字列は正しいが awardEntries が別部門 → 未カバー
  const bad = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "complete" }, refs: { 2023: ref },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2023 Outdoor Lions Gold",
      { awardEntries: [{ org: "cannes", year: 2023, category: "Film", level: "Gold" }] })],
  }));
  assert.equal(bad.exitCode, 1);
  // 別年の awardEntries はその年の award 文字列判定を上書きしない
  const other = quiet(() => runCannesAudit({
    years: [2023], states: { 2023: "complete" }, refs: { 2023: ref },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2023 Outdoor Lions Gold",
      { awardEntries: [{ org: "cannes", year: 2024, category: "Film", level: "Gold" }] })],
  }));
  assert.equal(other.exitCode, 0);
});

test("caseAwardForYear: entries of that year only, else original award", () => {
  const c = cs("a", "A", "Cannes Lions 2023 Film Lions Gold", {
    awardEntries: [{ org: "cannes", year: 2023, category: "Outdoor", level: "Gold" }, { org: "cannes", year: 2024, category: "Film", level: "Silver" }],
  });
  assert.equal(caseAwardForYear(c, 2023), "Cannes Lions 2023 Outdoor Lions Gold");
  assert.equal(caseAwardForYear(c, 2022), c.award);
});

test("category matching normalizes spelling but never across years", () => {
  assert.ok(cannesAwardHasCategory("Cannes Lions 2023 Outdoor Lions Gold", "Outdoor"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2023 Film Lions Gold", "Film"));
  assert.ok(!cannesAwardHasCategory("Cannes Lions 2023 Film Craft Lions Gold", "Film"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2023 Entertainment Lions for Music Gold", "Entertainment for Music"));
  assert.ok(!cannesAwardHasCategory("Cannes Lions 2023 Entertainment Lions for Music Gold", "Entertainment"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2018 Grand Prix for Good", "Grand Prix for Good"));
  assert.ok(!cannesAwardHasCategory("Cannes Lions 2018 Grand Prix for Good", "Lions Health Grand Prix for Good"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2018 Lions Health Grand Prix for Good", "Lions Health Grand Prix for Good"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2023 Audio & Radio Lions Gold", "Audio & Radio"));
  assert.ok(!cannesAwardHasCategory("Cannes Lions 2019 Radio & Audio Lions Gold", "Audio & Radio"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2019 Radio & Audio Lions Gold", "Radio & Audio"));
  assert.ok(cannesAwardHasCategory("Cannes Lions 2019 Radio & Audio Lions Gold / Cannes Lions 2019 Film Lions Silver", "Film"));
});

test("Radio & Audio (2019) winner is not satisfied by an Audio & Radio case", () => {
  const r = quiet(() => runCannesAudit({
    years: [2019], states: { 2019: "complete" },
    refs: { 2019: [w("Radio & Audio", "Gold", "Alpha Campaign")] },
    caseRecords: [cs("alpha", "Alpha Campaign", "Cannes Lions 2019 Audio & Radio Lions Gold")],
  }));
  assert.equal(r.exitCode, 1);
});
