// scripts/lib/exhibition-build.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/exhibition-build.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStatusUpdate,
  findDuplicate,
  diffDates,
  applyUpdate,
  dateAppearsInText,
  venueAppearsInText,
  htmlToText,
  verifyOfficialPage,
  processCandidates,
} from "./exhibition-build.mjs";

const TODAY = "2026-10-04";

function mkItem(over = {}) {
  return {
    id: "2026-test-museum-light-garden",
    slug: "2026-test-museum-light-garden",
    title: "光の庭",
    artists: ["山田"],
    venue: "テスト美術館",
    venueType: "museum",
    prefecture: "東京都",
    city: "港区",
    startDate: "2026-10-10",
    endDate: "2026-12-20",
    status: "upcoming",
    admission: "一般800円",
    tags: ["light"],
    score: 75,
    matchReason: "光を扱う。",
    sources: [{ name: "公式", url: "https://museum.example/ex/1", kind: "official" }],
    link: "https://museum.example/ex/1",
    thumbnail: "/thumbnails/exhibition/2026-test-museum-light-garden.jpg",
    addedAt: "2026-10-01T00:00:00.000Z",
    origin: "auto",
    highlight: false,
    ...over,
  };
}

function mkCand(over = {}) {
  return {
    title: "新しい展示",
    artists: ["鈴木"],
    venue: "別の美術館",
    venueType: "museum",
    prefecture: "大阪府",
    city: "大阪市",
    startDate: "2026-10-12",
    endDate: "2026-11-30",
    admission: "無料",
    tags: ["media_art", "installation"],
    score: 72,
    matchReason: "メディアアートの空間展示。",
    officialUrl: "https://other.example/ex/9",
    sources: [{ name: "TAB", url: "https://www.tokyoartbeat.com/events/x", kind: "listing" }],
    excludeCategory: "none",
    thumbnailSource: "https://other.example/ex/9",
    ...over,
  };
}

const okPage = (c) => `<html><body><h1>${c.title}</h1><p>${c.venue}</p><p>会期 2026年10月12日〜11月30日</p></body></html>`;

function mkDeps(overrides = {}) {
  const saved = [];
  return {
    saved,
    fetchHtml: async (url) => ({ status: 200, body: okPage(mkCand()) , url }),
    saveThumb: async (id) => {
      saved.push(id);
      return `/thumbnails/exhibition/${id}.jpg`;
    },
    now: () => "2026-10-04T01:00:00.000Z",
    ...overrides,
  };
}

const emptyData = () => ({ version: 1, statusAsOf: "2026-10-03", items: [] });

// ── status 更新 ──
test("applyStatusUpdate: ended 遷移と statusAsOf 更新（削除しない）", () => {
  const data = {
    version: 1,
    statusAsOf: "2026-10-03",
    items: [
      mkItem({ id: "a", slug: "a", startDate: "2026-09-01", endDate: "2026-10-03", status: "ongoing" }),
      mkItem({ id: "b", slug: "b", startDate: "2026-10-04", endDate: "2026-10-20", status: "upcoming" }),
      mkItem({ id: "c", slug: "c", startDate: "2026-12-01", endDate: "2026-12-20", status: "upcoming" }),
    ],
  };
  const { data: out, transitions } = applyStatusUpdate(data, TODAY);
  assert.equal(out.statusAsOf, TODAY);
  assert.equal(out.items.length, 3);
  assert.deepEqual(out.items.map((i) => i.status), ["ended", "ongoing", "upcoming"]);
  assert.deepEqual(transitions, [
    { id: "a", from: "ongoing", to: "ended" },
    { id: "b", from: "upcoming", to: "ongoing" },
  ]);
  // 入力は変更しない
  assert.equal(data.items[0].status, "ongoing");
  assert.equal(data.statusAsOf, "2026-10-03");
});

// ── dedupe ──
test("findDuplicate: normLink 一致（末尾スラッシュ・フラグメント差を吸収）", () => {
  const items = [mkItem()];
  const dup = findDuplicate(items, mkCand({ officialUrl: "https://museum.example/ex/1/#top", title: "全然違う題" }));
  assert.equal(dup?.kind, "link");
  assert.equal(dup?.item.id, items[0].id);
});

test("findDuplicate: 既存 sources の URL（listing 等）とも照合する", () => {
  const items = [mkItem({ sources: [{ name: "公式", url: "https://museum.example/ex/1", kind: "official" }, { name: "TAB", url: "https://www.tokyoartbeat.com/events/-/a/1/2026-10-10", kind: "listing" }] })];
  const dup = findDuplicate(items, mkCand({ officialUrl: "https://elsewhere.example/z", sources: [{ name: "TAB", url: "https://www.tokyoartbeat.com/events/-/a/1/2026-10-10", kind: "listing" }] }));
  assert.equal(dup?.kind, "link");
});

test("findDuplicate: title/venue/startDate 正規化一致（記号・空白・大小無視）", () => {
  const items = [mkItem({ title: "Light  Garden!", venue: "テスト 美術館", startDate: "2026-10-10" })];
  const dup = findDuplicate(items, mkCand({ title: "light garden", venue: "テスト美術館", startDate: "2026-10-10", officialUrl: "https://z.example/q" }));
  assert.equal(dup?.kind, "key");
});

test("findDuplicate: 同会場・同題でも会期（startDate）が違えば別展扱い", () => {
  const items = [mkItem()];
  const dup = findDuplicate(items, mkCand({ title: "光の庭", venue: "テスト美術館", startDate: "2027-04-01", endDate: "2027-05-01", officialUrl: "https://museum.example/ex/2" }));
  assert.equal(dup, null);
});

test("findDuplicate: 全く別の展示は null", () => {
  assert.equal(findDuplicate([mkItem()], mkCand()), null);
});

// ── 会期変更の差分更新 ──
test("diffDates: 変更なしは null / 変更ありは差分のみ", () => {
  const item = mkItem();
  assert.equal(diffDates(item, { startDate: item.startDate, endDate: item.endDate, venue: item.venue }), null);
  assert.deepEqual(diffDates(item, { startDate: item.startDate, endDate: "2027-01-10", venue: item.venue }), { endDate: "2027-01-10" });
});

test("applyUpdate: 日付差分を反映し status 再計算・addedAt/score/id は不変", () => {
  const item = mkItem({ startDate: "2026-09-01", endDate: "2026-10-03", status: "ended" });
  const out = applyUpdate(item, { endDate: "2026-10-31" }, TODAY);
  assert.equal(out.endDate, "2026-10-31");
  assert.equal(out.status, "ongoing");
  assert.equal(out.addedAt, item.addedAt);
  assert.equal(out.score, item.score);
  assert.equal(out.id, item.id);
});

// ── 公式ページ機械照合 ──
test("dateAppearsInText: 各種表記", () => {
  assert.ok(dateAppearsInText("会期 2026年10月18日まで", "2026-10-18"));
  assert.ok(dateAppearsInText("2026.10.18 sun", "2026-10-18"));
  assert.ok(dateAppearsInText("2026/10/18", "2026-10-18"));
  assert.ok(dateAppearsInText("2026-10-18", "2026-10-18"));
  assert.ok(dateAppearsInText("10月18日(日)まで", "2026-10-18"));
  assert.ok(dateAppearsInText("Oct 18, 2026", "2026-10-18"));
  assert.ok(dateAppearsInText("2026年10月08日", "2026-10-08"));
  assert.ok(dateAppearsInText("2026年10月8日", "2026-10-08"));
  assert.equal(dateAppearsInText("2026年10月19日", "2026-10-18"), false);
  assert.equal(dateAppearsInText("2026年10月180日", "2026-10-18"), false);
  assert.equal(dateAppearsInText("12026年110月118日", "2026-10-18"), false);
});

test("venueAppearsInText: 階数トークンを無視し主要語で照合", () => {
  assert.ok(venueAppearsInText("会場：Maruka 3F 中央区", "Maruka 3F"));
  assert.ok(venueAppearsInText("東京都現代美術館 MOT", "東京都現代美術館"));
  assert.equal(venueAppearsInText("どこか別の場所", "東京都現代美術館"), false);
});

test("htmlToText: script/style/タグを除去", () => {
  assert.equal(htmlToText("<style>a{}</style><script>var x=1</script><p>光<b>の</b>庭</p>").replace(/\s+/g, ""), "光の庭");
});

test("verifyOfficialPage: 日付・会場が一致すれば ok", async () => {
  const c = mkCand();
  const r = await verifyOfficialPage(c, { fetchHtml: async () => ({ status: 200, body: okPage(c) }) });
  assert.equal(r.ok, true);
});

test("verifyOfficialPage: 404 / 取得不能 / 日付不一致 / 会場不一致 は ng", async () => {
  const c = mkCand();
  assert.equal((await verifyOfficialPage(c, { fetchHtml: async () => ({ status: 404, body: "" }) })).ok, false);
  assert.equal((await verifyOfficialPage(c, { fetchHtml: async () => null })).ok, false);
  assert.equal((await verifyOfficialPage(c, { fetchHtml: async () => ({ status: 200, body: okPage(c).replace("11月30日", "12月31日") }) })).ok, false);
  assert.equal((await verifyOfficialPage(c, { fetchHtml: async () => ({ status: 200, body: okPage(c).replace(c.venue, "どこか") }) })).ok, false);
});

// ── processCandidates ──
test("processCandidates: 正常な候補は追加（origin auto・status 計算・highlight・thumbnail・official source）", async () => {
  const c = mkCand();
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps });
  assert.equal(r.added.length, 1);
  const it = r.data.items[0];
  assert.equal(it.id, it.slug);
  assert.match(it.id, /^2026-[a-z0-9-]+$/);
  assert.equal(it.status, "upcoming");
  assert.equal(it.score, 72);
  assert.equal(it.highlight, false);
  assert.equal(it.origin, "auto");
  assert.equal(it.link, c.officialUrl);
  assert.ok(it.sources.some((s) => s.kind === "official" && s.url === c.officialUrl));
  assert.ok(it.sources.some((s) => s.kind === "listing"));
  assert.equal(it.thumbnail, `/thumbnails/exhibition/${it.id}.jpg`);
  assert.equal(it.addedAt, "2026-10-04T01:00:00.000Z");
  assert.equal(r.data.statusAsOf, TODAY);
});

test("processCandidates: score>=80 は highlight", async () => {
  const c = mkCand({ score: 85 });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) }) });
  assert.equal(r.data.items[0].highlight, true);
});

test("processCandidates: 公式ページ不一致は unverified（追加せず理由つきで返す）", async () => {
  const c = mkCand();
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: "<p>別の展示 2026年1月1日</p>" }) });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps });
  assert.equal(r.added.length, 0);
  assert.equal(r.data.items.length, 0);
  assert.equal(r.unverified.length, 1);
  assert.equal(r.unverified[0].title, c.title);
  assert.ok(r.unverified[0].reason);
});

test("processCandidates: 会期不明（日付欠落）は unverified", async () => {
  const c = mkCand({ endDate: null });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps: mkDeps() });
  assert.equal(r.unverified.length, 1);
  assert.equal(r.added.length, 0);
});

test("processCandidates: 終了済み(endDate<today)・startDate>endDate は追加しない", async () => {
  const ended = mkCand({ startDate: "2026-09-01", endDate: "2026-10-03" });
  const bad = mkCand({ title: "逆転", startDate: "2026-11-10", endDate: "2026-11-01", officialUrl: "https://other.example/ex/10" });
  const r = await processCandidates({ data: emptyData(), candidates: [ended, bad], today: TODAY, deps: mkDeps() });
  assert.equal(r.added.length, 0);
  assert.equal(r.rejected.length, 2);
});

test("processCandidates: hard 除外カテゴリは reject（スコアが高くても）", async () => {
  const c = mkCand({ excludeCategory: "painting_oldmaster_ip", score: 95 });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) }) });
  assert.equal(r.added.length, 0);
  assert.equal(r.rejected[0].reason, "hard-exclusion");
});

test("processCandidates: score が add 閾値(60)未満は reject / collectAll は 60 に引き上げて追加", async () => {
  const low = mkCand({ score: 40 });
  const forced = mkCand({ title: "NEORT展", score: 40, collectAll: true, officialUrl: "https://two.neort.io/ja/exhibitions/x", sources: [] });
  const deps = mkDeps({ fetchHtml: async (u) => ({ status: 200, body: okPage(u.includes("neort") ? forced : low) }) });
  const r = await processCandidates({ data: emptyData(), candidates: [low, forced], today: TODAY, deps });
  assert.equal(r.added.length, 1);
  assert.equal(r.data.items[0].score, 60);
  assert.equal(r.rejected.some((x) => x.reason === "below-threshold"), true);
});

test("processCandidates: 既存と link 一致 → 追加せず、会期変更のみ差分更新（verified の場合）", async () => {
  const existing = mkItem({ startDate: "2026-10-10", endDate: "2026-12-20" });
  const c = mkCand({
    title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: "2026-10-10", endDate: "2027-01-10",
  });
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `<p>${existing.title} ${existing.venue} 2026年10月10日〜2027年1月10日</p>` }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(r.added.length, 0);
  assert.equal(r.updated.length, 1);
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].endDate, "2027-01-10");
  assert.equal(r.data.items[0].addedAt, existing.addedAt);
});

test("processCandidates: 既存と一致・変更なし → skipped(duplicate)、会期変更が公式で裏取りできなければ更新しない", async () => {
  const existing = mkItem();
  const same = mkCand({ title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: existing.startDate, endDate: existing.endDate });
  const r1 = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [same], today: TODAY, deps: mkDeps() });
  assert.equal(r1.skipped.length, 1);
  assert.equal(r1.skipped[0].reason, "duplicate");
  assert.equal(r1.skipped[0].existingId, existing.id);

  const changed = { ...same, endDate: "2027-03-01" };
  const r2 = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [changed], today: TODAY, deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: "<p>無関係</p>" }) }) });
  assert.equal(r2.updated.length, 0);
  assert.equal(r2.data.items[0].endDate, existing.endDate);
  assert.equal(r2.unverified.length, 1);
});

test("processCandidates: 同会場・別会期は重複扱いせず追加される", async () => {
  const existing = mkItem({ title: "新しい展示", venue: "別の美術館", startDate: "2026-04-01", endDate: "2026-05-01", status: "ended", link: "https://other.example/ex/old", sources: [{ name: "公式", url: "https://other.example/ex/old", kind: "official" }] });
  const c = mkCand();
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) }) });
  assert.equal(r.added.length, 1);
  assert.equal(r.data.items.length, 2);
});

test("processCandidates: サムネ取得不可は追加しない（thumbnail-unavailable）", async () => {
  const c = mkCand();
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }), saveThumb: async () => null });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps });
  assert.equal(r.added.length, 0);
  assert.equal(r.rejected[0].reason, "thumbnail-unavailable");
});

test("processCandidates: 1日の追加上限（collectAll 以外 maxAdd）", async () => {
  const cs = [1, 2, 3].map((n) => mkCand({ title: `展${n}`, officialUrl: `https://other.example/ex/${n}`, sources: [{ name: "TAB", url: `https://www.tokyoartbeat.com/events/-/e${n}`, kind: "listing" }], score: 70 + n }));
  const deps = mkDeps({ fetchHtml: async (u) => {
    const c = cs.find((x) => x.officialUrl === u);
    return { status: 200, body: okPage(c || cs[0]) };
  } });
  const r = await processCandidates({ data: emptyData(), candidates: cs, today: TODAY, deps, opts: { maxAdd: 2 } });
  assert.equal(r.added.length, 2);
  assert.equal(r.rejected.some((x) => x.reason === "daily-cap"), true);
  // スコア上位を優先
  assert.deepEqual(r.added.map((a) => a.title).sort(), ["展2", "展3"]);
});

test("processCandidates: intake 候補は origin=intake・+10 点・social ソース・intakeUrl", async () => {
  const c = mkCand({ score: 62, origin: "intake", intakeUrl: "https://x.com/u/status/1" });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) }) });
  const it = r.data.items[0];
  assert.equal(it.origin, "intake");
  assert.equal(it.intakeUrl, "https://x.com/u/status/1");
  assert.equal(it.score, 72);
  assert.ok(it.sources.some((s) => s.kind === "social" && s.url === "https://x.com/u/status/1"));
});

test("processCandidates: タグは語彙外を除去し、id は既存と衝突しない", async () => {
  const c = mkCand({ tags: ["media_art", "bogus"] });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) }) });
  assert.deepEqual(r.data.items[0].tags, ["media_art"]);
});

test("processCandidates: dryRun でも data を返すが saveThumb は呼ばない（呼び出し側が書かない前提）", async () => {
  const c = mkCand();
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c) }) });
  const r = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps, opts: { dryRun: true } });
  assert.equal(deps.saved.length, 0);
  assert.equal(r.added.length, 1);
});

test("processCandidates: 同一実行で追加済みの展示は会期差分でも更新しない（ラウンド間の日付揺れ対策）", async () => {
  const c = mkCand();
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `${okPage(c)} 2026年10月13日` }) });
  const r1 = await processCandidates({ data: emptyData(), candidates: [c], today: TODAY, deps });
  const addedId = r1.added[0].id;
  const r2 = await processCandidates({ data: r1.data, candidates: [{ ...c, startDate: "2026-10-13" }], today: TODAY, deps, opts: { protectIds: new Set([addedId]) } });
  assert.equal(r2.updated.length, 0);
  assert.equal(r2.skipped[0].reason, "duplicate");
  assert.equal(r2.data.items[0].startDate, "2026-10-12");
});

// ── レビュー修正（2026-10）: 必須欠落・型不正・公式照合強化 ──
import { isSafeOfficialUrl, isPublicHttpUrl, titleAppearsInText } from "./exhibition-build.mjs";

const run = (cands, depsOver = {}, opts) => {
  const c0 = mkCand();
  return processCandidates({
    data: emptyData(),
    candidates: cands,
    today: TODAY,
    deps: mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(c0) }), ...depsOver }),
    opts,
  });
};

test("processCandidates: city 空は追加せず unverified（理由つき・サムネ取得もしない）", async () => {
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: okPage(mkCand()) }) });
  const r = await processCandidates({ data: emptyData(), candidates: [mkCand({ city: "" })], today: TODAY, deps });
  assert.equal(r.added.length, 0);
  assert.equal(r.unverified.length, 1);
  assert.match(r.unverified[0].reason, /city/);
  assert.equal(deps.saved.length, 0);
});

test("processCandidates: matchReason 空・city 欠落（undefined）も unverified", async () => {
  const r1 = await run([mkCand({ matchReason: "  " })]);
  assert.equal(r1.added.length, 0);
  assert.match(r1.unverified[0].reason, /matchReason/);
  const c = mkCand();
  delete c.city;
  const r2 = await run([c]);
  assert.equal(r2.added.length, 0);
  assert.match(r2.unverified[0].reason, /city/);
});

test("processCandidates: null/非オブジェクト混在でも落ちず、有効候補は追加される", async () => {
  const r = await run([null, 5, "x", [], undefined, mkCand()]);
  assert.equal(r.added.length, 1);
  assert.equal(r.rejected.filter((x) => x.reason === "invalid-candidate").length, 5);
});

test("processCandidates: tags/sources/artists の型不正（文字列・オブジェクト・null）を配列化して処理", async () => {
  const r = await run([mkCand({ tags: "media_art", artists: "鈴木", sources: { name: "TAB", url: "https://www.tokyoartbeat.com/events/x", kind: "listing" } })]);
  assert.equal(r.added.length, 1);
  assert.deepEqual(r.added[0].tags, ["media_art"]);
  assert.deepEqual(r.added[0].artists, ["鈴木"]);
  const r2 = await run([mkCand({ tags: null, artists: 5, sources: [null, 3, { url: 5 }, { name: "x", url: "http://" }] })]);
  assert.equal(r2.added.length, 1);
  assert.deepEqual(r2.added[0].artists, []);
  assert.equal(r2.added[0].sources.length, 1);
});

test("processCandidates: 非文字列の title/venue/score/officialUrl でも run が落ちない", async () => {
  const r = await run([mkCand({ title: { a: 1 } }), mkCand({ venue: ["x"] }), mkCand({ officialUrl: 5 }), mkCand({ score: "abc" }), mkCand()]);
  assert.equal(r.added.length, 1);
});

test("processCandidates: 候補単位の例外（saveThumb throw 等）はその候補だけ reject して続行", async () => {
  const c1 = mkCand({ title: "展A", officialUrl: "https://other.example/ex/a", sources: [] });
  const c2 = mkCand({ title: "展B", officialUrl: "https://other.example/ex/b", sources: [], score: 70 });
  let n = 0;
  const r = await processCandidates({
    data: emptyData(), candidates: [c1, c2], today: TODAY,
    deps: mkDeps({
      fetchHtml: async (u) => ({ status: 200, body: okPage(u.endsWith("/a") ? c1 : c2) }),
      saveThumb: async (id) => { if (n++ === 0) throw new Error("boom"); return `/thumbnails/exhibition/${id}.jpg`; },
    }),
  });
  assert.equal(r.added.length, 1);
  assert.ok(r.rejected.some((x) => x.reason === "candidate-error" && /boom/.test(x.detail)));
});

test("isSafeOfficialUrl: http(s) のみ・localhost/プライベート/IP直書き・listing/social ホストは拒否", () => {
  for (const u of ["https://museum.example/ex/1", "http://museum.example/", "https://www.mot-art-museum.jp/exhibitions/x"]) assert.equal(isSafeOfficialUrl(u), true, u);
  for (const u of [
    "ftp://a.example/", "javascript:alert(1)", "file:///etc/passwd", "http://localhost/x", "http://foo.localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://169.254.169.254/", "http://[::1]/", "http://2130706433/", "http://8.8.8.8/", "http://intranet/", "http://", "", null, 5,
    "https://x.com/u/status/1", "https://twitter.com/u", "https://www.instagram.com/p/x/", "https://facebook.com/e", "https://www.tokyoartbeat.com/events/x",
    "https://artscape.jp/exhibition/x", "https://bijutsutecho.com/exhibitions/1", "https://api.fxtwitter.com/u/status/1", "https://www.youtube.com/watch?v=x", "https://youtu.be/x",
  ]) assert.equal(isSafeOfficialUrl(u), false, String(u));
});

test("isPublicHttpUrl: サムネ取得元は http(s)・非プライベートのみ（SNS 画像ホストは可）", () => {
  assert.equal(isPublicHttpUrl("https://pbs.twimg.com/media/x.jpg"), true);
  for (const u of ["http://127.0.0.1/a.jpg", "file:///a.jpg", "http://localhost/a.jpg", "http://192.168.0.1/a.jpg", "data:image/png;base64,xx"]) assert.equal(isPublicHttpUrl(u), false, u);
});

test("processCandidates: 非公式（SNS/listing/内部）URL を officialUrl にした候補は unverified（取得しない）", async () => {
  let fetched = 0;
  for (const u of ["https://www.tokyoartbeat.com/events/x", "http://127.0.0.1/x", "ftp://a.example/x"]) {
    const r = await run([mkCand({ officialUrl: u })], { fetchHtml: async () => { fetched++; return { status: 200, body: okPage(mkCand()) }; } });
    assert.equal(r.added.length, 0, u);
    assert.equal(r.unverified.length, 1, u);
  }
  assert.equal(fetched, 0);
});

test("processCandidates: 不正な thumbnailSource は捨てて公式ページにフォールバック（saveThumb へ渡さない）", async () => {
  let seen;
  const r = await run([mkCand({ thumbnailSource: "http://169.254.169.254/latest" })], { saveThumb: async (id, cand) => { seen = cand.thumbnailSource; return `/thumbnails/exhibition/${id}.jpg`; } });
  assert.equal(r.added.length, 1);
  assert.ok(!seen || seen === mkCand().officialUrl);
});

test("titleAppearsInText: 主要トークン照合（日付や汎用語だけでは通らない）", () => {
  assert.equal(titleAppearsInText("Exhibition 2026 メゾンエルメス", "Ugo Janssens 展"), false);
  assert.equal(titleAppearsInText("janssens | メゾンエルメス", "Janssens: Echo"), true);
  assert.equal(titleAppearsInText("光の庭 展示", "光の庭"), true);
  assert.equal(titleAppearsInText("2026年10月12日 開催", "展 2026"), false);
  assert.equal(titleAppearsInText("ここは別のページ", "光の庭"), false);
  assert.equal(titleAppearsInText("全く関係ない本文", "A"), false);
});

test("verifyOfficialPage: 本文に title が無ければ ng（日付・会場だけの一致は不可）", async () => {
  const c = mkCand({ title: "固有名ワードアート展" });
  const r = await verifyOfficialPage(c, { fetchHtml: async () => ({ status: 200, body: `<p>${c.venue}</p><p>2026年10月12日〜11月30日</p>` }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /title/);
});

test("venueAppearsInText: 汎用語（gallery/museum/art/center/ギャラリー/美術館…）だけの一致は無効", () => {
  assert.equal(venueAppearsInText("Visit the art museum gallery center", "Foo Gallery"), false);
  assert.equal(venueAppearsInText("どこかのギャラリーと美術館", "XYZ ギャラリー"), false);
  assert.equal(venueAppearsInText("Maison Hermès Le Forum gallery", "Maison Hermès Le Forum"), true);
  assert.equal(venueAppearsInText("foo gallery tokyo", "Foo Gallery"), true); // 全体一致
  assert.equal(venueAppearsInText("art center", "Art Center"), false); // 汎用語のみの会場名は不可
});

// ── 2026-10 誤判定修正: 字間スペース・短い固有名会場・既存会期の揺れ ──
test("dateAppearsInText: 字間スペース入り（1文字ずつ span）でも照合できる / 別日付の誤一致はしない", () => {
  const spaced = htmlToText("<span>2</span> <span>0</span> <span>2</span> <span>6</span> <span>年</span> <span>7</span> <span>月</span> <span>7</span> <span>日</span>");
  assert.equal(spaced, "2 0 2 6 年 7 月 7 日");
  assert.ok(dateAppearsInText(spaced, "2026-07-07"));
  assert.ok(dateAppearsInText("2 0 2 6 年 1 0 月 2 4 日 〜 2 7 日", "2026-10-24"));
  assert.ok(dateAppearsInText("開催 2 0 2 6 . 1 0 . 2 4 SAT", "2026-10-24"));
  // 空白を詰めても別日付にはならない（通常の語間スペースは詰めない）
  assert.equal(dateAppearsInText("2 0 2 6 年 7 月 7 日", "2026-07-17"), false);
  assert.equal(dateAppearsInText("2026年10月 2 4 日", "2026-10-04"), false);
  assert.equal(dateAppearsInText("10月 2 日 4 日", "2026-10-24"), false);
  assert.equal(dateAppearsInText("Room 1 0 2 4 seats", "2026-10-24"), false);
});

test("venueAppearsInText: 短い固有名（森美術館）は全体一致で照合可 / 汎用語のみ・東京のみは不可", () => {
  assert.ok(venueAppearsInText("会場：森美術館 六本木ヒルズ森タワー53階", "森美術館"));
  assert.equal(venueAppearsInText("六本木ヒルズ", "森美術館"), false);
  assert.equal(venueAppearsInText("東京の美術館", "美術館"), false);
  assert.equal(venueAppearsInText("東京の美術館", "東京美術館"), false);
  assert.equal(venueAppearsInText("東京", "東京"), false);
  assert.equal(venueAppearsInText("x museum", "X"), false); // ラテン1文字は従来どおり不可
});

test("processCandidates: 既存の会期が公式ページに残っていれば揺れた日付でパッチしない（skip: duplicate-existing-still-valid）", async () => {
  const existing = mkItem({ startDate: "2026-09-12", endDate: "2026-12-20" });
  const c = mkCand({ title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: "2026-09-29", endDate: "2026-12-20" });
  // 公式には既存の 9/12 も関連イベント日の 9/29 も載っている
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `<p>${existing.title} ${existing.venue} 2026年9月12日〜12月20日 関連イベント 9月29日</p>` }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(r.updated.length, 0);
  assert.equal(r.unverified.length, 0);
  assert.equal(r.skipped[0].reason, "duplicate-existing-still-valid");
  assert.equal(r.data.items[0].startDate, "2026-09-12");
});

test("processCandidates: 月省略表記のページでも既存 endDate は残っていると判定し、揺れた候補で上書きしない", async () => {
  const existing = mkItem({ startDate: "2026-10-24", endDate: "2026-10-27" });
  const c = mkCand({ title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: "2026-10-24", endDate: "2026-10-25" });
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `<p>${existing.title} ${existing.venue} 10/24(Sat)25(Sun)27(Tue)</p>` }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(r.updated.length, 0);
  assert.equal(r.skipped[0].reason, "duplicate-existing-still-valid");
  assert.equal(r.data.items[0].endDate, "2026-10-27");
});

test("processCandidates: 既存 venue が公式に残っていれば venue パッチしない", async () => {
  const existing = mkItem();
  const c = mkCand({ title: existing.title, venue: "別会場名ギャラリーX", officialUrl: existing.link, startDate: existing.startDate, endDate: existing.endDate });
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `<p>${existing.title} ${existing.venue} 別会場名ギャラリーX 2026年10月10日〜12月20日</p>` }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(r.updated.length, 0);
  assert.equal(r.skipped[0].reason, "duplicate-existing-still-valid");
  assert.equal(r.data.items[0].venue, existing.venue);
});

test("processCandidates: 既存の終了日だけ根拠を失った場合は終了日のみパッチ（開始日は残っていれば触らない）・fetch は1回", async () => {
  const existing = mkItem({ startDate: "2026-10-10", endDate: "2026-12-20" });
  const c = mkCand({ title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: "2026-10-11", endDate: "2027-01-10" });
  let calls = 0;
  const deps = mkDeps({ fetchHtml: async () => { calls++; return { status: 200, body: `<p>${existing.title} ${existing.venue} 2026年10月10日〜2027年1月10日 前夜祭 10月11日</p>` }; } });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(calls, 1);
  assert.equal(r.updated.length, 1);
  assert.deepEqual(r.updated[0].patch, { endDate: "2027-01-10" });
  assert.equal(r.data.items[0].startDate, "2026-10-10");
  assert.equal(r.data.items[0].endDate, "2027-01-10");
});
test("processCandidates: 公式照合は effective に残った項目だけ（start は既存が残るので候補 start が公式に無くても end のみ更新）", async () => {
  const existing = mkItem({ startDate: "2026-10-10", endDate: "2026-12-20" });
  const c = mkCand({ title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: "2026-10-15", endDate: "2027-01-10" });
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `<p>${existing.title} ${existing.venue} 2026年10月10日〜2027年1月10日</p>` }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(r.unverified.length, 0);
  assert.deepEqual(r.updated[0].patch, { endDate: "2027-01-10" });
  assert.equal(r.data.items[0].startDate, "2026-10-10");
});

test("processCandidates: 部分適用で start > end になるパッチは適用せず unverified", async () => {
  const existing = mkItem({ startDate: "2026-10-10", endDate: "2026-12-20" });
  const c = mkCand({ title: existing.title, venue: existing.venue, officialUrl: existing.link, startDate: "2027-01-05", endDate: "2027-01-10" });
  // 既存 start(10/10) は公式から消え、既存 end(12/20) は残っている → start のみ patch → 2027-01-05 > 2026-12-20
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: `<p>${existing.title} ${existing.venue} 2027年1月5日 〜 2026年12月20日</p>` }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [existing] }, candidates: [c], today: TODAY, deps });
  assert.equal(r.updated.length, 0);
  assert.equal(r.unverified.length, 1);
  assert.match(r.unverified[0].reason, /start-after-end|startDate.*endDate/);
  assert.equal(r.data.items[0].startDate, "2026-10-10");
});
// ── 巡回展: 公式URL同一でも会場が違い会期が重ならなければ別展示 ──
test("findDuplicate: 公式URL一致でも会場が異なり会期が重ならなければ別展示（巡回展）", () => {
  const items = [mkItem({ title: "光る音展", venue: "大阪アートエリアB1", startDate: "2026-10-24", endDate: "2026-10-27", link: "https://20th.example/", sources: [{ name: "公式", url: "https://20th.example/", kind: "official" }] })];
  const tour = mkCand({ title: "光る音展", venue: "BONDED GALLERY", startDate: "2026-11-04", endDate: "2026-11-08", officialUrl: "https://20th.example/" });
  assert.equal(findDuplicate(items, tour), null);
  // 会場が違っても会期が重なれば従来どおり重複（会場変更パッチ候補）
  const overlap = mkCand({ title: "光る音展", venue: "BONDED GALLERY", startDate: "2026-10-26", endDate: "2026-11-08", officialUrl: "https://20th.example/" });
  assert.equal(findDuplicate(items, overlap)?.kind, "link");
  // 会場が同じなら従来どおり重複
  const same = mkCand({ title: "光る音展", venue: "大阪アートエリアB1", startDate: "2026-11-04", endDate: "2026-11-08", officialUrl: "https://20th.example/" });
  assert.equal(findDuplicate(items, same)?.kind, "link");
});

test("processCandidates: 巡回展の2会場目が追加される（既存あり・同一実行内とも）・id は衝突しない", async () => {
  const a = mkCand({ title: "光る音展", venue: "Osaka Area B1", startDate: "2026-10-24", endDate: "2026-10-27", officialUrl: "https://20th.example/", sources: [] });
  const b = { ...a, venue: "BONDED GALLERY", startDate: "2026-11-04", endDate: "2026-11-08" };
  const body = `<p>光る音展 Osaka Area B1 BONDED GALLERY 10月24日〜10月27日 11月4日〜11月8日</p>`;
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body }) });
  const r1 = await processCandidates({ data: emptyData(), candidates: [a, b], today: TODAY, deps });
  assert.equal(r1.added.length, 2);
  assert.notEqual(r1.added[0].id, r1.added[1].id);
  const r2 = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [r1.added.find((x) => x.venue === "Osaka Area B1")] }, candidates: [b], today: TODAY, deps });
  assert.equal(r2.added.length, 1);
  assert.equal(r2.updated.length, 0);
});
// ── 2026-10-20 ICC 実例: dup 照合は既存エントリの公式ページで行う ──
const ICC_LINK = "https://www.ntticc.or.jp/ja/exhibitions/2026/icc-annual-2026/";
const iccItem = () => mkItem({ id: "2026-icc-icc-annual-2026", slug: "2026-icc-icc-annual-2026", title: "ICC アニュアル 2026", venue: "ICC", startDate: "2026-09-12", endDate: "2026-11-08", link: ICC_LINK, sources: [{ name: "公式", url: ICC_LINK, kind: "official" }] });
const iccCand = (over = {}) => mkCand({ title: "ICC アニュアル 2026", venue: "ICC", officialUrl: "https://www.ntticc.or.jp/ja/events/talk-0929/", sources: [{ name: "ICC", url: ICC_LINK, kind: "listing" }], startDate: "2026-06-20", endDate: "2026-11-08", ...over });

test("processCandidates: ICC 実例 - 候補が別URLでも既存ページに既存値が残るなら更新しない・候補URLは取得しない", async () => {
  const urls = [];
  const deps = mkDeps({ fetchHtml: async (url) => { urls.push(url); return { status: 200, body: "<p>ICC アニュアル 2026 ICC 会期：2026年6月20日（土）—11月8日（日） 関連イベント 9月12日 9月29日</p>" }; } });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [iccItem()] }, candidates: [iccCand(), iccCand({ startDate: "2026-09-29" })], today: TODAY, deps });
  assert.equal(r.updated.length, 0);
  assert.equal(r.data.items[0].startDate, "2026-09-12");
  assert.ok(urls.every((u) => u === ICC_LINK), urls.join(","));
});

test("processCandidates: 既存値が既存ページから消え新値が載っているときだけ更新（候補URLが別でも）・同一実行で再更新しない", async () => {
  const urls = [];
  const deps = mkDeps({ fetchHtml: async (url) => { urls.push(url); return { status: 200, body: "<p>ICC アニュアル 2026 ICC 会期：2026年6月20日—11月8日 関連イベント 9月29日</p>" }; } });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [iccItem()] }, candidates: [iccCand({ score: 90 }), iccCand({ startDate: "2026-09-29" })], today: TODAY, deps });
  assert.equal(r.updated.length, 1);
  assert.deepEqual(r.updated[0].patch, { startDate: "2026-06-20" });
  assert.equal(r.data.items[0].startDate, "2026-06-20");
  assert.equal(r.skipped.length, 1);
  assert.ok(urls.every((u) => u === ICC_LINK));
});

test("processCandidates: 既存エントリの公式ページが取得できなければパッチせず skipped", async () => {
  for (const fetchHtml of [async () => ({ status: 404, body: "" }), async () => { throw new Error("boom"); }]) {
    const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [iccItem()] }, candidates: [iccCand()], today: TODAY, deps: mkDeps({ fetchHtml }) });
    assert.equal(r.updated.length, 0);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /duplicate-existing-page/);
    assert.equal(r.data.items[0].startDate, "2026-09-12");
  }
});

test("processCandidates: opts.protectIds の展示は更新しない", async () => {
  const deps = mkDeps({ fetchHtml: async () => ({ status: 200, body: "<p>ICC アニュアル 2026 ICC 2026年6月20日—11月8日</p>" }) });
  const r = await processCandidates({ data: { version: 1, statusAsOf: "2026-10-03", items: [iccItem()] }, candidates: [iccCand()], today: TODAY, deps, opts: { protectIds: new Set(["2026-icc-icc-annual-2026"]) } });
  assert.equal(r.updated.length, 0);
});

// ── 月省略の会期表記（開始日の直後に終了日の「日」だけが続く）──
async function endDateCheck(body, startDate, endDate) {
  const cand = { officialUrl: "https://example.com/x", title: "光る音展", venue: "テスト美術館", startDate, endDate };
  return verifyOfficialPage(cand, { fetchHtml: async () => ({ status: 200, body: `<p>光る音展 テスト美術館 ${body}</p>` }) });
}

test("終了日照合: 月省略の会期表記を認める", async () => {
  const ok = async (body, s, e) => assert.equal((await endDateCheck(body, s, e)).ok, true, body);
  await ok("10/24(Sat)25(Sun)27(Tue)", "2026-10-24", "2026-10-27");
  await ok("11/4(Wed)–8(Sun),2026", "2026-11-04", "2026-11-08");
  await ok("10月24日（土）〜27日（火）", "2026-10-24", "2026-10-27");
  await ok("2026.10.24 - 27", "2026-10-24", "2026-10-27");
  await ok("10.24 sat — 27 tue", "2026-10-24", "2026-10-27");
  await ok("会期 2026年10月24日(土)・25日(日)・27日(火)※月曜日休館", "2026-10-24", "2026-10-27");
  await ok("2 0 2 6 . 1 0 . 2 4 - 2 7", "2026-10-24", "2026-10-27");
  await ok("1 0 / 2 4 ( S a t ) 2 5 ( S u n ) 2 7 ( T u e ) , 2 0 2 6 ※ 1 1 : 0 0", "2026-10-24", "2026-10-27");
  await ok("1 1 / 4 ( W e d ) – 8 ( S u n ) , 2 0 2 6", "2026-11-04", "2026-11-08");
});

test("終了日照合: 別月・遠い位置・時刻/電話番号では通らない", async () => {
  const ng = async (body, s, e) => assert.equal((await endDateCheck(body, s, e)).ok, false, body);
  await ng("10/24(Sat) 11/27(Fri)", "2026-10-24", "2026-10-27");
  await ng("10/24 – 11月27日", "2026-10-24", "2026-10-27");
  await ng("10/24 – Nov 27", "2026-10-24", "2026-10-27");
  await ng(`10/24 ${"あ".repeat(45)} 27`, "2026-10-24", "2026-10-27");
  await ng("10/24 開場 27:00", "2026-10-24", "2026-10-27");
  await ng("10/24 開場 10:27", "2026-10-24", "2026-10-27");
  await ng("10/24 TEL 03-1234-5627", "2026-10-24", "2026-10-27");
  for (const b of [
    "10/24 – 11-27", "10/24 – 11 27", "10/24 – 27 Dec", "10/24 – 27 Nov", "10/24 – 27 December", "10/24 – 27th Dec",
    "10/24 – 27年", "10/24 – 27時", "10/24 – 27歳", "10/24 – 27点", "10/24 – 27名", "10/24 – 27人", "10/24 – 27,000円",
    "10/24 – 27-1234", "10/24 – 27-1234-5678", "10/24 03-27", "10/24 (Sat) 12 27",
  ]) await ng(b, "2026-10-24", "2026-10-27");
  await ng("10/24 2 0 2 6", "2026-10-24", "2026-10-26");
  await ng("営業時間 10/1 10-18時", "2026-10-01", "2026-10-18");
  await ng("営業時間 10/3 10-17", "2026-10-03", "2026-10-17");
  // 開始日と終了日が別月なら範囲照合は使わない
  await ng("10/24 – 27", "2026-10-24", "2026-11-27");
});