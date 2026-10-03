// cases ジョブの `git add public/thumbnails` が exhibition サムネを巻き込まないことの静的検査（SPEC §5.2）。
// 実行: node --test scripts/exclude-paths.test.mjs
// 巻き込むとデータ(exhibition.json)と別コミットになり pre-push 監査が落ちて push が全滞留する。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["launchd/com.researchman.autoresearch.plist", "scripts/watchdog.mjs", "scripts/windows/run-job.mjs"];

for (const rel of FILES) {
  test(`${rel}: tech を :(exclude) している全行が exhibition も :(exclude) している`, () => {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf-8").split("\n");
    const techLines = lines.filter((l) => l.includes("exclude)public/thumbnails/tech"));
    assert.ok(techLines.length > 0, "検査対象行が無い（ファイル構造が変わった？）");
    for (const l of techLines) {
      assert.ok(l.includes("exclude)public/thumbnails/exhibition"), `exhibition の除外漏れ: ${l.trim()}`);
    }
  });
}
