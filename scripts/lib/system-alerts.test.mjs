import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendSystemAlert, readSystemAlerts, renderLatestMd, ALERTS_JSONL, ALERTS_LATEST_MD, MAX_LATEST, LATEST_DAYS } from "./system-alerts.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sysalerts-"));
const NOW = new Date("2026-10-20T03:00:00.000Z");
const mk = (i, atMs) => ({ at: new Date(atMs).toISOString(), source: "s", level: "info", title: `t${i}`, body: `b${i}` });

test("appendSystemAlert は jsonl に1行1件で追記し {at,source,level,title,body} を持つ", () => {
  const dir = tmp();
  appendSystemAlert({ source: "watchdog", level: "warn", title: "T1", body: "B1" }, { logsDir: dir, now: NOW });
  appendSystemAlert({ source: "tuneup", level: "info", title: "T2", body: "B2\n2行目" }, { logsDir: dir, now: NOW });
  const lines = fs.readFileSync(path.join(dir, ALERTS_JSONL), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  const a = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(a).sort(), ["at", "body", "level", "source", "title"]);
  assert.equal(a.at, NOW.toISOString());
  assert.equal(JSON.parse(lines[1]).body, "B2\n2行目");
});

test("appendSystemAlert は system-alerts-latest.md を再生成する", () => {
  const dir = tmp();
  appendSystemAlert({ source: "watchdog", level: "error", title: "壊れた", body: "詳細" }, { logsDir: dir, now: NOW });
  const md = fs.readFileSync(path.join(dir, ALERTS_LATEST_MD), "utf8");
  assert.match(md, /壊れた/);
  assert.match(md, /watchdog/);
  assert.match(md, /詳細/);
});

test("appendSystemAlert は logs ディレクトリが無くても作る・不正levelはinfoに丸める", () => {
  const dir = path.join(tmp(), "nested", "logs");
  appendSystemAlert({ source: "x", level: "bogus", title: "t", body: "b" }, { logsDir: dir, now: NOW });
  assert.equal(readSystemAlerts(dir)[0].level, "info");
});

test("renderLatestMd は直近7日のみ・新しい順", () => {
  const day = 86400000;
  const alerts = [mk(1, NOW - 8 * day), mk(2, NOW - 3 * day), mk(3, NOW - 1 * day)];
  const md = renderLatestMd(alerts, NOW);
  assert.ok(!md.includes("t1"));
  assert.ok(md.indexOf("t3") < md.indexOf("t2"));
  assert.equal(LATEST_DAYS, 7);
});

test("renderLatestMd は上限100件", () => {
  const alerts = Array.from({ length: 150 }, (_, i) => mk(i, NOW - i * 1000));
  const md = renderLatestMd(alerts, NOW);
  assert.equal((md.match(/^## /gm) || []).length, MAX_LATEST);
  assert.ok(!md.includes("t120"));
});

test("renderLatestMd は0件でも空表示のMarkdownを返す", () => {
  assert.match(renderLatestMd([], NOW), /ありません/);
});

test("readSystemAlerts は壊れた行を読み飛ばす", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ALERTS_JSONL), `${JSON.stringify(mk(1, NOW))}\nnot json\n`);
  assert.equal(readSystemAlerts(dir).length, 1);
});
