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
