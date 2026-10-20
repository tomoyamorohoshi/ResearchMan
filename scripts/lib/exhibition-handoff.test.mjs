// cc ジョブ → Exhibition ジョブの引き継ぎ（data/inbox/exhibition-handoff.json）のテスト。実 Claude・実ネットワークは使わない。
// 実行: node --test scripts/lib/exhibition-handoff.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { toHandoffItem, appendHandoff, consumeHandoff, HANDOFF_REL } from "./exhibition-handoff.mjs";

const TODAY = "2026-10-20";

function cand(over = {}) {
  return {
    title: "Timber / Timbre（Anthropic『Machines of Loving Grace』展）",
    client: "Anthropic",
    year: "2026",
    link: "https://news.example/article/1",
    note: "木と音のインスタレーション",
    gateReason: "空間体験の発明",
    contentKind: "exhibition",
    exhibition: {
      venue: "KARIMOKU RESEARCH CENTER", venueType: "corporate", prefecture: "東京都", city: "港区",
      startDate: "2026-10-17", endDate: "2026-10-25", admission: "無料", officialUrl: "https://karimoku.example/mol",
      artists: ["A"], tags: ["light"], score: 70,
    },
    ...over,
  };
}

test("toHandoffItem: 開催中の展覧会告知は Exhibition 候補形式に変換（元記事URL付き）", () => {
  const it = toHandoffItem(cand(), TODAY);
  assert.equal(it.venue, "KARIMOKU RESEARCH CENTER");
  assert.equal(it.startDate, "2026-10-17");
  assert.equal(it.officialUrl, "https://karimoku.example/mol");
  assert.equal(it.sourceUrl, "https://news.example/article/1");
  assert.equal(it.score, 70);
  assert.deepEqual(it.sources, [{ name: "元記事", url: "https://news.example/article/1", kind: "news" }]);
  assert.ok(it.matchReason);
});

test("toHandoffItem: 開催前でも可 / 終了日が今日はOK", () => {
  assert.ok(toHandoffItem(cand({ exhibition: { ...cand().exhibition, startDate: "2026-11-01", endDate: "2026-11-10" } }), TODAY));
  assert.ok(toHandoffItem(cand({ exhibition: { ...cand().exhibition, endDate: TODAY } }), TODAY));
});

test("toHandoffItem: 終了済み・会場/会期欠落・contentKind が exhibition でないものは null（通常の cases 判定に回す）", () => {
  assert.equal(toHandoffItem(cand({ exhibition: { ...cand().exhibition, endDate: "2026-10-19" } }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: { ...cand().exhibition, venue: "" } }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: { ...cand().exhibition, startDate: "" } }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: { ...cand().exhibition, startDate: "2026-10-30", endDate: "2026-10-25" } }), TODAY), null);
  assert.equal(toHandoffItem(cand({ contentKind: "case" }), TODAY), null);
  assert.equal(toHandoffItem(cand({ contentKind: undefined }), TODAY), null);
  assert.equal(toHandoffItem(cand({ exhibition: undefined }), TODAY), null);
});

test("toHandoffItem: score が不正なら 0（Exhibition 側で below-threshold になる安全側）", () => {
  assert.equal(toHandoffItem(cand({ exhibition: { ...cand().exhibition, score: "abc" } }), TODAY).score, 0);
});

test("appendHandoff: 追記・重複排除・既存の壊れたファイルは作り直し", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  const it = toHandoffItem(cand(), TODAY);
  await appendHandoff(root, [it]);
  await appendHandoff(root, [it, { ...it, title: "別", officialUrl: "https://x.example/2" }]);
  const j = JSON.parse(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"));
  assert.equal(j.version, 1);
  assert.equal(j.items.length, 2);
  fs.writeFileSync(path.join(root, HANDOFF_REL), "{broken");
  await appendHandoff(root, [it]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8")).items.length, 1);
});

const deps = {
  fetchHtml: async () => ({ status: 200, body: "<html><body>KARIMOKU RESEARCH CENTER Timber / Timbre 2026年10月17日 〜 2026年10月25日 (2026-10-17 2026-10-25)</body></html>" }),
  saveThumb: async (id) => `/thumbnails/exhibition/${id}.jpg`,
  now: () => "2026-10-20T00:00:00.000Z",
};
const baseData = () => ({ version: 1, statusAsOf: TODAY, items: [] });
const opts = { addThreshold: 60, highlightThreshold: 80, dryRun: false, reservedIds: new Set() };

function writeHandoff(root, items) {
  fs.mkdirSync(path.join(root, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(root, HANDOFF_REL), JSON.stringify({ version: 1, items }));
}

test("consumeHandoff: 処理済み（added）は handoff から除去され origin=auto で追加される", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  const it = toHandoffItem(cand({ title: "Timber / Timbre" }), TODAY);
  writeHandoff(root, [it]);
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts, dryRun: false });
  assert.equal(out.added.length, 1, JSON.stringify(out));
  assert.equal(out.added[0].origin, "auto");
  assert.equal(out.data.items.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8")).items, []);
});

test("consumeHandoff: rejected(below-threshold) は除去、daily-cap だけは翌日に持ち越し", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  const low = toHandoffItem(cand({ title: "低スコア", exhibition: { ...cand().exhibition, score: 10, officialUrl: "https://a.example/1" } }), TODAY);
  const ok = toHandoffItem(cand({ title: "Timber / Timbre", exhibition: { ...cand().exhibition, officialUrl: "https://a.example/3" } }), TODAY);
  writeHandoff(root, [low, ok]);
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts: { ...opts, maxAdd: 0 }, dryRun: false });
  assert.equal(out.added.length, 0);
  assert.equal(out.rejected.length, 2);
  const left = JSON.parse(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8")).items;
  assert.deepEqual(left.map((x) => x.title), ["Timber / Timbre"]);
});

test("consumeHandoff: unverified（公式ページ不一致）も除去される", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  writeHandoff(root, [toHandoffItem(cand({ title: "不一致" }), TODAY)]);
  const d = { ...deps, fetchHtml: async () => ({ status: 200, body: "<html>関係ない</html>" }) };
  const out = await consumeHandoff({ root, data: baseData(), today: TODAY, deps: d, opts, dryRun: false });
  assert.equal(out.unverified.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8")).items, []);
});

test("consumeHandoff: dryRun ではファイルを書き換えない", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  writeHandoff(root, [toHandoffItem(cand({ title: "Timber / Timbre" }), TODAY)]);
  const before = fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8");
  await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts: { ...opts, dryRun: true }, dryRun: true });
  assert.equal(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"), before);
});

test("consumeHandoff: ファイル無し・壊れていても警告して続行（data は変えない）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
  const a = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts, dryRun: false });
  assert.equal(a.added.length, 0);
  assert.equal(a.warning, undefined);
  fs.mkdirSync(path.join(root, "data/inbox"), { recursive: true });
  fs.writeFileSync(path.join(root, HANDOFF_REL), "{broken");
  const b = await consumeHandoff({ root, data: baseData(), today: TODAY, deps, opts, dryRun: false });
  assert.equal(b.added.length, 0);
  assert.ok(b.warning);
  assert.equal(fs.readFileSync(path.join(root, HANDOFF_REL), "utf-8"), "{broken");
});
