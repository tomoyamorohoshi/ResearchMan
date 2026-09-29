// scripts/lib/twscrape-bin.mjs の単体テスト（node:test）。
// 実行: node --test scripts/lib/twscrape-bin.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { twscrapeCandidatePaths, resolveTwscrapeBin } from "./twscrape-bin.mjs";

const HOME = "C:/Users/x";

test("candidatePaths: win32 は twscrape.exe を含む", () => {
  const c = twscrapeCandidatePaths("win32", HOME);
  assert.equal(c[0], path.join(HOME, ".local", "bin", "twscrape.exe"));
});

test("candidatePaths: 非win32 は拡張子なしのみ", () => {
  const c = twscrapeCandidatePaths("linux", "/home/x");
  assert.deepEqual(c, [path.join("/home/x", ".local", "bin", "twscrape")]);
});

test("resolve: win32 で where が失敗しても ~/.local/bin/twscrape.exe を解決できる（2026-09-14 ENOENT の回帰）", () => {
  const exe = path.join(HOME, ".local", "bin", "twscrape.exe");
  const calls = [];
  const exec = (cmd) => {
    calls.push(cmd);
    if (cmd === "where") throw new Error("not found");
    if (cmd === exe) return "twscrape 0.17";
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  assert.equal(resolveTwscrapeBin({ platform: "win32", homedir: HOME, exec }), exe);
  assert.ok(calls.includes("where"));
});

test("resolve: win32 で where が .exe を返せばそれを採用（.cmd等は除外）", () => {
  const exec = (cmd) => {
    if (cmd === "where") return "C:/a/twscrape.cmd\r\nC:/b/twscrape.exe\r\n";
    throw new Error("unexpected");
  };
  assert.equal(resolveTwscrapeBin({ platform: "win32", homedir: HOME, exec }), "C:/b/twscrape.exe");
});

test("resolve: どこにも無ければ null", () => {
  const exec = () => {
    throw new Error("nope");
  };
  assert.equal(resolveTwscrapeBin({ platform: "win32", homedir: HOME, exec }), null);
  assert.equal(resolveTwscrapeBin({ platform: "linux", homedir: "/h", exec }), null);
});

test("resolve: linux は which の結果を採用", () => {
  const exec = (cmd) => {
    if (cmd === "which") return "/usr/bin/twscrape\n";
    throw new Error("unexpected");
  };
  assert.equal(resolveTwscrapeBin({ platform: "linux", homedir: "/h", exec }), "/usr/bin/twscrape");
});
