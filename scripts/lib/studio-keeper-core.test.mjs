// scripts/lib/studio-keeper-core.mjs の純関数部分の単体テスト（node:test）。
// 実行: node --test scripts/lib/studio-keeper-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseListeningPids,
  appendIncident,
  shouldRotate,
  toJstIsoString,
  retryCheckAlive,
  buildIncidentsFileContent,
  writeJsonAtomicSync,
  findStudioKillRoots,
} from "./studio-keeper-core.mjs";

const NETSTAT_SAMPLE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:5178           0.0.0.0:0              LISTENING       105884
  TCP    [::]:5178              [::]:0                 LISTENING       105884
  TCP    127.0.0.1:51780        127.0.0.1:54321        ESTABLISHED     22222
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       9999
  UDP    0.0.0.0:5353           *:*                                    4444
`;

test("parseListeningPids: port 5178をLISTENしているPIDを重複なく返す（IPv4/IPv6の重複は1件）", () => {
  assert.deepEqual(parseListeningPids(NETSTAT_SAMPLE, 5178), ["105884"]);
});

test("parseListeningPids: 5178と51780を混同しない（前方一致ではなく厳密一致）", () => {
  assert.equal(parseListeningPids(NETSTAT_SAMPLE, 51780).includes("105884"), false);
  // 51780はESTABLISHEDでLISTENINGではないため対象外
  assert.deepEqual(parseListeningPids(NETSTAT_SAMPLE, 51780), []);
});

test("parseListeningPids: 該当ポートがLISTENINGで無ければ空配列", () => {
  assert.deepEqual(parseListeningPids(NETSTAT_SAMPLE, 8080), []);
});

test("parseListeningPids: 空文字列・undefinedは空配列（例外を投げない）", () => {
  assert.deepEqual(parseListeningPids("", 5178), []);
  assert.deepEqual(parseListeningPids(undefined, 5178), []);
});

test("appendIncident: 既存配列にインシデントを追記した新しい配列を返す", () => {
  const existing = [{ at: "2026-07-01T00:00:00+09:00", kind: "studio-down", recovered: true, detail: "a" }];
  const incident = { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "b" };
  const result = appendIncident(existing, incident);
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], incident);
  // 元配列を破壊しない
  assert.equal(existing.length, 1);
});

test("appendIncident: 既存がundefined/nullなら新規配列として扱う", () => {
  const incident = { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: false, detail: "x" };
  assert.deepEqual(appendIncident(undefined, incident), [incident]);
  assert.deepEqual(appendIncident(null, incident), [incident]);
});

test("shouldRotate: サイズが上限超なら true", () => {
  assert.equal(shouldRotate(11 * 1024 * 1024, 10 * 1024 * 1024), true);
});

test("shouldRotate: サイズが上限以下なら false（境界は超過のみtrue）", () => {
  assert.equal(shouldRotate(10 * 1024 * 1024, 10 * 1024 * 1024), false);
  assert.equal(shouldRotate(1024, 10 * 1024 * 1024), false);
});

test("toJstIsoString: UTCエポックからJST(+09:00)表記のISO文字列を組み立てる", () => {
  // 2026-07-20T18:00:00Z = 2026-07-21T03:00:00+09:00
  const d = new Date(Date.UTC(2026, 6, 20, 18, 0, 0));
  assert.equal(toJstIsoString(d), "2026-07-21T03:00:00+09:00");
});

test("toJstIsoString: 秒未満は切り捨てる（ミリ秒を含めない）", () => {
  const d = new Date(Date.UTC(2026, 6, 20, 18, 0, 0, 500));
  assert.equal(toJstIsoString(d), "2026-07-21T03:00:00+09:00");
});

test("retryCheckAlive: 1回目成功なら即true、checkAliveは1回だけ・sleepは呼ばれない", async () => {
  let checkAliveCalls = 0;
  const checkAlive = async () => {
    checkAliveCalls += 1;
    return true;
  };
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
  };
  const result = await retryCheckAlive(checkAlive, sleep, 3, 10000);
  assert.equal(result, true);
  assert.equal(checkAliveCalls, 1);
  assert.deepEqual(sleepCalls, []);
});

test("retryCheckAlive: 1,2回目失敗・3回目成功ならtrue、checkAliveは3回呼ばれる", async () => {
  let checkAliveCalls = 0;
  const checkAlive = async () => {
    checkAliveCalls += 1;
    return checkAliveCalls === 3;
  };
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
  };
  const result = await retryCheckAlive(checkAlive, sleep, 3, 10000);
  assert.equal(result, true);
  assert.equal(checkAliveCalls, 3);
  // 1,2回目失敗の直後にだけsleepする（3回目成功後はsleepしない）
  assert.deepEqual(sleepCalls, [10000, 10000]);
});

test("retryCheckAlive: 3回とも失敗ならfalse、checkAliveは3回呼ばれる", async () => {
  let checkAliveCalls = 0;
  const checkAlive = async () => {
    checkAliveCalls += 1;
    return false;
  };
  const sleepCalls = [];
  const sleep = async (ms) => {
    sleepCalls.push(ms);
  };
  const result = await retryCheckAlive(checkAlive, sleep, 3, 10000);
  assert.equal(result, false);
  assert.equal(checkAliveCalls, 3);
  // 最後（3回目）の試行の後はsleepしない
  assert.deepEqual(sleepCalls, [10000, 10000]);
});

test("buildIncidentsFileContent: incidents配列をJSON文字列＋改行に組み立てる純関数", () => {
  const incidents = [
    { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "x" },
  ];
  const content = buildIncidentsFileContent(incidents);
  assert.equal(content, `${JSON.stringify(incidents, null, 2)}\n`);
});

test("writeJsonAtomicSync: 書き込み後に正しい内容がJSON.parseで読める", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-keeper-core-test-"));
  try {
    const filePath = path.join(dir, "incidents.json");
    const incidents = appendIncident(
      [],
      { at: "2026-07-21T03:00:00+09:00", kind: "studio-down", recovered: true, detail: "x" },
    );
    writeJsonAtomicSync(filePath, buildIncidentsFileContent(incidents));
    const read = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.deepEqual(read, incidents);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeJsonAtomicSync: rename方式のため一時ファイルが最終的に残らない", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-keeper-core-test-"));
  try {
    const filePath = path.join(dir, "incidents.json");
    writeJsonAtomicSync(filePath, "[]\n");
    const entries = fs.readdirSync(dir);
    assert.deepEqual(entries, ["incidents.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- findStudioKillRoots: Studioプロセスツリーのkill対象ルート抽出 ----
// フィクスチャは 2026-10-05 に本番機で実測したコマンドラインに合わせてある。
const R = String.raw`C:\Users\tomoy\Projects\ClaudeApps\ResearchMan`;
const p = (ProcessId, ParentProcessId, Name, CommandLine) => ({ ProcessId, ParentProcessId, Name, CommandLine });
const NPM_CLI = String.raw`"C:\Program Files\nodejs\\node.exe"  "C:\Program Files\nodejs\\node_modules\npm\bin\npm-cli.js"`;
const ROOT_CMD = String.raw`"cmd.exe" /c set STUDIO_NO_OPEN=1&& set STUDIO_JOB_BUDGET_USD=12&& "C:\Program Files\nodejs\npm.cmd" run studio >> "${R}\logs\studio.log" 2>&1`;
const STUDIO_TREE = [
  p(100, 1, "cmd.exe", ROOT_CMD),
  p(101, 100, "node.exe", `${NPM_CLI} run studio`),
  p(102, 101, "cmd.exe", String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c npm --prefix studio run dev`),
  p(103, 102, "node.exe", `${NPM_CLI} --prefix studio run dev`),
  p(104, 103, "cmd.exe", String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c tsx watch server/index.ts`),
  p(105, 104, "node.exe", String.raw`"node"   "${R}\studio\node_modules\.bin\..\tsx\dist\cli.mjs" watch server/index.ts`),
  p(106, 105, "node.exe", String.raw`"C:\Program Files\nodejs\node.exe" --require ${R}\studio\node_modules\tsx\dist\preflight.cjs --import file:///C:/Users/tomoy/Projects/ClaudeApps/ResearchMan/studio/node_modules/tsx/dist/loader.mjs server/index.ts`),
  p(107, 106, "esbuild.exe", String.raw`${R}\studio\node_modules\vite\node_modules\@esbuild\win32-x64\esbuild.exe --service=0.25.12 --ping`),
];
const OTHER = String.raw`C:\Users\tomoy\Projects\OtherApp`;
const CLAUDE = String.raw`node C:\Users\tomoy\AppData\npm\node_modules\@anthropic-ai\claude-code\cli.js`;
const PROMPT_PROCS = [
  p(250, 1, "node.exe", `${CLAUDE} -p "explain npm --prefix studio run dev and set STUDIO_NO_OPEN=1 run studio >> studio.log"`),
  p(251, 1, "cmd.exe", String.raw`cmd.exe /c claude -p "npm --prefix studio run dev"`),
  p(252, 1, "node.exe", `${NPM_CLI} --prefix studio run dev`),
];
const UNRELATED = [
  p(200, 1, "node.exe", String.raw`node scripts/windows/run-job.mjs daily-collect`),
  p(201, 1, "node.exe", `${CLAUDE} -p "please run studio check"`),
  p(202, 1, "node.exe", String.raw`node ${R}\node_modules\next\dist\bin\next dev -p 3000`),
  p(203, 1, "node.exe", String.raw`node scripts/windows/studio-keeper.mjs`),
  p(204, 1, "explorer.exe", ""),
  // 他プロジェクトの npm run dev チェーン（cmd + npm-cli + node）
  p(210, 1, "cmd.exe", String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c npm run dev`),
  p(211, 210, "node.exe", `${NPM_CLI} run dev`),
  p(212, 211, "node.exe", String.raw`node ${OTHER}\node_modules\next\dist\bin\next dev`),
  // 他プロジェクトの npm run studio
  p(220, 1, "cmd.exe", String.raw`cmd.exe /c "C:\Program Files\nodejs\npm.cmd" run studio`),
  p(221, 220, "node.exe", `${NPM_CLI} run studio`),
  // 他プロジェクトの tsx watch server/index.ts
  p(230, 1, "node.exe", String.raw`"node" "${OTHER}\node_modules\tsx\dist\cli.mjs" watch server/index.ts`),
  // ResearchMan自身のNext `npm run dev`
  p(240, 1, "cmd.exe", String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c npm run dev`),
  p(241, 240, "node.exe", `${NPM_CLI} run dev`),
  ...PROMPT_PROCS,
];
const ALL = [...STUDIO_TREE, ...UNRELATED];
const roots = (snap, listening) => findStudioKillRoots(snap, listening, R);

test("findStudioKillRoots: LISTEN pidから親連鎖の最上位(root cmd)を1件だけ返す", () => {
  assert.deepEqual(roots(ALL, ["106"]), ["100"]);
});

test("findStudioKillRoots: LISTEN pidが無くてもコマンドライン一致でルートを返す（本番インシデント: 親だけ生存）", () => {
  const snap = STUDIO_TREE.filter((x) => x.ProcessId < 105);
  assert.deepEqual(roots([...snap, ...UNRELATED], []), ["100"]);
});

test("findStudioKillRoots: 本番実測の孤児tsx watch（親cmdが死んでいる）も単独ルートとして選ぶ", () => {
  const snap = STUDIO_TREE.filter((x) => x.ProcessId >= 105);
  assert.deepEqual(roots([...snap, ...UNRELATED], []), ["105"]);
});

test("findStudioKillRoots: 無関係プロセス（run-job/claude/next dev/keeper/他プロジェクトのnpm run dev・run studio・tsx watch）は一切選ばない", () => {
  assert.deepEqual(roots(UNRELATED, []), []);
  const r = roots(ALL, ["106"]);
  for (const x of UNRELATED) assert.equal(r.includes(String(x.ProcessId)), false);
});

test("findStudioKillRoots: プロンプト中の --prefix studio run dev / STUDIO_NO_OPEN=1 はスタンドアロンルートにならない", () => {
  assert.deepEqual(roots(PROMPT_PROCS, []), []);
});

test("findStudioKillRoots: LISTEN pidの親がStudio連鎖でなければそのpid自身がルート", () => {
  const snap = [p(300, 1, "node.exe", "node server.js"), p(301, 300, "node.exe", "node weird")];
  assert.deepEqual(roots(snap, ["301"]), ["301"]);
});

test("findStudioKillRoots: 親連鎖の途中に無関係な親がいたらそこで止まる", () => {
  const snap = [
    p(400, 1, "node.exe", "node scripts/windows/run-job.mjs x"),
    p(401, 400, "cmd.exe", String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c npm --prefix studio run dev`),
    p(402, 401, "node.exe", String.raw`node ${R}\studio\node_modules\tsx\dist\cli.mjs watch server/index.ts`),
  ];
  assert.deepEqual(roots(snap, ["402"]), ["401"]);
});

test("findStudioKillRoots: 他プロジェクトのnpm run devは親連鎖でも辿らない", () => {
  assert.deepEqual(roots(UNRELATED, ["212"]), ["212"]);
});

test("findStudioKillRoots: 別のルートcmd2つは両方返し、子孫は重複除外・数値pidも可", () => {
  const second = [p(500, 1, "cmd.exe", ROOT_CMD), p(501, 500, "node.exe", `${NPM_CLI} run studio`)];
  assert.deepEqual(roots([...STUDIO_TREE, ...second], [105]).sort(), ["100", "500"]);
});

test("findStudioKillRoots: スナップショットに無いLISTEN pidもルートとして返す（スナップショット取得失敗時の退行防止）", () => {
  assert.deepEqual(roots([], ["1234"]), ["1234"]);
  assert.deepEqual(roots(null, [1234, "1234"]), ["1234"]);
  assert.deepEqual(roots(ALL, ["999"]), ["100", "999"]);
});

test("findStudioKillRoots: スナップショットもLISTENも無ければ空", () => {
  assert.deepEqual(roots([], []), []);
  assert.deepEqual(roots(null, null), []);
});

test("findStudioKillRoots: 親pid循環でも無限ループせず、LISTEN pid自身を返す", () => {
  const snap = [p(1, 2, "cmd.exe", "cmd /c a"), p(2, 1, "cmd.exe", "cmd /c b")];
  assert.deepEqual(roots(snap, ["1"]), ["1"]);
});
