// Exhibition タブの UI スモーク（scripts/smoke-favorites-ui.mjs 流儀・Playwright）。
// 確認: ended が出ない／並び順／バッジ文言／フィルタ(都道府県・タグ・状態・URLクエリ)／お気に入り・ごみ箱／
//       詳細ページ(終了展も200「終了」)／投稿ボックス(パスフレーズ・成功/重複/400/401/429/503)／TopTabs。
// data/exhibition.json を「一時的に」フィクスチャへ差し替え、finally で必ず元に戻す（SIGINT 時も）。
// 前提: `npm run dev`（PORT=3111）が起動済み。実行: npx tsx scripts/smoke-exhibition-ui.mjs
// 環境変数 EXHIBITION_SHOT_DIR を指定するとスクリーンショットを保存する。
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { todayJst } from "./lib/exhibition-status.mjs";

const BASE_URL = process.env.EXHIBITION_UI_SMOKE_URL || "http://localhost:3111";
const SHOT_DIR = process.env.EXHIBITION_SHOT_DIR || "";
const DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "exhibition.json");

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const today = todayJst();
const addDays = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function fx(id, o) {
  return {
    id,
    slug: id,
    title: o.title,
    artists: o.artists ?? ["テスト作家"],
    venue: o.venue ?? "テスト会場",
    venueType: "museum",
    prefecture: o.prefecture ?? "東京都",
    city: o.city ?? "千代田区",
    startDate: o.start,
    endDate: o.end,
    status: o.start > today ? "upcoming" : o.end < today ? "ended" : "ongoing", // 保存値は信用されない
    admission: o.admission ?? "無料",
    tags: o.tags ?? ["media_art"],
    score: o.highlight ? 85 : 72,
    matchReason: "スモークテスト用のフィクスチャ。",
    sources: [{ name: "公式", url: "https://example.com/official", kind: "official" }],
    link: "https://example.com/official",
    thumbnail: "/thumbnails/0-mappa-2021.jpg",
    addedAt: `${today}T00:00:00.000Z`,
    origin: "auto",
    highlight: Boolean(o.highlight),
  };
}

// 期待する表示順（ongoing: endDate 昇順・同日は highlight 先頭 → upcoming: startDate 昇順）
const FIXTURE = [
  fx("2026-test-ended", { title: "終了した展", start: addDays(-30), end: addDays(-1) }),
  fx("2026-test-ongoing-far", { title: "開催中・遠い終了", start: addDays(-5), end: addDays(30), prefecture: "大阪府", tags: ["light"] }),
  fx("2026-test-ongoing-far-hl", { title: "開催中・遠い終了(ハイライト)", start: addDays(-5), end: addDays(30), highlight: true, prefecture: "大阪府", tags: ["light", "media_art"] }),
  fx("2026-test-upcoming-far", { title: "開催前・遠い", start: addDays(20), end: addDays(60), prefecture: "京都府", tags: ["generative"] }),
  fx("2026-test-today", { title: "開催中・本日まで", start: addDays(-10), end: addDays(0) }),
  fx("2026-test-upcoming-near", { title: "開催前・近い", start: addDays(3), end: addDays(40) }),
  fx("2026-test-two-days", { title: "開催中・残り2日", start: addDays(-10), end: addDays(2) }),
];
const EXPECTED_ORDER = [
  "2026-test-today",
  "2026-test-two-days",
  "2026-test-ongoing-far-hl",
  "2026-test-ongoing-far",
  "2026-test-upcoming-near",
  "2026-test-upcoming-far",
];

const original = fs.readFileSync(DATA_PATH, "utf8");
function restore() {
  fs.writeFileSync(DATA_PATH, original);
}
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
}
const cardIds = (page) =>
  page.$$eval("[data-exhibition-id]", (els) => els.map((e) => e.getAttribute("data-exhibition-id")));
const shot = async (page, name) => {
  if (SHOT_DIR) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true });
  }
};

async function waitForFixtureServed() {
  // dev サーバの再コンパイルを待つ（フィクスチャ先頭の ongoing が一覧に出るまでポーリング）
  for (let i = 0; i < 60; i++) {
    try {
      const html = await (await fetch(`${BASE_URL}/exhibition`)).text();
      if (html.includes("2026-test-today")) return;
    } catch {
      // 再コンパイル中
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("fixture not served by dev server");
}

async function main() {
  fs.writeFileSync(DATA_PATH, JSON.stringify({ version: 1, statusAsOf: today, items: FIXTURE }, null, 2));
  await waitForFixtureServed();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    // --- 一覧: ended 非表示・並び順 ---
    // SSR HTML の時点で ended が含まれないこと
    const ssrHtml = await (await fetch(`${BASE_URL}/exhibition`)).text();
    assert(!ssrHtml.includes("2026-test-ended"), "SSR HTML に終了済みの展覧会が含まれない");

    await page.goto(`${BASE_URL}/exhibition`);
    await settle(page);
    const ids = await cardIds(page);
    assert(!ids.includes("2026-test-ended"), "終了済みは一覧に出ない");
    assert(JSON.stringify(ids) === JSON.stringify(EXPECTED_ORDER), `並び順 (got ${ids.join(",")})`);

    // --- バッジ ---
    const badge = (id) => page.locator(`[data-exhibition-id="${id}"] [data-exhibition-badge]`).first();
    assert((await badge("2026-test-today").innerText()) === "本日まで", "当日は「本日まで」");
    assert((await badge("2026-test-two-days").innerText()) === "残り2日", "残り2日");
    assert((await badge("2026-test-two-days").getAttribute("data-exhibition-badge")) === "urgent", "残り7日以内は強調");
    assert((await badge("2026-test-ongoing-far").innerText()) === "残り30日", "残り30日");
    assert((await badge("2026-test-ongoing-far").getAttribute("data-exhibition-badge")) === "normal", "残り8日以上は強調しない");
    assert((await badge("2026-test-upcoming-near").innerText()) === "3日後に開始", "開催前は「N日後に開始」");
    await shot(page, "exhibition-list.png");

    // --- フィルタ（都道府県・タグ・状態）とURLクエリ ---
    await page.getByRole("button", { name: "大阪府", exact: true }).click();
    assert(JSON.stringify(await cardIds(page)) === JSON.stringify(["2026-test-ongoing-far-hl", "2026-test-ongoing-far"]), "都道府県フィルタ");
    assert(page.url().includes("pref="), "都道府県がURLクエリに反映");
    await page.reload();
    await settle(page);
    assert((await cardIds(page)).length === 2, "リロード後もURLクエリからフィルタ復元");
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("button", { name: "#generative" }).click();
    assert(JSON.stringify(await cardIds(page)) === JSON.stringify(["2026-test-upcoming-far"]), "タグフィルタ");
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("button", { name: "開催前", exact: true }).click();
    assert(JSON.stringify(await cardIds(page)) === JSON.stringify(["2026-test-upcoming-near", "2026-test-upcoming-far"]), "状態=開催前");
    await page.getByRole("button", { name: "開催中", exact: true }).click();
    assert((await cardIds(page)).length === 4, "状態=開催中");
    await page.getByRole("button", { name: "すべて", exact: true }).click();
    assert((await cardIds(page)).length === 6, "状態=すべて");
    await page.getByRole("button", { name: "京都府", exact: true }).click();
    await page.getByRole("button", { name: "開催中", exact: true }).click();
    assert((await page.locator("[data-exhibition-empty]").count()) === 1, "該当なしの空状態文言");
    await page.getByRole("button", { name: "Clear all" }).click();

    // --- お気に入り・ごみ箱（id=slug） ---
    await page.evaluate(() => {
      localStorage.removeItem("creative-edge-favorites");
      localStorage.removeItem("researchman-trash");
    });
    await page.reload();
    await settle(page);
    const card = page.locator('[data-exhibition-id="2026-test-two-days"]');
    await card.hover();
    await card.getByRole("button", { name: "お気に入りに追加" }).click();
    await page.waitForTimeout(200);
    const favRaw = await page.evaluate(() => localStorage.getItem("creative-edge-favorites"));
    assert(favRaw && favRaw.includes("2026-test-two-days"), "★でお気に入りに入る（localStorage）");
    await page.getByRole("button", { name: /^Saved/ }).click();
    assert(JSON.stringify(await cardIds(page)) === JSON.stringify(["2026-test-two-days"]), "Savedビュー");
    await page.getByRole("button", { name: /^Saved/ }).click();
    await page.locator('[data-exhibition-id="2026-test-today"]').hover();
    await page.locator('[data-exhibition-id="2026-test-today"]').getByRole("button", { name: "ごみ箱に入れる" }).click();
    await page.waitForTimeout(200);
    assert(!(await cardIds(page)).includes("2026-test-today"), "ごみ箱に入れたカードは一覧から消える");
    await page.getByRole("button", { name: /^Trash/ }).click();
    assert(JSON.stringify(await cardIds(page)) === JSON.stringify(["2026-test-today"]), "Trashビューで復元可能な状態");
    await page.locator('[data-exhibition-id="2026-test-today"]').getByRole("button", { name: "復元" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /^Trash/ }).click();
    assert((await cardIds(page)).includes("2026-test-today"), "復元で一覧に戻る");
    await page.evaluate(() => {
      localStorage.removeItem("creative-edge-favorites");
      localStorage.removeItem("researchman-trash");
    });

    // --- TopTabs ---
    const tab = page.getByRole("navigation", { name: "アーカイブ切替" }).getByRole("link", { name: "Exhibition" });
    assert((await tab.getAttribute("aria-current")) === "page", "Exhibitionタブがactive");

    // --- 投稿ボックス ---
    await page.reload();
    await settle(page);
    const urlInput = page.getByLabel(/投稿URL/);
    const msg = page.locator("[data-intake-message]");
    const submit = page.locator("form button[type=submit]"); // 送信中はラベルが変わるため name で引かない
    assert((await page.locator('input[name="website"]').count()) === 1, "honeypot欄が存在");
    assert(await page.locator('input[name="website"]').evaluate((el) => el.closest("[aria-hidden]") !== null), "honeypotは aria-hidden 配下");
    assert((await page.locator("#exhibition-intake-token").count()) === 0, "初期はパスフレーズ欄なし");

    let nextResponse = { status: 200, body: { status: "accepted" } };
    const requests = [];
    await page.route("**/api/exhibition-intake", async (route) => {
      requests.push({ headers: route.request().headers(), body: route.request().postData() });
      await route.fulfill({ status: nextResponse.status, contentType: "application/json", body: JSON.stringify(nextResponse.body) });
    });

    await urlInput.fill(" https://x.com/a/status/1　 ");
    assert((await urlInput.inputValue()) === "https://x.com/a/status/1", "全角/半角空白が除去される");
    await submit.click();
    assert((await page.locator("#exhibition-intake-token").count()) === 1, "初回送信でパスフレーズ欄が出る");
    assert(requests.length === 0, "パスフレーズ未入力ではAPIを呼ばない");

    await page.locator("#exhibition-intake-token").fill("secret-pass");
    await submit.click();
    await page.waitForFunction(() => document.querySelector("[data-intake-message]")?.textContent?.includes("受け付けました"));
    assert(requests.length === 1 && requests[0].headers["x-intake-token"] === "secret-pass", "x-intake-token ヘッダで送信");
    assert(JSON.parse(requests[0].body).url === "https://x.com/a/status/1", "bodyのurlは空白除去済み");
    assert((await msg.innerText()).includes("明日の更新で反映されます"), "成功メッセージ");
    assert((await page.evaluate(() => localStorage.getItem("researchman-exhibition-intake-token"))) === "secret-pass", "パスフレーズがlocalStorageに保持");
    assert((await page.locator("#exhibition-intake-token").count()) === 0, "受理後はパスフレーズ欄が消える");

    // 保存済みトークンで次回は即送信
    await urlInput.fill("https://x.com/a/status/2");
    nextResponse = { status: 200, body: { status: "duplicate" } };
    await submit.click();
    await page.waitForFunction(() => document.querySelector("[data-intake-message]")?.textContent?.includes("すでに受付済み"));
    assert(requests.length === 2 && requests[1].headers["x-intake-token"] === "secret-pass", "保存済みトークンで再送");

    nextResponse = { status: 200, body: { status: "already_processed" } };
    await submit.click();
    await page.waitForFunction(() => document.querySelector("[data-intake-message]")?.textContent?.includes("処理済み"));
    assert(true, "already_processed の文言");

    for (const [status, text] of [[400, "X/Instagramの投稿URLのみ"], [429, "受付上限"], [503, "現在受付できません"]]) {
      nextResponse = { status, body: { error: "x" } };
      await submit.click();
      await page.waitForFunction((t) => document.querySelector("[data-intake-message]")?.textContent?.includes(t), text);
      assert(true, `${status} の文言「${text}」`);
    }

    nextResponse = { status: 401, body: { error: "unauthorized" } };
    await submit.click();
    await page.waitForFunction(() => document.querySelector("[data-intake-message]")?.textContent?.includes("パスフレーズが違います"));
    assert((await page.evaluate(() => localStorage.getItem("researchman-exhibition-intake-token"))) === null, "401で保存トークンを消す");
    assert((await page.locator("#exhibition-intake-token").count()) === 1, "401でパスフレーズ欄を再表示");
    await shot(page, "exhibition-intake-401.png");

    // 送信中は無効化
    await page.unroute("**/api/exhibition-intake");
    await page.route("**/api/exhibition-intake", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
    });
    await page.locator("#exhibition-intake-token").fill("secret-pass");
    await submit.click();
    assert(await submit.isDisabled(), "送信中はボタンが無効");
    await page.waitForFunction(() => document.querySelector("[data-intake-message]")?.textContent?.includes("受け付けました"));
    await page.evaluate(() => localStorage.removeItem("researchman-exhibition-intake-token"));

    // --- 詳細ページ ---
    await page.goto(`${BASE_URL}/exhibition/2026-test-two-days`);
    await settle(page);
    assert((await page.locator("h1").innerText()) === "開催中・残り2日", "詳細: タイトル");
    assert((await page.locator('[data-exhibition-badge]').first().innerText()) === "残り2日", "詳細: バッジ");
    assert((await page.getByRole("link", { name: /公式ページを開く/ }).getAttribute("href")) === "https://example.com/official", "詳細: 公式リンク");
    await shot(page, "exhibition-detail.png");
    const endedRes = await page.goto(`${BASE_URL}/exhibition/2026-test-ended`);
    assert(endedRes.status() === 200, "終了済みの詳細も200");
    assert((await page.locator('[data-exhibition-badge]').first().innerText()) === "終了", "終了済み詳細は「終了」表示");
    const missing = await page.goto(`${BASE_URL}/exhibition/no-such-slug`);
    assert(missing.status() === 404, "存在しないslugは404");

    // --- 他タブ ---
    await page.goto(`${BASE_URL}/technology`);
    await settle(page);
    assert((await page.getByRole("navigation", { name: "アーカイブ切替" }).getByRole("link").count()) === 4, "TopTabsは4タブ（/technology）");
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "technology.png") }); // 先頭1画面のみ（全体は縦長すぎる）
  } finally {
    await browser.close();
    restore();
  }

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  }
  console.log("\n全テストPASS: exhibition UI");
}

main().catch((err) => {
  restore();
  console.error("smoke-exhibition-ui failed to run:", err);
  process.exit(1);
});
