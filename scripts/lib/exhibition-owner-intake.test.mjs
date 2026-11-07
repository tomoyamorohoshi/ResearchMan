// 投稿(trustOrigin の intake)を「原則失敗させない」変更（docs/INTAKE_NO_FAIL.md）のテスト。
// 実行: node --test scripts/lib/exhibition-owner-intake.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { processCandidates } from "./exhibition-build.mjs";

const TODAY = "2026-11-07";
const POST = "https://x.com/owner/status/111";
const emptyData = () => ({ version: 1, statusAsOf: TODAY, items: [] });

function cand(over = {}) {
  return {
    title: "Midnight Session",
    artists: [],
    venue: "Tokyo Jazz Club",
    venueType: "other",
    prefecture: "東京都",
    city: "港区",
    startDate: "2026-11-20",
    endDate: "2026-11-21",
    admission: "UNKNOWN",
    tags: [],
    score: 60,
    matchReason: "投稿された展示。",
    officialUrl: "https://jazz.example/ev/1",
    sources: [],
    excludeCategory: "none",
    origin: "intake",
    intakeUrl: POST,
    ...over,
  };
}

function mkDeps(pages = {}, over = {}) {
  const calls = { reinvestigate: [], thumbs: [] };
  return {
    calls,
    fetchHtml: async (url) => (url in pages ? { status: 200, body: pages[url] } : { status: 404, body: "" }),
    saveThumb: async (id, c) => {
      calls.thumbs.push(c.officialUrl);
      return `/thumbnails/exhibition/${id}.jpg`;
    },
    now: () => "2026-11-07T01:00:00.000Z",
    ...over,
  };
}

const OWNER = { trustOrigin: true, ownerIntake: true };
const run = (cands, deps, opts = OWNER, data = emptyData()) =>
  processCandidates({ data, candidates: cands, today: TODAY, deps, opts });

// ① 公式ページに会場名がない（official-venue-mismatch）→ 投稿者確認で追加
const jazzPages = { "https://jazz.example/ev/1": "<html><body><h1>Midnight Session</h1><p>2026年11月20日〜21日</p></body></html>" };

test("①会場不一致: owner-intake で追加（verifiedVia・sources に投稿URL・link は公式URL）", async () => {
  const r = await run([cand()], mkDeps(jazzPages));
  assert.equal(r.added.length, 1, JSON.stringify(r.unverified));
  const it = r.added[0];
  assert.equal(it.verifiedVia, "owner-intake");
  assert.equal(it.origin, "intake");
  assert.equal(it.intakeUrl, POST);
  assert.equal(it.link, "https://jazz.example/ev/1");
  assert.ok(it.sources.some((s) => s.kind === "social" && s.url === POST));
  assert.ok(it.sources.every((s) => s.kind !== "official"));
  assert.equal(it.status, "upcoming");
  assert.equal(r.unverified.length + r.rejected.length, 0);
});

test("①auto 経路（trustOrigin なし）は従来どおり unverified・reinvestigate も呼ばない", async () => {
  const deps = mkDeps(jazzPages, { reinvestigate: async () => { throw new Error("must not be called"); } });
  const r = await run([cand()], deps, { trustOrigin: false, ownerIntake: true });
  assert.equal(r.added.length, 0);
  assert.equal(r.unverified.length, 1);
  assert.match(r.unverified[0].reason, /official-venue-mismatch/);
});

test("①trustOrigin だけで ownerIntake なしは従来どおり unverified", async () => {
  const r = await run([cand()], mkDeps(jazzPages), { trustOrigin: true });
  assert.equal(r.added.length, 0);
  assert.match(r.unverified[0].reason, /official-venue-mismatch/);
});

// ② 終了展
const takeoPages = { "https://takeo.example/50": "<html><body><h1>TAKEO PAPER SHOW 50</h1><p>ギャラリー竹尾</p><p>2026年10月17日〜10月25日</p></body></html>" };
const takeo = (over = {}) => cand({ title: "TAKEO PAPER SHOW 50", venue: "ギャラリー竹尾", startDate: "2026-10-17", endDate: "2026-10-25", officialUrl: "https://takeo.example/50", ...over });

test("②終了展: 公式照合が通れば status ended・verifiedVia なしで追加", async () => {
  const r = await run([takeo()], mkDeps(takeoPages));
  assert.equal(r.added.length, 1, JSON.stringify([r.unverified, r.rejected]));
  assert.equal(r.added[0].status, "ended");
  assert.equal(r.added[0].verifiedVia, undefined);
  assert.equal(r.added[0].sources[0].kind, "official");
});

test("②終了展: 公式が取れなくても owner-intake で ended 追加", async () => {
  const r = await run([takeo()], mkDeps({}));
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].status, "ended");
  assert.equal(r.added[0].verifiedVia, "owner-intake");
});

test("②終了展: auto（trustOrigin なし）は従来どおり already-ended で reject", async () => {
  const r = await run([takeo()], mkDeps(takeoPages), { trustOrigin: false, ownerIntake: true });
  assert.equal(r.added.length, 0);
  assert.equal(r.rejected[0].reason, "already-ended");
});

// ③ 1日イベント（分類外から救済）: 公式なし・記事のみ
test("③1日イベント: start=end・公式なし・記事ソースのみでも追加（link は記事 > 投稿）", async () => {
  const c = cand({
    title: "calm", venue: "KATA", startDate: "2026-11-08", endDate: "2026-11-08",
    officialUrl: "", sources: [{ name: "記事", url: "https://news.example/calm", kind: "news" }],
  });
  const r = await run([c], mkDeps({}));
  assert.equal(r.added.length, 1, JSON.stringify([r.unverified, r.rejected]));
  const it = r.added[0];
  assert.equal(it.verifiedVia, "owner-intake");
  assert.equal(it.link, "https://news.example/calm");
  assert.equal(it.status, "upcoming");
  assert.deepEqual(it.sources.map((s) => s.kind), ["news", "social"]);
});

test("③公式も記事もない場合は link が投稿URL", async () => {
  const r = await run([cand({ officialUrl: "", sources: [] })], mkDeps({}));
  assert.equal(r.added[0].link, POST);
  assert.equal(r.added[0].sources.length, 1);
});

test("③TAB URL があれば link は TAB（記事より優先）", async () => {
  const tab = "https://www.tokyoartbeat.com/events/-/X/F1/2026-11-20";
  const c = cand({ officialUrl: "", sources: [{ name: "記事", url: "https://news.example/a", kind: "news" }, { name: "TAB", url: tab, kind: "listing" }] });
  const r = await run([c], mkDeps({}));
  assert.equal(r.added[0].link, tab);
});

// ④ 会期未発表 → 保留
test("④会期未発表: added にも unverified にも入れず pending に積む", async () => {
  const c = cand({ title: "ジェームズ・タレル展", venue: "スーパーブルー京都", prefecture: "京都府", city: "京都市", startDate: "", endDate: "", officialUrl: "" });
  const r = await run([c], mkDeps({}));
  assert.equal(r.added.length, 0);
  assert.equal(r.unverified.length, 0);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].title, "ジェームズ・タレル展");
  assert.equal(r.pending[0].intakeUrl, POST);
  assert.equal(r.pending[0].origin, "intake");
});

test("④片方だけ日付がある場合も追加せず pending（推測で埋めない）", async () => {
  const r = await run([cand({ endDate: "", officialUrl: "" })], mkDeps({}));
  assert.equal(r.added.length, 0);
  assert.equal(r.pending.length, 1);
});

test("④auto 経路は会期不明のまま unverified（pending に積まない）", async () => {
  const r = await run([cand({ startDate: "", endDate: "" })], mkDeps({}), { trustOrigin: false, ownerIntake: true });
  assert.equal(r.pending.length, 0);
  assert.equal(r.unverified.length, 1);
});

// 再調査
test("再調査: 失敗時に1回だけ呼ばれ、得た公式URLで照合が通れば公式として追加", async () => {
  const pages = { ...jazzPages, "https://jazz.example/real": "<html><body><h1>Midnight Session</h1><p>Tokyo Jazz Club</p><p>2026年11月20日〜21日</p></body></html>" };
  let n = 0;
  const deps = mkDeps(pages, {
    reinvestigate: async (c, reason) => {
      n++;
      assert.match(reason, /official-venue-mismatch/);
      return { officialUrl: "https://jazz.example/real" };
    },
  });
  const r = await run([cand()], deps);
  assert.equal(n, 1);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].verifiedVia, undefined);
  assert.equal(r.added[0].link, "https://jazz.example/real");
  assert.equal(r.added[0].sources[0].kind, "official");
});

test("再調査: それでも失敗なら再調査は1回だけで owner-intake 追加（得た情報源を sources に反映）", async () => {
  let n = 0;
  const deps = mkDeps(jazzPages, {
    reinvestigate: async () => {
      n++;
      return { officialUrl: "https://jazz.example/ev/1", sources: [{ name: "TAB", url: "https://www.tokyoartbeat.com/events/-/Y/F2/2026-11-20", kind: "listing" }] };
    },
  });
  const r = await run([cand()], deps);
  assert.equal(n, 1);
  assert.equal(r.added[0].verifiedVia, "owner-intake");
  assert.equal(r.added[0].link, "https://jazz.example/ev/1");
  assert.ok(r.added[0].sources.some((s) => s.url.includes("tokyoartbeat")));
});

test("再調査: 会期未発表の候補に日付が見つかれば追加される", async () => {
  const deps = mkDeps({}, { reinvestigate: async () => ({ startDate: "2027-01-10", endDate: "2027-03-01", officialUrl: "" }) });
  const r = await run([cand({ startDate: "", endDate: "", officialUrl: "" })], deps);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].startDate, "2027-01-10");
  assert.equal(r.pending.length, 0);
});

test("再調査: 不正な日付(YYYY-MM-DD でない)は採用せず元の候補のまま pending", async () => {
  const deps = mkDeps({}, { reinvestigate: async () => ({ startDate: "来年初頭", endDate: "未定" }) });
  const r = await run([cand({ startDate: "", endDate: "", officialUrl: "" })], deps);
  assert.equal(r.added.length, 0);
  assert.equal(r.pending.length, 1);
});

test("再調査: reinvestigate が例外/null でも落ちず owner-intake 追加へ進む", async () => {
  for (const f of [async () => { throw new Error("cli down"); }, async () => null]) {
    const r = await run([cand()], mkDeps(jazzPages, { reinvestigate: f }));
    assert.equal(r.added.length, 1);
    assert.equal(r.added[0].verifiedVia, "owner-intake");
  }
});

// その他
test("重複: 既存展示と同じ候補は owner-intake でも二重追加しない", async () => {
  const first = await run([cand()], mkDeps(jazzPages));
  const second = await run([cand()], mkDeps(jazzPages), OWNER, first.data);
  assert.equal(second.added.length, 0);
  assert.equal(second.skipped.length, 1);
});

test("サムネが全く取れないときは追加せず unverified（thumbnail-unavailable）", async () => {
  const deps = mkDeps(jazzPages, { saveThumb: async () => null });
  const r = await run([cand()], deps);
  assert.equal(r.added.length, 0);
  assert.equal(r.rejected.concat(r.unverified).some((x) => /thumbnail-unavailable/.test(x.reason)), true);
});

test("サムネは link → 他ソース → 投稿の順に試す", async () => {
  const deps = mkDeps(jazzPages);
  let first = true;
  deps.saveThumb = async (id, c) => {
    deps.calls.thumbs.push(c.officialUrl);
    if (first) { first = false; return null; }
    return `/thumbnails/exhibition/${id}.jpg`;
  };
  const r = await run([cand({ sources: [{ name: "記事", url: "https://news.example/a", kind: "news" }] })], deps);
  assert.equal(r.added.length, 1);
  assert.deepEqual(deps.calls.thumbs.slice(0, 2), ["https://jazz.example/ev/1", "https://news.example/a"]);
});

test("都道府県が特定できない候補は推測せず unverified", async () => {
  const r = await run([cand({ prefecture: "" })], mkDeps(jazzPages));
  assert.equal(r.added.length, 0);
  assert.equal(r.unverified.length + r.rejected.length, 1);
});

// runIntake 経由（Web/日次ジョブの投稿処理）
test("runIntake: 会期未発表は pending に返し PATCH は unverified(pending-dates)、ownerIntake の追加は added", async () => {
  const { runIntake } = await import("./exhibition-intake-job.mjs");
  const u1 = "https://x.com/o/status/101";
  const u2 = "https://x.com/o/status/102";
  const patched = [];
  const deps = mkDeps(jazzPages, {
    fetchJson: async () => ({ tweet: { text: "投稿本文", author: { name: "o", screen_name: "o" } } }),
    extract: async () => [
      cand({ intakeUrl: u1, startDate: "", endDate: "", officialUrl: "" }),
      cand({ title: "別の展示", intakeUrl: u2 }),
    ],
    patch: async (r) => { patched.push(...r); },
  });
  const out = await runIntake({ items: [{ url: u1 }, { url: u2 }], data: emptyData(), today: TODAY, deps, opts: { ownerIntake: true } });
  assert.equal(out.pending.length, 1);
  assert.equal(out.added.length, 1);
  assert.equal(patched.find((r) => r.url === u1).status, "unverified");
  assert.match(patched.find((r) => r.url === u1).reason, /pending-dates/);
  assert.equal(patched.find((r) => r.url === u2).status, "added");
});

test("city/matchReason が空でも投稿者確認では追加できる（city は都道府県、理由は定型）", async () => {
  const r = await run([cand({ city: "", matchReason: "" })], mkDeps(jazzPages));
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].city, "東京都");
  assert.ok(r.added[0].matchReason.length > 0);
});
