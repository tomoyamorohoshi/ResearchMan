/**
 * pipeline/addExhibition.ts のテスト（node:test）。Claude呼び出しはモック
 * （case-adderの応答JSONを直接渡す）、公式ページ取得・サムネ保存もdeps注入でモックする。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { processExhibitionAdd, type ExhibitionData } from "./addExhibition.js";

const URL_ = "https://20th.starryworks.co.jp/";
const TODAY = "2026-10-20";

const OFFICIAL_HTML = `<html><body><h1>光る音展</h1>
<p>会場: 大阪アートエリアB1 / 会期: 2026年10月24日〜10月27日</p>
<p>東京会場 2026年11月4日〜11月8日 東京ミッドタウン</p></body></html>`;

const baseCand = {
  title: "光る音展",
  artists: ["スターリーワークス"],
  venue: "大阪アートエリアB1",
  venueType: "other",
  prefecture: "大阪府",
  city: "大阪市",
  startDate: "2026-10-24",
  endDate: "2026-10-27",
  admission: "UNKNOWN",
  tags: ["sound", "installation"],
  score: 70,
  matchReason: "音と光を扱うインスタレーション展。",
  officialUrl: URL_,
  slugTitle: "hikaru-oto",
  slugVenue: "osaka-area-b1",
  thumbnailSource: "https://20th.starryworks.co.jp/og.jpg",
};

function makeData(): ExhibitionData {
  return { version: 1, statusAsOf: TODAY, items: [] } as unknown as ExhibitionData;
}

function makeDeps(html = OFFICIAL_HTML) {
  return {
    fetchHtml: async () => ({ status: 200, body: html }),
    saveThumb: async (id: string) => `/thumbnails/exhibition/${id}.jpg`,
    now: () => "2026-10-20T00:00:00.000Z",
  };
}

const opts = { addThreshold: 60, highlightThreshold: 80, reservedIds: new Set<string>() };

test("光る音展: contentKind:exhibition の応答から intake候補が作られ追加される", async () => {
  const obj = { contentKind: "exhibition", found: true, candidates: [baseCand] };
  const r = await processExhibitionAdd({ obj, url: URL_, data: makeData(), today: TODAY, deps: makeDeps(), opts });
  assert.equal(r.outcome, "added");
  assert.equal(r.added.length, 1);
  const item = r.added[0];
  assert.equal(item.origin, "intake");
  assert.equal(item.intakeUrl, URL_);
  assert.equal(item.link, URL_);
  assert.equal(r.data.items.length, 1);
  assert.ok(r.thumbnailRelPaths[0].replace(/\\/g, "/").startsWith("public/thumbnails/exhibition/"));
});

test("dryRun: サムネを保存せず(saveThumb未呼び出し)に added が返る", async () => {
  let saved = 0;
  const deps = {
    ...makeDeps(),
    saveThumb: async (id: string) => {
      saved++;
      return `/thumbnails/exhibition/${id}.jpg`;
    },
  };
  const obj = { contentKind: "exhibition", candidates: [baseCand] };
  const r = await processExhibitionAdd({ obj, url: URL_, data: makeData(), today: TODAY, deps, opts: { ...opts, dryRun: true } });
  assert.equal(r.outcome, "added");
  assert.equal(saved, 0);
});

test("巡回展: 会場ごとの別候補が両方追加される", async () => {
  const tokyo = {
    ...baseCand,
    venue: "東京ミッドタウン",
    prefecture: "東京都",
    city: "港区",
    startDate: "2026-11-04",
    endDate: "2026-11-08",
    slugVenue: "tokyo-midtown",
    // processCandidatesは公式URL一致を重複(link)とみなすため、巡回展は会場別の公式ページURLが必要
    officialUrl: "https://20th.starryworks.co.jp/tokyo/",
  };
  const obj = { contentKind: "exhibition", candidates: [baseCand, tokyo] };
  const r = await processExhibitionAdd({ obj, url: URL_, data: makeData(), today: TODAY, deps: makeDeps(), opts });
  assert.equal(r.outcome, "added");
  assert.equal(r.added.length, 2);
  assert.equal(new Set(r.added.map((a) => a.id)).size, 2);
});

test("公式ページで会期が確認できない場合は unverified＋平易な理由", async () => {
  const deps = makeDeps("<html><body>光る音展 大阪アートエリアB1 近日公開</body></html>");
  const obj = { contentKind: "exhibition", candidates: [baseCand] };
  const r = await processExhibitionAdd({ obj, url: URL_, data: makeData(), today: TODAY, deps, opts });
  assert.equal(r.outcome, "unverified");
  assert.equal(r.unverified.length, 1);
  assert.match(r.reasonJa, /公式ページで会期が確認できませんでした/);
  assert.equal(r.data.items.length, 0);
});

test("公式URLが無い候補は unverified（公式ページが見つかりませんでした）", async () => {
  const obj = { contentKind: "exhibition", candidates: [{ ...baseCand, officialUrl: "" }] };
  const r = await processExhibitionAdd({ obj, url: URL_, data: makeData(), today: TODAY, deps: makeDeps(), opts });
  assert.equal(r.outcome, "unverified");
  assert.match(r.reasonJa, /公式ページ/);
});

test("終了済みは rejected（既に終了）", async () => {
  const obj = { contentKind: "exhibition", candidates: [{ ...baseCand, startDate: "2026-01-01", endDate: "2026-01-05" }] };
  const r = await processExhibitionAdd({ obj, url: URL_, data: makeData(), today: TODAY, deps: makeDeps(), opts });
  assert.equal(r.outcome, "rejected");
  assert.match(r.reasonJa, /終了/);
});

test("既に掲載済みなら duplicate（追加しない）", async () => {
  const first = await processExhibitionAdd({
    obj: { candidates: [baseCand] },
    url: URL_,
    data: makeData(),
    today: TODAY,
    deps: makeDeps(),
    opts,
  });
  const r = await processExhibitionAdd({
    obj: { candidates: [baseCand] },
    url: URL_,
    data: first.data,
    today: TODAY,
    deps: makeDeps(),
    opts: { ...opts, reservedIds: new Set<string>() },
  });
  assert.equal(r.outcome, "duplicate");
  assert.equal(r.added.length, 0);
  assert.equal(r.duplicateTitle, "光る音展");
});

test("reservedIds（cases/techのid）と衝突しないidが振られる", async () => {
  const probe = await processExhibitionAdd({
    obj: { candidates: [baseCand] },
    url: URL_,
    data: makeData(),
    today: TODAY,
    deps: makeDeps(),
    opts,
  });
  const takenId = probe.added[0].id;
  const r = await processExhibitionAdd({
    obj: { candidates: [baseCand] },
    url: URL_,
    data: makeData(),
    today: TODAY,
    deps: makeDeps(),
    opts: { ...opts, reservedIds: new Set([takenId]) },
  });
  assert.notEqual(r.added[0].id, takenId);
});

test("candidatesが空なら rejected（展覧会として特定できませんでした）", async () => {
  const r = await processExhibitionAdd({
    obj: { contentKind: "exhibition", candidates: [] },
    url: URL_,
    data: makeData(),
    today: TODAY,
    deps: makeDeps(),
    opts,
  });
  assert.equal(r.outcome, "rejected");
  assert.match(r.reasonJa, /展覧会/);
});
