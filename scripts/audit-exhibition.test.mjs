// scripts/audit-exhibition.mjs のフィクスチャ駆動テスト（SPEC §7 / §11）。
// 各 FAIL ケースが FAIL（exit 1 かつ ✗ 行）すること、正常データで exit 0 になることを確認する。
// 実行: node --test scripts/audit-exhibition.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT = path.join(__dirname, "audit-exhibition.mjs");
const VOCAB = ["media_art", "generative", "onchain", "installation", "light", "kinetic", "glass", "sculpture", "video_art", "design_archive", "graphic_design", "architecture", "ai_media_art", "retrospective", "sound"];
let tmpRoot;
let seq = 0;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "audit-exh-"));
});
after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function goodItem(over = {}) {
  const id = over.id ?? "2026-maruka-3f-auto-destructive-art";
  return {
    id,
    slug: id,
    title: "Auto-Destructive Art",
    artists: ["exonemo"],
    venue: "Maruka 3F",
    venueType: "alt_space",
    prefecture: "東京都",
    city: "中央区",
    startDate: "2026-10-02",
    endDate: "2026-10-18",
    status: "ongoing",
    admission: "無料",
    tags: ["media_art", "generative"],
    score: 82,
    matchReason: "NEORT++系のジェネラティブ展示。",
    sources: [{ name: "NEORT++", url: "https://two.neort.io/ja/exhibitions/auto_destructive_art", kind: "official" }],
    link: "https://two.neort.io/ja/exhibitions/auto_destructive_art",
    thumbnail: `/thumbnails/exhibition/${id}.jpg`,
    addedAt: "2026-10-04T01:00:00.000Z",
    origin: "auto",
    highlight: true,
    ...over,
  };
}

function runAudit(root) {
  const r = spawnSync(process.execPath, [AUDIT], {
    env: { ...process.env, EXHIBITION_AUDIT_ROOT: root, EXHIBITION_AUDIT_TODAY: "2026-10-04" },
    encoding: "utf8",
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), root };
}

/** フィクスチャ root を作り、audit を実行して {code, out, root} を返す */
function run({ items, statusAsOf = "2026-10-04", thumbs, cases = [], tech = [], raw, noProfile = false } = {}) {
  const root = path.join(tmpRoot, `r${seq++}`);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "public/thumbnails/exhibition"), { recursive: true });
  const list = items ?? [goodItem()];
  const data = raw ?? { version: 1, statusAsOf, items: list };
  fs.writeFileSync(path.join(root, "data/exhibition.json"), JSON.stringify(data));
  fs.writeFileSync(path.join(root, "data/exhibition-tag-vocabulary.json"), JSON.stringify({ Tag: VOCAB }));
  fs.writeFileSync(path.join(root, "data/cases.json"), JSON.stringify(cases));
  fs.writeFileSync(path.join(root, "data/tech.json"), JSON.stringify(tech));
  if (!noProfile) fs.writeFileSync(
    path.join(root, "data/exhibition-profile.json"),
    JSON.stringify({
      seeds: [
        { title: "BLACK AND BLUE", url: "https://bijutsutecho.com/x", role: "preference_only" },
        { title: "小松宏誠展 光と影のモビール", url: "https://artexhibition.jp/y", role: "preference_only" },
        { title: "Listing One", url: "https://example.com/l", role: "listing" },
      ],
    }),
  );
  // サムネ: 既定では全 item に十分なサイズの実体を作る（thumbs[name]===null なら欠損）
  const sizes = thumbs ?? {};
  for (const it of list) {
    const th = it?.thumbnail;
    if (typeof th !== "string" || !th.startsWith("/thumbnails/exhibition/")) continue;
    const name = th.replace("/thumbnails/exhibition/", "");
    const size = name in sizes ? sizes[name] : 8000;
    if (size === null) continue;
    fs.writeFileSync(path.join(root, "public", th), Buffer.alloc(size, 1));
  }
  return runAudit(root);
}

function assertFails(res, needle) {
  assert.equal(res.code, 1, `exit 1 のはず:\n${res.out}`);
  assert.match(res.out, /✗/);
  if (needle) assert.match(res.out, needle);
}

test("正常データ: exit 0", () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS/);
});

test("空 items: exit 0", () => {
  const r = run({ items: [] });
  assert.equal(r.code, 0, r.out);
});

test("ended を ongoing と誤記 → FAIL（statusAsOf 基準）", () => {
  const r = run({ items: [goodItem({ startDate: "2026-09-01", endDate: "2026-10-03", status: "ongoing" })] });
  assertFails(r, /STATUS/);
});

test("upcoming を ongoing と誤記 → FAIL", () => {
  const r = run({ items: [goodItem({ startDate: "2026-10-17", endDate: "2026-10-25", status: "ongoing" })] });
  assertFails(r, /STATUS/);
});

test("正しい ended（保存値 ended）は PASS（matchReason 空でも可）", () => {
  const r = run({ items: [goodItem({ startDate: "2026-09-01", endDate: "2026-10-03", status: "ended", matchReason: "" })] });
  assert.equal(r.code, 0, r.out);
});

test("statusAsOf が未来 → FAIL", () => {
  const r = run({ statusAsOf: "2026-10-05" });
  assertFails(r, /statusAsOf/);
});

test("statusAsOf が形式不正 → FAIL", () => {
  const r = run({ statusAsOf: "2026/10/04" });
  assertFails(r, /statusAsOf|ROOT/);
});

test("ルート形式不正（version!==1）→ FAIL", () => {
  const r = run({ raw: { version: 2, statusAsOf: "2026-10-04", items: [] } });
  assertFails(r, /ROOT/);
});

test("endDate < startDate → FAIL", () => {
  const r = run({ items: [goodItem({ startDate: "2026-10-18", endDate: "2026-10-02" })] });
  assertFails(r, /DATE/);
});

test("実在しない日付 → FAIL", () => {
  const r = run({ items: [goodItem({ startDate: "2026-02-30" })] });
  assertFails(r, /DATE/);
});

test("official 欠落 → FAIL", () => {
  const r = run({ items: [goodItem({ sources: [{ name: "x", url: "https://x.com/a/status/1", kind: "social" }] })] });
  assertFails(r, /OFFICIAL/);
});

test("link が sources の official と不一致 → FAIL", () => {
  const r = run({ items: [goodItem({ link: "https://other.example.com/" })] });
  assertFails(r, /LINK/);
});

test("sources の URL が http(s) でない → FAIL", () => {
  const r = run({
    items: [goodItem({ sources: [{ name: "o", url: "https://two.neort.io/ja/exhibitions/auto_destructive_art", kind: "official" }, { name: "b", url: "javascript:alert(1)", kind: "news" }] })],
  });
  assertFails(r, /URL/);
});

test("サムネ実体なし → FAIL", () => {
  const it = goodItem();
  const r = run({ items: [it], thumbs: { [`${it.id}.jpg`]: null } });
  assertFails(r, /THUMBNAIL/);
});

test("サムネ極小（<MIN_THUMB_BYTES）→ FAIL", () => {
  const it = goodItem();
  const r = run({ items: [it], thumbs: { [`${it.id}.jpg`]: 100 } });
  assertFails(r, /THUMBNAIL/);
});

test("サムネパスが /thumbnails/exhibition/ 配下でない → FAIL", () => {
  const r = run({ items: [goodItem({ thumbnail: "/thumbnails/foo.jpg" })] });
  assertFails(r, /THUMBNAIL/);
});

test("孤立サムネは WARN（exit 0）", () => {
  const r = run();
  fs.writeFileSync(path.join(r.root, "public/thumbnails/exhibition/orphan.jpg"), Buffer.alloc(8000, 1));
  const r2 = runAudit(r.root);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /WARN[\s\S]*orphan\.jpg/);
});

test("id 重複 → FAIL", () => {
  const a = goodItem();
  const b = goodItem({ link: "https://two.neort.io/ja/exhibitions/other", sources: [{ name: "o", url: "https://two.neort.io/ja/exhibitions/other", kind: "official" }] });
  const r = run({ items: [a, b] });
  assertFails(r, /DUPLICATE ID/);
});

test("link（normLink）重複 → FAIL", () => {
  const a = goodItem();
  const b = goodItem({ id: "2026-other-show", link: "https://two.neort.io/ja/exhibitions/auto_destructive_art/", sources: [{ name: "o", url: "https://two.neort.io/ja/exhibitions/auto_destructive_art/", kind: "official" }] });
  const r = run({ items: [a, b] });
  assertFails(r, /DUPLICATE LINK/);
});

test("id!==slug → FAIL", () => {
  const r = run({ items: [goodItem({ slug: "2026-different" })] });
  assertFails(r, /SLUG|ID/);
});

test("id が slug パターン違反 → FAIL", () => {
  const r = run({ items: [goodItem({ id: "Bad_ID", slug: "Bad_ID" })] });
  assertFails(r, /SLUG|ID/);
});

test("id が 100 字超 → FAIL", () => {
  const id = "a".repeat(101);
  const r = run({ items: [goodItem({ id, slug: id })] });
  assertFails(r, /SLUG|ID/);
});

test("語彙外タグ → FAIL", () => {
  const r = run({ items: [goodItem({ tags: ["media_art", "not_in_vocab"] })] });
  assertFails(r, /TAG/);
});

test("都道府県が47値外 → FAIL", () => {
  const r = run({ items: [goodItem({ prefecture: "東京" })] });
  assertFails(r, /PREFECTURE/);
});

test("score 範囲外/非整数 → FAIL", () => {
  assertFails(run({ items: [goodItem({ score: 101, highlight: true })] }), /SCORE/);
  assertFails(run({ items: [goodItem({ score: 70.5, highlight: false })] }), /SCORE/);
});

test("highlight が score>=80 と不一致 → FAIL", () => {
  assertFails(run({ items: [goodItem({ score: 82, highlight: false })] }), /HIGHLIGHT/);
  assertFails(run({ items: [goodItem({ score: 79, highlight: true })] }), /HIGHLIGHT/);
});

test("origin 不正 / intake で intakeUrl 欠落 → FAIL", () => {
  assertFails(run({ items: [goodItem({ origin: "manual" })] }), /ORIGIN/);
  assertFails(run({ items: [goodItem({ origin: "intake" })] }), /INTAKE/);
  const ok = run({ items: [goodItem({ origin: "intake", intakeUrl: "https://x.com/a/status/1" })] });
  assert.equal(ok.code, 0, ok.out);
});

test("必須フィールド欠落 → FAIL", () => {
  const it = goodItem();
  delete it.venue;
  assertFails(run({ items: [it] }), /MISSING FIELDS/);
});

test("ended 以外で matchReason 空 → FAIL", () => {
  assertFails(run({ items: [goodItem({ matchReason: "" })] }), /MATCHREASON|MISSING/);
});

test("ended 以外で title/venue に UNKNOWN → FAIL", () => {
  assertFails(run({ items: [goodItem({ title: "UNKNOWN" })] }), /UNKNOWN/);
  assertFails(run({ items: [goodItem({ venue: "UNKNOWN" })] }), /UNKNOWN/);
});

test("preference_only の混入（タイトル一致）→ FAIL", () => {
  const id = "2026-spiral-gallery-bb";
  const r = run({
    items: [goodItem({ id, slug: id, title: "BLACK AND BLUE", link: "https://example.com/bb", sources: [{ name: "o", url: "https://example.com/bb", kind: "official" }] })],
  });
  assertFails(r, /PREFERENCE/);
});

test("preference_only の混入（slug一致）→ FAIL", () => {
  const id = "2026-spiral-black-and-blue";
  const r = run({ items: [goodItem({ id, slug: id, title: "Something Else", link: "https://example.com/bb", sources: [{ name: "o", url: "https://example.com/bb", kind: "official" }] })] });
  assertFails(r, /PREFERENCE/);
});

test("cases.json の id と衝突 → FAIL", () => {
  const it = goodItem();
  assertFails(run({ items: [it], cases: [{ id: it.id }] }), /COLLISION/);
});

test("tech.json の id と衝突 → FAIL", () => {
  const it = goodItem();
  assertFails(run({ items: [it], tech: [{ id: it.id }] }), /COLLISION/);
});

test("WARN: statusAsOf が2日以上古い・admission UNKNOWN（exit 0）", () => {
  const r = run({ statusAsOf: "2026-10-01", items: [goodItem({ admission: "UNKNOWN", status: "upcoming" })] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN/);
  assert.match(r.out, /statusAsOf/);
  assert.match(r.out, /UNKNOWN|admission/);
});

test("実データ（リポジトリの data/exhibition.json）が exit 0", () => {
  const r = spawnSync(process.execPath, [AUDIT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("profile が無い → FAIL（preference_only 検査をスキップしない）", () => {
  assertFails(run({ noProfile: true }), /PROFILE/);
});

test("items に null / 非オブジェクト → クラッシュせず ✗ で FAIL", () => {
  for (const bad of [null, 5, "x", []]) {
    const r = run({ items: [goodItem(), bad] });
    assertFails(r, /INVALID ITEM/);
    assert.doesNotMatch(r.out, /TypeError|at .*\.mjs/);
  }
});

test("型不正 → FAIL", () => {
  const cases = [
    { artists: "exonemo" }, { artists: [1] }, { tags: "media_art" }, { tags: [1] },
    { title: 5 }, { venue: 5 }, { city: 5 }, { admission: 5 }, { matchReason: 5 }, { link: 5 },
    { prefecture: 5 }, { venueType: 5 }, { score: 82.5 }, { score: "82" },
    { addedAt: "not-a-date" }, { addedAt: 5 },
    { sources: "x" }, { sources: [{ name: 1, url: "https://a.example", kind: "official" }] },
  ];
  for (const c of cases) {
    assertFails(run({ items: [goodItem(c)] }), /TYPE/);
  }
});

test("thumbnail の ../ トラバーサル → FAIL", () => {
  const r = run({ items: [goodItem({ thumbnail: "/thumbnails/exhibition/../../secret.jpg" })] });
  assertFails(r, /THUMBNAIL PATH/);
});
