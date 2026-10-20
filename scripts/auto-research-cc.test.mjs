// scripts/auto-research-cc.mjs の v3 発見プロンプト（4レンズ×多言語・鮮度14日・追加ラウンド）の単体テスト。
// 実Claude CLI・実ファイルへの書き込みなし。実行: node --test scripts/auto-research-cc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDiscoveryPrompt, MAX_TOTAL_DISCOVERY_MS, DISCOVER_WEBSEARCH_LIMIT } from "./auto-research-cc.mjs";
import { localDayIndex } from "./lib/day-index.mjs";
import { lensOrderForDay, lensLanguagePlan, formatLensTierSummary } from "./lib/case-lenses.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tuning = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/research-tuning.json"), "utf-8"));
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/sources.json"), "utf-8"));
const roundFoci = tuning.cc.roundFoci;
const NOW = new Date("2026-10-20T10:00:00+09:00");
const base = { existingTitles: "（既存なし）", seenThisRun: [], roundFoci, sourcesRegistry: registry, now: NOW };

const LANG_LABELS = { zh: "中国語", ko: "韓国語", es: "スペイン語", fr: "フランス語", de: "ドイツ語" };

test("research-tuning: cc.roundFoci は仕様 §2 の4レンズ（広告 / デザイン・情報表現 / アート・建築・クラフト / 新しい表現手法）", () => {
  assert.equal(roundFoci.length, 4);
  assert.match(roundFoci[0].label, /広告/);
  assert.match(roundFoci[1].label, /デザイン/);
  assert.match(roundFoci[1].label, /情報表現/);
  assert.match(roundFoci[2].label, /アート/);
  assert.match(roundFoci[2].label, /建築/);
  assert.match(roundFoci[2].label, /クラフト/);
  assert.match(roundFoci[3].label, /表現手法/);
  for (const f of roundFoci) {
    assert.ok(f.diversity && f.sources && f.sourceRefs.length > 0, f.label);
  }
  // 運用知見の引き継ぎ: ゲーム/XRの告知は避ける・広告賞ネタ上限
  assert.match(roundFoci[3].diversity, /ゲーム/);
  assert.match(roundFoci[0].diversity, /広告賞ネタは全体の半分以下/);
});

test("発見プロンプト: 鮮度は固定14日。前回調査日ベースの文言が無く、受賞発表を例外にしないと明記", () => {
  const p = buildDiscoveryPrompt({ ...base, round: 1 });
  assert.match(p, /直近14日/);
  assert.match(p, /2026年10月6日|2026-10-06/, "14日前の日付が具体的に入る");
  assert.ok(!/前回調査日/.test(p), "前回調査日ベースの文言が残っていない");
  assert.match(p, /受賞発表は鮮度の例外にしない/);
  assert.match(p, /作品(自体)?の公開・発表/);
  assert.match(p, /過去の名作の掘り起こしは禁止/);
});

test("発見プロンプト: lastRunDate を渡されても鮮度に影響しない（後方互換）", () => {
  const a = buildDiscoveryPrompt({ ...base, round: 1, lastRunDate: new Date("2026-10-19T00:00:00+09:00") });
  const b = buildDiscoveryPrompt({ ...base, round: 1, lastRunDate: new Date("2026-09-01T00:00:00+09:00") });
  assert.equal(a, b);
});

test("発見プロンプト: round 1..4 は当日の順序でそれぞれ別のレンズ（4レンズが1回ずつ）", () => {
  const order = lensOrderForDay(localDayIndex(NOW));
  const seen = new Set();
  for (let round = 1; round <= 4; round++) {
    const p = buildDiscoveryPrompt({ ...base, round });
    const lens = order[round - 1];
    assert.ok(p.includes(roundFoci[lens].label), `round ${round}`);
    assert.match(p, new RegExp(`レンズ${lens + 1}/4`));
    seen.add(lens);
  }
  assert.equal(seen.size, 4);
});

test("発見プロンプト: 全レンズに英語・日本語が必ず入り、4レンズ合計で5言語が毎日すべて使われる", () => {
  for (let d = 0; d < 10; d++) {
    const now = new Date(NOW.getTime() + d * 86400000);
    const prompts = [1, 2, 3, 4].map((round) => buildDiscoveryPrompt({ ...base, now, round }));
    for (const p of prompts) {
      assert.match(p, /英語:/);
      assert.match(p, /日本語:/);
    }
    for (const [id, label] of Object.entries(LANG_LABELS)) {
      assert.ok(prompts.some((p) => p.includes(`${label}`)), `day+${d}: ${id}(${label}) がどのレンズにも無い`);
    }
    // 各レンズの回転枠は2言語ちょうど
    for (const p of prompts) {
      const n = Object.values(LANG_LABELS).filter((l) => p.includes(`- ${l}`)).length;
      assert.equal(n, 2, `回転言語が2つでない`);
    }
  }
});

test("発見プロンプト: 言語の割り当ては lensLanguagePlan と一致", () => {
  const plan = lensLanguagePlan(localDayIndex(NOW));
  const order = lensOrderForDay(localDayIndex(NOW));
  const p = buildDiscoveryPrompt({ ...base, round: 1 });
  for (const id of plan[order[0]].slice(2)) assert.ok(p.includes(`- ${LANG_LABELS[id]}`), id);
});

test("発見プロンプト: 追加ラウンドは指定レンズ・指定言語・別の検索語、基準は緩めないと明記", () => {
  const p = buildDiscoveryPrompt({ ...base, round: 5, lensIndex: 2, langs: ["fr", "de"], extraVariant: 1 });
  assert.ok(p.includes(roundFoci[2].label));
  assert.match(p, /追加ラウンド/);
  assert.match(p, /フランス語/);
  assert.match(p, /ドイツ語/);
  assert.ok(!/- 英語:/.test(p), "追加ラウンドは未使用言語のみ");
  assert.match(p, /別の検索語/);
  assert.match(p, /基準(は|を)(下げ|緩め)ない/);
  // 言語が尽きている場合
  const p2 = buildDiscoveryPrompt({ ...base, round: 5, lensIndex: 0, langs: [], extraVariant: 2 });
  assert.match(p2, /追加ラウンド/);
  assert.match(p2, /別の検索語/);
});

test("発見プロンプト: 出力形式に gateScore(1〜10) と gateReason を含み、WebSearch回数上限は言語数に見合う値", () => {
  const p = buildDiscoveryPrompt({ ...base, round: 1 });
  assert.match(p, /"gateScore"/);
  assert.match(p, /gateScore（1〜10/);
  assert.match(p, new RegExp(`WebSearchは合計${DISCOVER_WEBSEARCH_LIMIT}回以内`));
  assert.ok(DISCOVER_WEBSEARCH_LIMIT >= 14 && DISCOVER_WEBSEARCH_LIMIT <= 24, "4言語×数回+巡回先の分");
});

test("発見フェーズ全体の上限は90分", () => {
  assert.equal(MAX_TOTAL_DISCOVERY_MS, 90 * 60 * 1000);
});

test("formatLensTierSummary: レンズ別・tier別の件数を1行ずつ出す", () => {
  const s = formatLensTierSummary(
    [
      { candidates: 12, gate1: { accept: 3, borderline: 2, reject: 7 }, adopted: { accept: 2, borderline: 1 } },
      { candidates: 0, gate1: { accept: 0, borderline: 0, reject: 0 }, adopted: { accept: 0, borderline: 0 } },
    ],
    ["広告", "デザイン"]
  );
  const lines = s.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /レンズ1/);
  assert.match(lines[0], /候補12/);
  assert.match(lines[0], /accept 3/);
  assert.match(lines[0], /borderline 2/);
  assert.match(lines[0], /採用 accept 2 \+ borderline 1/);
});
