// scripts/lib/notify-digest-core.mjs の純関数部分の単体テスト（node:test）。
// 実行: node --test scripts/lib/notify-digest-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQueueLines, filterToday, buildDigestText } from "./notify-digest-core.mjs";

test("parseQueueLines: 空行を無視してjsonlをパースする", () => {
  const raw = '{"at":"2026-07-22T01:00:00.000Z","label":"A","text":"hello"}\n\n{"at":"2026-07-22T02:00:00.000Z","label":"B","text":"world"}\n';
  const entries = parseQueueLines(raw);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].label, "A");
  assert.equal(entries[1].label, "B");
});

test("parseQueueLines: 壊れた行はエラーを投げず読み飛ばす", () => {
  const raw = '{"at":"2026-07-22T01:00:00.000Z","label":"A","text":"hello"}\nnot json\n{"at":"2026-07-22T02:00:00.000Z","label":"B","text":"world"}\n';
  const entries = parseQueueLines(raw);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].label, "A");
  assert.equal(entries[1].label, "B");
});

test("parseQueueLines: 空文字列は空配列", () => {
  assert.deepEqual(parseQueueLines(""), []);
});

// システムのタイムゾーンに依存しないよう、UTC文字列を手書きせず常にローカル時刻の
// Dateオブジェクトから toISOString() する（localDateStr側もこの往復で一致する）。
const localIso = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

test("filterToday: at の日付部分（ローカルタイム）が一致するものだけ返す", () => {
  const entries = [
    { at: localIso(2026, 7, 22, 1, 0), label: "today1", text: "x" },
    { at: localIso(2026, 7, 21, 23, 59), label: "yesterday", text: "y" },
    { at: localIso(2026, 7, 22, 10, 0), label: "today2", text: "z" },
  ];
  const result = filterToday(entries, "2026-07-22");
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((e) => e.label), ["today1", "today2"]);
});

test("buildDigestText: 空配列なら空文字列", () => {
  assert.equal(buildDigestText([], "2026-07-22"), "");
});

test("buildDigestText: ヘッダに当日件数を含む", () => {
  const entries = [
    { at: localIso(2026, 7, 22, 1, 0), label: "Auto research", text: "3件追加\n詳細..." },
    { at: localIso(2026, 7, 22, 2, 0), label: "Tech radar", text: "本日の新規追加なし" },
  ];
  const text = buildDigestText(entries, "2026-07-22");
  assert.ok(text.startsWith("📋 本日のRM活動"));
  assert.ok(text.includes("2件"), `件数表記が含まれていない: ${text}`);
});

test("buildDigestText: 当日でないentryは日付を明記して持ち越しと分かるようにする", () => {
  const entries = [
    { at: localIso(2026, 7, 21, 12, 0), label: "Auto research", text: "持ち越し分" },
    { at: localIso(2026, 7, 22, 1, 0), label: "Tech radar", text: "本日分" },
  ];
  const text = buildDigestText(entries, "2026-07-22");
  assert.ok(text.includes("[07/21]"), `持ち越し日付表記が無い: ${text}`);
  assert.ok(text.includes("Auto research"));
  assert.ok(text.includes("Tech radar"));
  // 当日分には日付プレフィックスを付けない
  assert.ok(!text.includes("[07/22]"), `当日分に不要な日付表記: ${text}`);
});

test("buildDigestText: 各行は label と text の1行目を使う", () => {
  const entries = [
    { at: localIso(2026, 7, 22, 1, 0), label: "Auto research", text: "3件追加・本番反映OK\n・title1\n・title2" },
  ];
  const text = buildDigestText(entries, "2026-07-22");
  assert.ok(text.includes("Auto research: 3件追加・本番反映OK"), `本文行が期待と異なる: ${text}`);
  assert.ok(!text.includes("title1"), "textの1行目以降まで含めてはいけない");
});
