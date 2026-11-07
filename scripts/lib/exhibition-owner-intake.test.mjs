// 投稿(trustOrigin の intake)を「原則失敗させない」変更（docs/INTAKE_NO_FAIL.md）のテスト。
// 実行: node --test scripts/lib/exhibition-owner-intake.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { processCandidates, OWNER_MATCH_REASON } from "./exhibition-build.mjs";

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
  const r = await run([c], mkDeps({ "https://news.example/calm": "<html><body>calm</body></html>" }));
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
  const r = await run([c], mkDeps({ [tab]: "<html><body>x</body></html>", "https://news.example/a": "<html><body>y</body></html>" }));
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
  const tabY = "https://www.tokyoartbeat.com/events/-/Y/F2/2026-11-20";
  const deps = mkDeps({ ...jazzPages, [tabY]: "<html><body>tab</body></html>" }, {
    reinvestigate: async () => {
      n++;
      return { officialUrl: "https://jazz.example/ev/1", sources: [{ name: "TAB", url: tabY, kind: "listing" }] };
    },
  });
  const r = await run([cand()], deps);
  assert.equal(n, 1);
  assert.equal(r.added[0].verifiedVia, "owner-intake");
  assert.equal(r.added[0].link, "https://jazz.example/ev/1");
  assert.ok(r.added[0].sources.some((s) => s.url.includes("tokyoartbeat")));
});

// H3: 再調査の値は、実際に取得したページで確認できた項目だけ採用する
const datedPage = "<html><body><p>2027年1月10日〜2027年3月1日</p></body></html>";
test("再調査(H3): 取得したページで日付が確認できたときだけ採用され、会期未発表から追加される", async () => {
  const u = "https://venue.example/new";
  const deps = mkDeps({ [u]: datedPage }, { reinvestigate: async () => ({ startDate: "2027-01-10", endDate: "2027-03-01", officialUrl: u }) });
  const r = await run([cand({ startDate: "", endDate: "", officialUrl: "" })], deps);
  assert.equal(r.added.length, 1, JSON.stringify([r.pending, r.unverified, r.rejected]));
  assert.equal(r.added[0].startDate, "2027-01-10");
  assert.equal(r.pending.length, 0);
});

test("再調査(H3): ページ無し/ページに日付が無い再調査の日付は採用せず保留のまま", async () => {
  const u = "https://venue.example/new";
  for (const pages of [{}, { [u]: "<html><body>近日公開</body></html>" }]) {
    const deps = mkDeps(pages, { reinvestigate: async () => ({ startDate: "2027-01-10", endDate: "2027-03-01", officialUrl: u }) });
    const r = await run([cand({ startDate: "", endDate: "", officialUrl: "" })], deps);
    assert.equal(r.added.length, 0);
    assert.equal(r.pending.length, 1);
  }
});

test("再調査(H3): ページで確認できない題名・会場は採用せず元の投稿由来の値で owner-intake 追加", async () => {
  const deps = mkDeps(jazzPages, { reinvestigate: async () => ({ title: "幻の展覧会", venue: "幻の美術館", officialUrl: "https://jazz.example/ev/1" }) });
  const r = await run([cand()], deps);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].title, "Midnight Session");
  assert.equal(r.added[0].venue, "Tokyo Jazz Club");
  assert.equal(r.added[0].verifiedVia, "owner-intake");
});

test("再調査(H3): ページで確認できた会場は採用される", async () => {
  const u = "https://jazz.example/real2";
  const pages = { ...jazzPages, [u]: "<html><body><h1>Midnight Session</h1><p>Blue Note Tokyo</p><p>2026年11月20日〜21日</p></body></html>" };
  const deps = mkDeps(pages, { reinvestigate: async () => ({ venue: "Blue Note Tokyo", officialUrl: u }) });
  const r = await run([cand()], deps);
  assert.equal(r.added[0].venue, "Blue Note Tokyo");
  assert.equal(r.added[0].verifiedVia, undefined);
});

// H1: 投稿URLの social を必ず入れる（監査: intakeUrl と同じ URL の kind:"social"）
test("H1-A: 投稿URLが TAB ページで TAB 照合に失敗しても social が入り link は投稿URL", async () => {
  const tab = "https://www.tokyoartbeat.com/events/-/Z/F9/2026-11-20";
  const r = await run([cand({ officialUrl: "", intakeUrl: tab })], mkDeps({ [tab]: "<html><body>別の展示 2026年1月1日</body></html>" }));
  assert.equal(r.added.length, 1, JSON.stringify([r.unverified, r.rejected]));
  const it = r.added[0];
  assert.ok(it.sources.some((s) => s.kind === "social" && s.url === tab));
  assert.equal(it.sources.filter((s) => s.url === tab).length, 1);
  assert.equal(it.link, tab);
});

test("H1-B: 再調査の sources に投稿URLが listing で返っても social が残り listing は捨てる", async () => {
  const deps = mkDeps(jazzPages, { reinvestigate: async () => ({ sources: [{ name: "投稿", url: POST, kind: "listing" }] }) });
  const r = await run([cand({ officialUrl: "" })], deps);
  const it = r.added[0];
  assert.equal(it.sources.filter((s) => s.url === POST).length, 1);
  assert.equal(it.sources.find((s) => s.url === POST).kind, "social");
});

// H2: 同じ投稿から複数展示 → link が衝突しない
test("H2: 同じ投稿の2件目以降は固有URLを link にし、固有URLが無ければ追加せず unverified(link-collision)", async () => {
  const a = cand({ title: "Alpha Show", officialUrl: "", sources: [] });
  const b = cand({ title: "Beta Show", venue: "Other Hall", officialUrl: "https://hall.example/beta", sources: [] });
  const c = cand({ title: "Gamma Show", venue: "Third Hall", officialUrl: "", sources: [] });
  const r = await run([a, b, c], mkDeps({ "https://hall.example/beta": "<html><body>x</body></html>" }));
  const links = r.added.map((x) => x.link);
  assert.equal(new Set(links).size, links.length);
  assert.equal(r.added.length, 2);
  assert.equal(r.added.find((x) => x.title === "Beta Show").link, "https://hall.example/beta");
  assert.equal(r.unverified.length, 1);
  assert.match(r.unverified[0].reason, /link-collision/);
});

// M2/M4/M5
test("M2: 公式照合が通る通常経路では matchReason の既定値を入れない（空なら owner-intake 経路の定型）", async () => {
  const pages = { "https://jazz.example/ok": "<html><body><h1>Midnight Session</h1><p>Tokyo Jazz Club</p><p>2026年11月20日〜21日</p></body></html>" };
  const ok = await run([cand({ officialUrl: "https://jazz.example/ok", city: "" })], mkDeps(pages));
  assert.equal(ok.added[0].verifiedVia, undefined);
  assert.equal(ok.added[0].matchReason, "投稿された展示。");
  const noReason = await run([cand({ officialUrl: "https://jazz.example/ok", matchReason: "" })], mkDeps(pages));
  assert.equal(noReason.added[0].verifiedVia, "owner-intake");
  assert.equal(noReason.added[0].matchReason, OWNER_MATCH_REASON);
});

test("M4: 公式照合が通ればサムネが公式から取れなくても公式扱いのまま（他の取得元でサムネだけ試す）", async () => {
  const pages = { "https://jazz.example/ok": "<html><body><h1>Midnight Session</h1><p>Tokyo Jazz Club</p><p>2026年11月20日〜21日</p></body></html>" };
  const deps = mkDeps(pages);
  deps.saveThumb = async (id, c) => {
    deps.calls.thumbs.push(c.officialUrl);
    return c.officialUrl === POST ? `/thumbnails/exhibition/${id}.jpg` : null;
  };
  const r = await run([cand({ officialUrl: "https://jazz.example/ok" })], deps);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].verifiedVia, undefined);
  assert.equal(r.added[0].sources[0].kind, "official");
  assert.ok(deps.calls.thumbs.includes(POST));
});

test("M4: 照合が通ったがサムネがどこからも取れない → 保留(thumbnail-unavailable)。unverified/rejected にしない", async () => {
  const pages = { "https://jazz.example/ok": "<html><body><h1>Midnight Session</h1><p>Tokyo Jazz Club</p><p>2026年11月20日〜21日</p></body></html>" };
  const r = await run([cand({ officialUrl: "https://jazz.example/ok" })], mkDeps(pages, { saveThumb: async () => null }));
  assert.equal(r.added.length, 0);
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].pendingReason, "thumbnail-unavailable");
  assert.equal(r.unverified.length + r.rejected.length, 0);
});

test("M5: 取得して 200 でなかった公式URL・記事URLは link にも sources にも使わない", async () => {
  const c = cand({ officialUrl: "https://dead.example/ev", sources: [{ name: "記事", url: "https://dead.example/news", kind: "news" }] });
  const r = await run([c], mkDeps({}));
  assert.equal(r.added[0].link, POST);
  assert.deepEqual(r.added[0].sources.map((s) => s.url), [POST]);
});

// M6: 予算超過は握りつぶさない
test("M6: reinvestigate が BudgetExceededError を投げたら processCandidates ごと中断する", async () => {
  const err = new Error("budget");
  err.name = "BudgetExceededError";
  const deps = mkDeps(jazzPages, { reinvestigate: async () => { throw err; } });
  await assert.rejects(() => run([cand()], deps), /budget/);
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

test("サムネが全く取れないときは追加せず保留（pendingReason: thumbnail-unavailable）。unverified/rejected にしない", async () => {
  const deps = mkDeps(jazzPages, { saveThumb: async () => null });
  const r = await run([cand()], deps);
  assert.equal(r.added.length, 0);
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].pendingReason, "thumbnail-unavailable");
  assert.equal(r.unverified.length + r.rejected.length, 0);
});

test("サムネは link → 他ソース → 投稿の順に試す", async () => {
  const deps = mkDeps(jazzPages);
  let first = true;
  deps.saveThumb = async (id, c) => {
    deps.calls.thumbs.push(c.officialUrl);
    if (first) { first = false; return null; }
    return `/thumbnails/exhibition/${id}.jpg`;
  };
  deps.fetchHtml = async (url) => (url in jazzPages || url === "https://news.example/a" ? { status: 200, body: jazzPages[url] ?? "<html><body>n</body></html>" } : { status: 404, body: "" });
  const r = await run([cand({ sources: [{ name: "記事", url: "https://news.example/a", kind: "news" }] })], deps);
  assert.equal(r.added.length, 1);
  assert.deepEqual(deps.calls.thumbs.slice(0, 2), ["https://jazz.example/ev/1", "https://news.example/a"]);
});

test("都道府県が特定できない候補は推測せず unverified（rejected ではない）", async () => {
  const r = await run([cand({ prefecture: "" })], mkDeps(jazzPages));
  assert.equal(r.added.length, 0);
  assert.equal(r.unverified.length, 1);
  assert.equal(r.rejected.length, 0);
  assert.match(r.unverified[0].reason, /invalid-prefecture/);
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
