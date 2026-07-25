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

// ── 一次ソース欠如時の縮退（実際に起きた失敗: Xポストのソフトロボット研究紹介動画が
//    一次ソース(github/project/product)無しとして扱われ、techと判定されたのに
//    「事例の追加に失敗しました」で終わっていた） ──────────────────────────

test("buildCaseAdderPrompt: 一次ソースが見つからなくてもneitherにせずtechで返してよい旨を指示する", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(p, /一次ソースが見つからないことを理由に.*neither.*にしない/);
});

test("buildCaseAdderPrompt: 一次ソースが無い場合、確認できた投稿\/記事URLをkind:\"post\"として含める旨を指示する", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.match(p, /kind:"post"/);
});

// ── tweetMedia（要件1b: X投稿の機械取得済み本文・メディアをAgentに渡す） ──────────

test("buildCaseAdderPrompt: tweetMedia未指定なら既存のxNote（WebFetch/WebSearch指示）を変更しない", () => {
  const withX = buildCaseAdderPrompt({ url: "https://x.com/user/status/1", context: "", isXLink: true });
  assert.match(withX, /投稿本文の取得を試みてください/);
});

test("buildCaseAdderPrompt: tweetMedia指定時は機械取得済みの本文・投稿者・日時をそのまま含める", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/jamesoniam/status/2077432470375731467",
    context: "",
    isXLink: true,
    tweetMedia: {
      text: "Meet Chip, a robot car.",
      author: "Jameson Detweiler (@jamesoniam)",
      createdAt: "2026-07-15T16:37:52.000Z",
      mediaPaths: [],
    },
  });
  assert.match(p, /Meet Chip, a robot car\./);
  assert.match(p, /Jameson Detweiler \(@jamesoniam\)/);
  assert.match(p, /2026-07-15T16:37:52\.000Z/);
});

test("buildCaseAdderPrompt: tweetMedia指定時は本文を信頼してよい旨を指示し、WebFetchでの本文再取得指示は含めない", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/jamesoniam/status/2077432470375731467",
    context: "",
    isXLink: true,
    tweetMedia: { text: "本文", author: "author", createdAt: "2026-07-15T00:00:00.000Z", mediaPaths: [] },
  });
  assert.match(p, /信頼してよい/);
  assert.doesNotMatch(p, /投稿本文の取得を試みてください/);
});

test("buildCaseAdderPrompt: tweetMedia.mediaPathsがあれば各パスを列挙しReadツールで実際に見て具体的に記述する旨を指示する", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/minicoolkohe/status/2077028203567484930",
    context: "",
    isXLink: true,
    tweetMedia: {
      text: "本文",
      author: "author",
      createdAt: "2026-07-14T13:51:27.000Z",
      mediaPaths: ["/tmp/researchman-xmedia-job1/photo-0.jpg", "/tmp/researchman-xmedia-job1/video-thumb-0.jpg"],
    },
  });
  assert.match(p, /\/tmp\/researchman-xmedia-job1\/photo-0\.jpg/);
  assert.match(p, /\/tmp\/researchman-xmedia-job1\/video-thumb-0\.jpg/);
  assert.match(p, /Read/);
  assert.match(p, /具体的に記述/);
});

test("buildCaseAdderPrompt: tweetMedia.mediaPathsが空ならRead指示を含めない", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/user/status/1",
    context: "",
    isXLink: true,
    tweetMedia: { text: "本文", author: "author", createdAt: "2026-07-14T00:00:00.000Z", mediaPaths: [] },
  });
  assert.doesNotMatch(p, /Readツール/);
});

test("buildCaseAdderPrompt: tweetMedia指定時は確定情報（受賞・企業名等）のWeb検索裏取り必須の旨を指示する", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/user/status/1",
    context: "",
    isXLink: true,
    tweetMedia: { text: "本文", author: "author", createdAt: "2026-07-14T00:00:00.000Z", mediaPaths: ["/tmp/a.jpg"] },
  });
  assert.match(p, /確定情報/);
  assert.match(p, /Web検索/);
  assert.match(p, /裏取り/);
});

test("buildCaseAdderPrompt: tweetMedia指定時、特定不能ならneitherで具体的理由（画像・動画の解析でも特定できなかった旨）を書く指示を含む", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/user/status/1",
    context: "",
    isXLink: true,
    tweetMedia: { text: "本文", author: "author", createdAt: "2026-07-14T00:00:00.000Z", mediaPaths: ["/tmp/a.jpg"] },
  });
  assert.match(p, /画像.*動画の解析でも.*特定できなかった/);
  assert.match(p, /neither/);
});

// ── prefetchedPage（bot対策サイト向け: 事前取得済み本文をAgentへ渡す。tweetMediaと同じ
//    「取得できていれば注入、できていなければ従来どおりWebFetch任せ」パターン） ──────

test("buildCaseAdderPrompt: prefetchedPage未指定なら従来どおりWebFetchでURLの内容を判定する指示のまま（本文注入なし）", () => {
  const p = buildCaseAdderPrompt({ url: "https://example.com/article", context: "", isXLink: false });
  assert.doesNotMatch(p, /事前取得済み/);
});

test("buildCaseAdderPrompt: prefetchedPage指定時は事前取得済みの本文をそのまま含める", () => {
  const p = buildCaseAdderPrompt({
    url: "https://www.dezeen.com/2016/04/15/example/",
    context: "",
    isXLink: false,
    prefetchedPage: { text: "Oi unveils a responsive sound-reactive logo by Wolff Olins" },
  });
  assert.match(p, /Oi unveils a responsive sound-reactive logo by Wolff Olins/);
  assert.match(p, /事前取得済み/);
});

test("buildCaseAdderPrompt: prefetchedPage指定時も信頼してよい旨とWeb検索裏取りの必要性を指示する", () => {
  const p = buildCaseAdderPrompt({
    url: "https://example.com/article",
    context: "",
    isXLink: false,
    prefetchedPage: { text: "本文サンプル" },
  });
  assert.match(p, /信頼してよい/);
  assert.match(p, /Web検索/);
});

test("buildCaseAdderPrompt: isXLinkがtrueでtweetMedia指定時はprefetchedPageより優先される（X投稿の専用注入のみ）", () => {
  const p = buildCaseAdderPrompt({
    url: "https://x.com/user/status/1",
    context: "",
    isXLink: true,
    tweetMedia: { text: "ツイート本文", author: "author", createdAt: "2026-07-14T00:00:00.000Z", mediaPaths: [] },
    prefetchedPage: { text: "無視されるべき本文" },
  });
  assert.match(p, /ツイート本文/);
  assert.doesNotMatch(p, /無視されるべき本文/);
});
