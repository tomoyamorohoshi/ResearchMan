// defaultSendLine の宛先ガード（レビュー指摘: to/allowedUserId が無いと broadcast に落ちるのを防ぐ）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultSendLine } from "./gate-proposals.mjs";

function cfgFile(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gatecfg-")), "line.json");
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

test("defaultSendLine: to も allowedUserId も無ければ送信せず ok:false（broadcast しない）", async () => {
  const calls = [];
  const r = await defaultSendLine("x", { configPath: cfgFile({ channelAccessToken: "t" }), send: async (c, t) => (calls.push([c, t]), { ok: true }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /宛先|to/);
  assert.equal(calls.length, 0);
});

test("defaultSendLine: to があれば push 宛先として送る／allowedUserId でも可", async () => {
  const calls = [];
  const send = async (c, t) => (calls.push(c), { ok: true });
  await defaultSendLine("x", { configPath: cfgFile({ channelAccessToken: "t", to: "U1" }), send });
  await defaultSendLine("x", { configPath: cfgFile({ channelAccessToken: "t", allowedUserId: "U2" }), send });
  assert.deepEqual(calls.map((c) => c.to), ["U1", "U2"]);
});
