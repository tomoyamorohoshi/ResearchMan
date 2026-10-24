// 実行: node docs/screenshots/visit/calendar/shoot.mjs [baseUrl]  (dev サーバ起動済みであること)
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3101";
const out = path.dirname(fileURLToPath(import.meta.url));
const ids = [
  "2026-mori-art-museum-mariko-mori-sansan",
  "2026-bonded-gallery-hikaru-oto-ten",
  "2026-azabudai-hills-gallery-ambient-kyoto-tokyo-sakamoto-tak",
  "2026-ycam-joeiji-forest-symphony-yamaguchi-seasonal-2026",
  "2026-mot-mot-collection-light-now",
];
const store = JSON.stringify({ version: 1, items: Object.fromEntries(ids.map((id) => [id, { fav: true, ts: 1 }])) });

const browser = await chromium.launch({ channel: "msedge" });
async function shot(name, url, { mobile = true, seed = true, tap = null } = {}) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1280, height: 900 } },
  );
  if (seed) await ctx.addInitScript((v) => localStorage.setItem("researchman-want-to-go", v), store);
  const page = await ctx.newPage();
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForSelector("#visit-cal-h");
  if (tap) {
    await page.locator('button[aria-pressed]:has-text("")').first(); // noop
    await page.locator(`button[aria-label^="${tap}"]`).first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  const hs = await page.evaluate(() => [...document.querySelectorAll("#visit-cal-h ~ div button[aria-pressed], section[aria-labelledby=visit-cal-h] button[aria-pressed]")].map((b) => b.getBoundingClientRect().height));
  console.log(name, "cell min height", Math.min(...hs));
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  console.log(name, "scrollWidth", w[0], "clientWidth", w[1], w[0] === w[1] ? "OK" : "OVERFLOW");
  await ctx.close();
}
await shot("cal1-mobile.png", "/visit");
await shot("cal2-mobile.png", "/visit?cal=count");
await shot("cal3-mobile.png", "/visit?cal=bands");
await shot("cal1-desktop.png", "/visit", { mobile: false });
await shot("cal1-empty.png", "/visit", { seed: false });
await shot("cal2-tapped.png", "/visit?cal=count", { tap: process.env.TAP ?? "10月20日" });
await browser.close();
