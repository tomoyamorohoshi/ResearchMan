import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseAdderPrompt } from "./addCasePrompts.js";

test("buildCaseAdderPrompt: URLと出力形式(JSON)を含む", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(p, /https:\/\/example\.com\/article/);
  assert.match(p, /JSON/);
  assert.match(p, /"found"/);
});

test("buildCaseAdderPrompt: contextがあれば本文に含まれる", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "音楽視点で見て", isXLink: false });
  assert.match(p, /音楽視点で見て/);
});

test("buildCaseAdderPrompt: isXLinkがtrueならX/Twitter向けの補足指示が入る", () => {
  const withX = buildCaseAdderPrompt({ url: "https://x.com/user/status/1", context: "", isXLink: true });
  const withoutX = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(withX, /X\(旧Twitter\)/);
  assert.doesNotMatch(withoutX, /X\(旧Twitter\)/);
});

test("buildCaseAdderPrompt: found:falseの出力形式も指示する", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(p, /"found": false/);
  assert.match(p, /"reason"/);
});

// ── contentKind（要件1: case/tech/neitherの自動振り分け） ─────────────────

test("buildCaseAdderPrompt: contentKindのcase/tech/neither 3種を指示する", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(p, /"contentKind": "case"/);
  assert.match(p, /"contentKind": "tech"/);
  assert.match(p, /"contentKind": "neither"/);
});

test("buildCaseAdderPrompt: tech出力形式はTechEntry互換のフィールド（techName/org/type/domains/date/links/license）を含む", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(p, /"techName"/);
  assert.match(p, /"org"/);
  assert.match(p, /"domains"/);
  assert.match(p, /"date"/);
  assert.match(p, /"links"/);
  assert.match(p, /"license"/);
  assert.match(p, /"thumbnailSource"/);
});

test("buildCaseAdderPrompt: tech domain語彙7種を列挙する", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  for (const domain of ["Spatial/3D", "Motion/Body", "GenVideo", "CreatorTools", "AI/Agents", "HCI/MediaArt", "Audio/Music"]) {
    assert.ok(p.includes(domain), `expected prompt to include domain: ${domain}`);
  }
});

test("buildCaseAdderPrompt: isXLinkの補足指示にGitHubの言及がある（tech一次ソース補完方針）", () => {
  const withX = buildCaseAdderPrompt({ url: "https://x.com/user/status/1", context: "", isXLink: true });
  assert.match(withX, /GitHub/);
});
