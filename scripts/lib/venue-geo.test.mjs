// 会場座標（Nominatim）ロジックのテスト。ネットワークは呼ばない（fetch を注入）。
// 実行: node --test scripts/lib/venue-geo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuery,
  pickCandidate,
  pendingVenues,
  createThrottle,
  geocodeVenue,
  geocodeAll,
  serializeGeo,
} from "./venue-geo.mjs";

const item = (venue, prefecture = "東京都", city = "港区", extra = {}) => ({ venue, prefecture, city, ...extra });
const okFetch = (results) => async () => ({ ok: true, status: 200, json: async () => results });
const noWait = async () => {};

test("buildQuery: venue city prefecture をスペース連結", () => {
  assert.equal(buildQuery({ venue: "森美術館", city: "港区", prefecture: "東京都" }), "森美術館 港区 東京都");
});

test("pickCandidate: prefecture を含まない結果は不採用、含む最初の候補を採用", () => {
  const results = [
    { lat: "34.0", lon: "135.0", display_name: "森美術館, 大阪府, 日本" },
    { lat: "35.6604", lon: "139.7292", display_name: "森美術館, 港区, 東京都, 日本" },
  ];
  assert.equal(pickCandidate(results, "東京都").lat, "35.6604");
  assert.equal(pickCandidate([results[0]], "東京都"), null);
  // address の各フィールドに含まれていても採用
  const viaAddr = [{ lat: "1", lon: "2", display_name: "X", address: { state: "東京都" } }];
  assert.ok(pickCandidate(viaAddr, "東京都"));
  assert.equal(pickCandidate([], "東京都"), null);
  assert.equal(pickCandidate(null, "東京都"), null);
});

test("pendingVenues: 登録済み・manual をスキップ、trim して一意化、quarantined 除外", () => {
  const items = [
    item("森美術館"),
    item(" 森美術館 "),
    item("NEORT++", "東京都", "中央区"),
    item("手動会場"),
    item("隔離会場", "東京都", "港区", { quarantined: true }),
    item("   "),
    item("登録済み"),
  ];
  const geo = {
    version: 1,
    venues: {
      手動会場: { lat: 1, lng: 2, source: "manual" },
      登録済み: { lat: 1, lng: 2, source: "nominatim" },
    },
  };
  const p = pendingVenues(items, geo);
  assert.deepEqual(p.map((v) => v.venue), ["NEORT++", "森美術館"]);
});

test("createThrottle: 直前の呼び出しから 1000ms 未満なら不足分だけ sleep", async () => {
  let t = 10000;
  const sleeps = [];
  const wait = createThrottle({ now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, intervalMs: 1000 });
  await wait(); // 初回は待たない
  t += 300;
  await wait(); // 700ms 待つ
  t += 1500;
  await wait(); // 十分空いている
  assert.deepEqual(sleeps, [700]);
});

test("geocodeVenue: 採用候補の座標を返す。User-Agent と必須パラメータを付ける", async () => {
  let seen;
  const f = async (url, opts) => {
    seen = { url: String(url), ua: opts.headers["User-Agent"] };
    return { ok: true, status: 200, json: async () => [{ lat: "35.6604", lon: "139.7292", display_name: "森美術館, 東京都" }] };
  };
  const r = await geocodeVenue({ venue: "森美術館", city: "港区", prefecture: "東京都" }, { fetchImpl: f, wait: noWait, userAgent: "UA/1 (+https://x)" });
  assert.deepEqual(r, { lat: 35.6604, lng: 139.7292, displayName: "森美術館, 東京都", query: "森美術館 港区 東京都" });
  assert.equal(seen.ua, "UA/1 (+https://x)");
  const u = new URL(seen.url);
  assert.equal(u.searchParams.get("format"), "jsonv2");
  assert.equal(u.searchParams.get("addressdetails"), "1");
  assert.equal(u.searchParams.get("countrycodes"), "jp");
  assert.equal(u.searchParams.get("q"), "森美術館 港区 東京都");
});

test("geocodeVenue: HTTP エラー・空結果・例外・不採用は throw せず null", async () => {
  const v = { venue: "A", city: "c", prefecture: "東京都" };
  const o = (fetchImpl) => ({ fetchImpl, wait: noWait, userAgent: "UA" });
  assert.equal(await geocodeVenue(v, o(async () => ({ ok: false, status: 503, json: async () => [] }))), null);
  assert.equal(await geocodeVenue(v, o(okFetch([]))), null);
  assert.equal(await geocodeVenue(v, o(async () => { throw new Error("network"); })), null);
  assert.equal(await geocodeVenue(v, o(okFetch([{ lat: "1", lon: "2", display_name: "大阪府" }]))), null);
  assert.equal(await geocodeVenue(v, o(okFetch([{ lat: "x", lon: "y", display_name: "東京都" }]))), null);
});

test("geocodeAll: 取得分だけ追加、manual は上書きしない、失敗は failed に列挙、登録済みは問い合わせない", async () => {
  const items = [item("森美術館"), item("手動会場"), item("登録済み"), item("不明会場")];
  const geo = {
    version: 1,
    venues: {
      手動会場: { lat: 9, lng: 9, source: "manual", query: "q", checkedAt: "2026-01-01" },
      登録済み: { lat: 1, lng: 2, source: "nominatim", query: "q", checkedAt: "2026-01-01" },
    },
  };
  const queried = [];
  const f = async (url) => {
    const q = new URL(url).searchParams.get("q");
    queried.push(q);
    const res = q.startsWith("森美術館") ? [{ lat: "35.6604", lon: "139.7292", display_name: "東京都" }] : [];
    return { ok: true, status: 200, json: async () => res };
  };
  const out = await geocodeAll(items, geo, { fetchImpl: f, wait: noWait, userAgent: "UA", today: "2026-10-24" });
  assert.deepEqual(queried.sort(), ["不明会場", "不明会場 港区 東京都", "森美術館 港区 東京都"].sort()); // 不明会場は二段目の会場名のみ検索も走る
  assert.deepEqual(out.added.map((a) => a.venue), ["森美術館"]);
  assert.deepEqual(out.failed.map((a) => a.venue), ["不明会場"]);
  assert.deepEqual(out.geo.venues["森美術館"], { lat: 35.6604, lng: 139.7292, source: "nominatim", query: "森美術館 港区 東京都", checkedAt: "2026-10-24" });
  assert.equal(out.geo.venues["手動会場"].lat, 9);
  assert.equal(out.geo.venues["不明会場"], undefined);
  assert.equal(geo.venues["森美術館"], undefined, "入力 geo を破壊しない");
});

test("serializeGeo: 会場名でキーソート・2スペース・末尾改行", () => {
  const s = serializeGeo({ version: 1, venues: { b: { lat: 1 }, a: { lat: 2 } } });
  assert.ok(s.endsWith("}\n"));
  assert.ok(s.indexOf('"a"') < s.indexOf('"b"'));
  assert.match(s, /\n {2}"venues": \{/);
});

test("run-job.mjs: Exhibition は監査後に geocode-venues を実行し、venue-geo.json も git add する", async () => {
  const fs = await import("fs");
  const src = fs.readFileSync(new URL("../windows/run-job.mjs", import.meta.url), "utf8");
  const iAudit = src.indexOf("scripts/audit-exhibition.mjs");
  const iGeo = src.indexOf("scripts/geocode-venues.mjs");
  const iAdd = src.indexOf('runGit(["add", "data/exhibition.json", "data/venue-geo.json"');
  assert.ok(iAudit > 0 && iGeo > iAudit && iAdd > iGeo);
});

test("geocodeVenue: 1回目不採用なら会場名だけで再検索し、採用ならその query を返す", async () => {
  const qs = [];
  const f = async (url) => {
    const q = new URL(url).searchParams.get("q");
    qs.push(q);
    const res = q === "森美術館" ? [{ lat: "35.66", lon: "139.72", display_name: "森美術館, 東京都" }] : [{ lat: "1", lon: "2", display_name: "大分県" }];
    return { ok: true, status: 200, json: async () => res };
  };
  const r = await geocodeVenue({ venue: "森美術館", city: "港区", prefecture: "東京都" }, { fetchImpl: f, wait: noWait, userAgent: "UA" });
  assert.deepEqual(qs, ["森美術館 港区 東京都", "森美術館"]);
  assert.equal(r.query, "森美術館");
  assert.equal(r.lat, 35.66);
});

test("geocodeVenue: 2回目も不採用なら null。2回目の前にも wait を呼ぶ（1秒間隔）", async () => {
  let waits = 0;
  const f = async () => ({ ok: true, status: 200, json: async () => [{ lat: "1", lon: "2", display_name: "大分県" }] });
  const r = await geocodeVenue({ venue: "X", city: "c", prefecture: "東京都" }, { fetchImpl: f, wait: async () => { waits++; }, userAgent: "UA" });
  assert.equal(r, null);
  assert.equal(waits, 2);
});

test("geocodeVenue: 二段目も実時間の throttle で1000ms空く", async () => {
  let t = 0;
  const calls = [];
  const wait = createThrottle({ now: () => t, sleep: async (ms) => { t += ms; }, intervalMs: 1000 });
  const f = async () => { calls.push(t); return { ok: true, status: 200, json: async () => [] }; };
  await geocodeVenue({ venue: "X", city: "c", prefecture: "東京都" }, { fetchImpl: f, wait, userAgent: "UA" });
  assert.equal(calls.length, 2);
  assert.ok(calls[1] - calls[0] >= 1000);
});

test("pickCandidate: address の都道府県と完全一致で判定（施設名に県名を含む別県は不採用）", () => {
  const kofu = { lat: "1", lon: "2", display_name: "東京都庁舎分室, 甲府市, 山梨県, 日本", address: { office: "東京都庁舎分室", city: "甲府市", province: "山梨県" } };
  const yokohama = { lat: "1", lon: "2", display_name: "東京都立xx高校, 横浜市, 神奈川県, 日本", address: { amenity: "東京都立xx高校", city: "横浜市", state: "神奈川県" } };
  assert.equal(pickCandidate([kofu], "東京都"), null);
  assert.equal(pickCandidate([yokohama], "東京都"), null);
  assert.ok(pickCandidate([kofu, { lat: "3", lon: "4", display_name: "A, 東京都", address: { province: "東京都" } }], "東京都"));
});

test("pickCandidate: 都道府県フィールドが無い結果（東京都）は先頭成分を除いた成分との完全一致で判定", () => {
  const mori = { lat: "35.66", lon: "139.72", display_name: "森美術館, 1, 六本木六丁目, 六本木, 港区, 東京都, 106-6122, 日本", address: { tourism: "森美術館", "ISO3166-2-lvl4": "JP-13" } };
  assert.ok(pickCandidate([mori], "東京都"));
  // 先頭成分（施設名）が県名でも、後ろの成分に無ければ不採用
  const fake = { lat: "1", lon: "2", display_name: "東京都庁舎分室, 甲府市, 日本", address: { office: "東京都庁舎分室" } };
  assert.equal(pickCandidate([fake], "東京都"), null);
});

test("geocodeVenue: ハングする fetch はタイムアウトで null（signal を渡す）", async () => {
  const f = (url, opts) =>
    new Promise((_, reject) => {
      assert.ok(opts.signal, "signal が渡されていない");
      opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const r = await geocodeVenue({ venue: "X", city: "c", prefecture: "東京都" }, { fetchImpl: f, wait: noWait, userAgent: "UA", timeoutMs: 20 });
  assert.equal(r, null);
});

test("geocodeAll: 429 を受けたら残りを打ち切り blocked=true、残りは skipped", async () => {
  const items = [item("A"), item("B"), item("C")];
  let n = 0;
  const f = async () => {
    n++;
    return { ok: false, status: 429, json: async () => [] };
  };
  const out = await geocodeAll(items, { version: 1, venues: {} }, { fetchImpl: f, wait: noWait, userAgent: "UA", today: "2026-10-24" });
  assert.equal(n, 1);
  assert.equal(out.blocked, 429);
  assert.deepEqual(out.skipped.map((v) => v.venue), ["B", "C"]);
  assert.deepEqual(out.failed.map((v) => v.venue), ["A"]);
});

test("geocodeAll: 403 も打ち切り。503 は打ち切らない", async () => {
  const run = async (status) => {
    let n = 0;
    const f = async () => { n++; return { ok: false, status, json: async () => [] }; };
    const out = await geocodeAll([item("A"), item("B")], { version: 1, venues: {} }, { fetchImpl: f, wait: noWait, userAgent: "UA", today: "d" });
    return { n, out };
  };
  assert.equal((await run(403)).out.blocked, 403);
  const r503 = await run(503);
  assert.equal(r503.out.blocked, null);
  assert.equal(r503.n, 4); // 2会場 × 2段
});

test("geocodeAll: 1回の問い合わせ会場数は maxVenues（既定30）まで。超過分は skipped", async () => {
  const items = Array.from({ length: 35 }, (_, i) => item(`会場${String(i).padStart(2, "0")}`));
  let n = 0;
  const f = async () => { n++; return { ok: true, status: 200, json: async () => [{ lat: "1", lon: "2", display_name: "東京都" }] }; };
  const out = await geocodeAll(items, { version: 1, venues: {} }, { fetchImpl: f, wait: noWait, userAgent: "UA", today: "d" });
  assert.equal(n, 30);
  assert.equal(out.added.length, 30);
  assert.equal(out.skipped.length, 5);
  const out2 = await geocodeAll(items, { version: 1, venues: {} }, { fetchImpl: f, wait: noWait, userAgent: "UA", today: "d", maxVenues: 2 });
  assert.equal(out2.added.length, 2);
});
