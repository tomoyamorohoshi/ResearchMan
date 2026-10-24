// 使い方: PORT=3105 node docs/screenshots/exhibition-mobile/after/shoot.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const base = `http://localhost:${process.env.PORT ?? 3105}/exhibition`;
const browser = await chromium.launch({ channel: "msedge" });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const out = {};
async function shoot(ctx, query, file, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  if (opts.openFilter) { await page.getByRole("button", { name: /絞り込み/ }).click(); await page.waitForTimeout(300); }
  const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  out[file] = m;
  await page.screenshot({ path: path.join(dir, file), fullPage: !!opts.full });
  await page.close();
}
await shoot(mobile, "", "a-top.png");
await shoot(mobile, "", "a-full.png", { full: true });
await shoot(mobile, "?layout=compact", "b-top.png");
await shoot(mobile, "?layout=row", "c-top.png");
await shoot(mobile, "?layout=bogus", "a-fallback.png");
await shoot(mobile, "", "filter-open.png", { openFilter: true });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await shoot(desktop, "", "desktop.png");
console.log(JSON.stringify(out, null, 1));
await browser.close();
