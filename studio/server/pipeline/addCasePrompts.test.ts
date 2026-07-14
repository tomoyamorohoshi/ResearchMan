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
