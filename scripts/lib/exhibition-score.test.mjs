// node --test scripts/lib/exhibition-score.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { computeSeedScore } from "./exhibition-score.mjs";

const profile = JSON.parse(fs.readFileSync(new URL("../../data/exhibition-profile.json", import.meta.url), "utf-8"));

test("メディアアート・光・既知作家・信頼会場・開催中(残り7日以上)は高得点", () => {
  const s = computeSeedScore({ tags: ["media_art", "light", "installation"], artists: ["真鍋大度"], venue: "ICC(NTT InterCommunication Center)", venueType: "media_art_center", startDate: "2026-10-01", endDate: "2026-11-08" }, profile, "2026-10-04");
  assert.equal(s, 35 + 20 + 15 + 10 + 10);
});
test("周辺タグのみ・無名・開始31日以上先は低得点", () => {
  const s = computeSeedScore({ tags: ["sculpture"], artists: ["無名"], venue: "どこか", venueType: "other", startDate: "2026-12-01", endDate: "2026-12-20" }, profile, "2026-10-04");
  assert.equal(s, 15);
});
