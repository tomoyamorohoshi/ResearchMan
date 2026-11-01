import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCannesCategory as n, sameCannesCategory as same, formatCannesAward as fmt } from "./cannes-categories.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("表記ゆれは同一キーになる", () => {
  assert.ok(same("Film", "Film Lions"));
  assert.ok(same("Film", " film "));
  assert.ok(same("Entertainment for Music", "Entertainment Lions for Music"));
  assert.ok(same("Health & Wellness", "Health and Wellness"));
  assert.ok(same("Audio & Radio", "Audio and Radio"));
  assert.ok(same("Glass", "Glass: The Lion for Change"));
  assert.ok(same("Cannes Lions Outdoor", "Outdoor Lions"));
});

test("§5-4 区別必須の組は別キー", () => {
  const pairs = [
    ["Film", "Film Craft"],
    ["Design", "Product Design"],
    ["Entertainment", "Entertainment Lions for Music"],
    ["Entertainment", "Entertainment Lions for Sport"],
    ["Entertainment", "Entertainment Lions for Gaming"],
    ["Entertainment Lions for Music", "Entertainment Lions for Sport"],
    ["Grand Prix for Good", "Lions Health Grand Prix for Good"],
    ["Creative Commerce", "Creative eCommerce"],
  ];
  for (const [a, b] of pairs) assert.ok(!same(a, b), `${a} と ${b} は区別される`);
});

test("年をまたぐ名寄せはしない", () => {
  assert.ok(!same("Radio", "Audio & Radio"));
  assert.ok(!same("Radio & Audio", "Audio & Radio"));
  assert.ok(!same("Social & Influencer", "Social & Creator"));
  assert.ok(!same("Cyber", "Digital Craft"));
});

test("空文字は同一視しない", () => {
  assert.ok(!same("", ""));
  assert.equal(n(undefined), "");
});

test("web JSON 全年: 部門名が衝突しない（別名の部門が同じキーにならない）", () => {
  const dir = path.join(__dirname, "../../data/cannes/web");
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-web\.json$/.test(f));
  assert.ok(files.length >= 9);
  const global = new Map(); // key -> raw
  for (const f of files) {
    const raws = new Set(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).winners.map((w) => w.category));
    const inYear = new Map();
    for (const raw of raws) {
      const k = n(raw);
      assert.ok(k, `${f}: ${raw} が空キー`);
      assert.ok(!inYear.has(k), `${f}: ${raw} と ${inYear.get(k)} が同じキー`);
      inYear.set(k, raw);
      // 年をまたいでも、異なる生の名前が同じキーになるのは許容しない（表記ゆれは web JSON に無い前提）
      if (global.has(k)) assert.equal(global.get(k), raw);
      global.set(k, raw);
    }
  }
});

test("formatCannesAward", () => {
  assert.equal(fmt({ year: 2025, category: "Outdoor", level: "Grand Prix" }), "Cannes Lions 2025 Outdoor Lions Grand Prix");
  assert.equal(fmt({ year: 2023, category: "Entertainment Lions for Music", level: "Gold" }), "Cannes Lions 2023 Entertainment Lions for Music Gold");
  assert.equal(fmt({ year: 2025, category: "Glass: The Lion for Change", level: "Gold" }), "Cannes Lions 2025 Glass: The Lion for Change Gold");
  assert.equal(fmt({ year: 2025, category: "Titanium", level: "Titanium" }), "Cannes Lions 2025 Titanium");
  assert.equal(fmt({ year: 2016, category: "Titanium", level: "Grand Prix" }), "Cannes Lions 2016 Titanium Grand Prix");
  assert.equal(fmt({ year: 2023, category: "Grand Prix for Good", level: "Grand Prix" }), "Cannes Lions 2023 Grand Prix for Good");
  assert.equal(fmt({ year: 2018, category: "Lions Health Grand Prix for Good", level: "Grand Prix" }), "Cannes Lions 2018 Lions Health Grand Prix for Good");
  assert.equal(fmt({ year: 2016, category: "Product Design", level: "Product Design Lion" }), "Cannes Lions 2016 Product Design Lions");
  assert.equal(fmt({ year: 2024, category: "Audio & Radio", level: "Silver" }), "Cannes Lions 2024 Audio & Radio Lions Silver");
});

test("旧コレクション名(レベル語除去後の 'for Good')と公式名は同キー、Health とは別キー", () => {
  assert.ok(same("for Good", "Grand Prix for Good"));
  assert.ok(same("Health for Good", "Lions Health Grand Prix for Good"));
  assert.ok(same("Health for Good", "Health Grand Prix for Good"));
  assert.ok(!same("for Good", "Health for Good"));
  assert.ok(!same("Grand Prix for Good", "Lions Health Grand Prix for Good"));
});
