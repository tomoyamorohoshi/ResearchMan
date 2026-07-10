import assert from "node:assert/strict";
import test from "node:test";
import { buildTechCollectorPrompt } from "./techPrompts.js";

test("buildTechCollectorPrompt: テーマ・目標件数を含む", () => {
  const p = buildTechCollectorPrompt({ theme: "MV・映像表現に使える最新テクノロジー", viewpoint: "", refUrl: "", targetCount: 3 });
  assert.match(p, /MV・映像表現に使える最新テクノロジー/);
  assert.match(p, /3件/);
  assert.match(p, /JSON/);
});

test("buildTechCollectorPrompt: 観点があれば本文に含まれる", () => {
  const p = buildTechCollectorPrompt({ theme: "AI映像", viewpoint: "リアルタイム性が新しい", refUrl: "", targetCount: 3 });
  assert.match(p, /リアルタイム性が新しい/);
});

test("buildTechCollectorPrompt: 参照URLがあれば本文に含まれる", () => {
  const p = buildTechCollectorPrompt({ theme: "AI映像", viewpoint: "", refUrl: "https://example.com/ref", targetCount: 3 });
  assert.match(p, /https:\/\/example\.com\/ref/);
});

test("buildTechCollectorPrompt: 出力スキーマにtechName/type/domains/verdictを含む", () => {
  const p = buildTechCollectorPrompt({ theme: "AI映像", viewpoint: "", refUrl: "", targetCount: 3 });
  assert.match(p, /techName/);
  assert.match(p, /verdict/);
  assert.match(p, /domains/);
  assert.match(p, /summaryJa/);
  assert.match(p, /pointJa/);
});

test("buildTechCollectorPrompt: 除外済み一覧を渡せば本文に含まれる（重複再収集の抑止）", () => {
  const p = buildTechCollectorPrompt({
    theme: "AI映像",
    viewpoint: "",
    refUrl: "",
    targetCount: 3,
    excludeTitles: ["Wild3R", "SpatialClaw"],
  });
  assert.match(p, /Wild3R/);
  assert.match(p, /SpatialClaw/);
});
