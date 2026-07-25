import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAwardVerifierPrompt,
  buildCaseWriterPrompt,
  buildCollectorPrompt,
  buildLinkCheckerPrompt,
  buildOrderTagPrompt,
} from "./prompts.js";

test("buildCollectorPrompt: テーマ・角度・目標件数を含む", () => {
  const p = buildCollectorPrompt({
    theme: "新聞広告",
    angle: "新聞広告 — 海外事例中心",
    refUrl: "",
    targetCount: 4,
  });
  assert.match(p, /新聞広告/);
  assert.match(p, /4件/);
  assert.match(p, /JSON/);
});

test("buildCollectorPrompt: 参照URLがあれば本文に含まれる", () => {
  const p = buildCollectorPrompt({
    theme: "新聞広告",
    angle: "新聞広告 — 海外事例中心",
    refUrl: "https://example.com/ref",
    targetCount: 4,
  });
  assert.match(p, /https:\/\/example\.com\/ref/);
});

test("buildLinkCheckerPrompt: 候補のid/urlを埋め込みJSON出力を要求する", () => {
  const p = buildLinkCheckerPrompt([
    { id: "a-2026", title: "A", link: "https://example.com/a" },
  ]);
  assert.match(p, /a-2026/);
  assert.match(p, /https:\/\/example\.com\/a/);
  assert.match(p, /JSON/);
});

// ── prefetchedText（bot対策サイト向け: 事前取得済み本文をlink-checkerへ渡す。
//    pageFetch.ts::fetchPageWithFallbackで取得できていれば注入、できていなければ従来どおり
//    Agent自身のWebFetch任せ） ──────────────────────────────────────

test("buildLinkCheckerPrompt: prefetchedText未指定の候補は従来どおり（本文注入なし）", () => {
  const p = buildLinkCheckerPrompt([{ id: "a-2026", title: "A", link: "https://example.com/a" }]);
  assert.doesNotMatch(p, /事前取得済み/);
});

test("buildLinkCheckerPrompt: prefetchedText指定時はその候補の本文をそのまま含める", () => {
  const p = buildLinkCheckerPrompt([
    {
      id: "a-2026",
      title: "A",
      link: "https://www.dezeen.com/2016/04/15/example/",
      prefetchedText: "Oi unveils a responsive sound-reactive logo by Wolff Olins",
    },
  ]);
  assert.match(p, /Oi unveils a responsive sound-reactive logo by Wolff Olins/);
  assert.match(p, /事前取得済み/);
});

test("buildLinkCheckerPrompt: 複数候補中1件だけprefetchedText指定でも他候補は従来どおり", () => {
  const p = buildLinkCheckerPrompt([
    { id: "a-2026", title: "A", link: "https://example.com/a", prefetchedText: "事前取得した本文A" },
    { id: "b-2026", title: "B", link: "https://example.com/b" },
  ]);
  assert.match(p, /事前取得した本文A/);
  assert.match(p, /b-2026/);
});

test("buildAwardVerifierPrompt: award付き候補のみ渡された前提でid/受賞主張を含む", () => {
  const p = buildAwardVerifierPrompt([
    { id: "a-2026", title: "A", client: "Acme", year: "2026", award: "Cannes Gold" },
  ]);
  assert.match(p, /a-2026/);
  assert.match(p, /Cannes Gold/);
});

test("buildCaseWriterPrompt: 検証済み候補とタグ語彙を含む", () => {
  const p = buildCaseWriterPrompt(
    [
      {
        id: "a-2026",
        title: "A",
        client: "Acme",
        agency: "",
        year: "2026",
        link: "https://example.com/a",
        award: "",
        summary: "note",
      },
    ],
    ["Tech/AI", "Form/Film"],
  );
  assert.match(p, /a-2026/);
  assert.match(p, /Tech\/AI/);
});

test("buildOrderTagPrompt: テーマを含み英語タグを要求する", () => {
  const p = buildOrderTagPrompt("アーティストの新アルバムプロモーション");
  assert.match(p, /アーティストの新アルバムプロモーション/);
});
