// scripts/biweekly-tuneup.mjs の runDrySubpipeline() 単体検証
// （TDD: 実装前にこのテストを書き、失敗を確認してから実装した）。
//
// 背景: Windowsでは spawnSync("npm", ...) が shell:true 無しでは npm.cmd を解決できず
// ENOENT で即死する（週次チューンアップのdry-run検証が稼働開始以来一度も成功していなかった
// 根本原因）。ideas:dry 等の重いスクリプトは使わず、確実に一瞬で終わる notify:line:dry
// （--dry-runで送信もファイル書き込みも行わない）を使って「npmスクリプトを実際に起動できる
// こと」だけを検証する。
//
// 実行: node scripts/smoke-tuneup-dry-subpipeline.mjs
import { runDrySubpipeline } from "./biweekly-tuneup.mjs";

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

async function run() {
  // notify:line:dry は --dry-run のため送信・ファイル書き込みを行わず、数秒で終わる。
  // 「npm を実際に起動できる（spawnがENOENTにならない）」ことの確認用に使う。
  const result = await runDrySubpipeline("notify:line:dry");
  assert(
    typeof result === "object" && result !== null,
    `runDrySubpipeline は {ok, reason?} オブジェクトを返す (${JSON.stringify(result)})`
  );
  assert(result.ok === true, `npm run notify:line:dry の起動・実行に成功する (${JSON.stringify(result)})`);

  // 存在しないnpmスクリプトを指定した場合は「起動はできたが検証（npmスクリプト自体）が
  // 失敗した」ケースとして ok:false かつ reason にスクリプト名を含む理由が返る。
  // これは「npmの起動そのものに失敗した」ケースとは区別されるべき失敗であり、
  // reasonに「起動失敗」という文言が含まれてはいけない（指摘5: 旧テストはreasonに
  // スクリプト名が含まれることしか見ておらず、起動失敗分岐でも検証失敗分岐でも
  // 機械的に真になってしまい、分岐を区別できていなかった）。
  const badResult = await runDrySubpipeline("this-script-does-not-exist-in-package-json");
  assert(badResult.ok === false, `存在しないnpmスクリプトはok:falseを返す (${JSON.stringify(badResult)})`);
  assert(
    typeof badResult.reason === "string" && badResult.reason.includes("this-script-does-not-exist-in-package-json"),
    `reasonにスクリプト名が含まれる (${JSON.stringify(badResult)})`
  );
  assert(
    typeof badResult.reason === "string" && !badResult.reason.includes("起動失敗"),
    `検証失敗(スクリプト自体の失敗)は「起動失敗」とラベルされない (${JSON.stringify(badResult)})`
  );
  assert(
    typeof badResult.reason === "string" && badResult.reason.includes("exit code"),
    `検証失敗のreasonにはexit codeが含まれる (${JSON.stringify(badResult)})`
  );

  // npm自体が解決できない（今回の事故そのものの再発）場合は「起動失敗」と明確にラベルされる
  // ことを確認する（指摘1）。PATHからnpmを見つけられない環境をenv注入で再現する
  // （本番コードは変えずprocess.envを渡すのが既定。テストだけ壊れたPATHを注入する）。
  const brokenEnv = {
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATH: "C:\\researchman-smoke-test-nonexistent-dir-xyz",
  };
  const launchFailResult = await runDrySubpipeline("notify:line:dry", { env: brokenEnv });
  assert(launchFailResult.ok === false, `npm解決不可時はok:falseを返す (${JSON.stringify(launchFailResult)})`);
  assert(
    typeof launchFailResult.reason === "string" && launchFailResult.reason.includes("起動失敗"),
    `npm解決不可時は「起動失敗」とラベルされる (${JSON.stringify(launchFailResult)})`
  );

  // タイムアウト（指摘2）は「起動失敗」とも「検証失敗」とも別ラベルになることを確認する。
  // 本番のSUBPIPELINE_TIMEOUT_MS(45分)を実際に待つのは非現実的なため、timeoutMs注入で
  // 短時間（1.5秒）に短縮して検証する。ideas:dry（node scripts/generate-idea-seeds.mjs）を
  // あえて使い、1.5秒で強制killされるところまでしか進ませない
  // （フルの30分超dry-runは実行しない。指摘3のプロセスツリーkillが実際に動くことも
  // 副次的に確認できる）。
  const timeoutResult = await runDrySubpipeline("ideas:dry", { timeoutMs: 1500 });
  assert(timeoutResult.ok === false, `タイムアウト時はok:falseを返す (${JSON.stringify(timeoutResult)})`);
  assert(
    typeof timeoutResult.reason === "string" && timeoutResult.reason.includes("タイムアウト"),
    `タイムアウト時は「タイムアウト」とラベルされる (${JSON.stringify(timeoutResult)})`
  );
  assert(
    typeof timeoutResult.reason === "string" && !timeoutResult.reason.includes("起動失敗"),
    `タイムアウトは「起動失敗」とは区別してラベルされる (${JSON.stringify(timeoutResult)})`
  );
  assert(
    typeof timeoutResult.reason === "string" && !timeoutResult.reason.includes("exit code"),
    `タイムアウトは「exit code」を含む検証失敗ラベルとは区別される (${JSON.stringify(timeoutResult)})`
  );

  // 指摘3の実機検証: タイムアウト後、孫プロセス(generate-idea-seeds.mjs)が本当に
  // 一掃されていることを確認する（killProcessTreeSyncが実際に効いていることの裏取り）。
  // taskkillは非同期にプロセスを終了させるため、少し待ってから確認する。
  await new Promise((r) => setTimeout(r, 1500));
  const { spawnSync } = await import("child_process");
  if (process.platform === "win32") {
    const psCheck = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*generate-idea-seeds*' }).ProcessId -join ','",
      ],
      { encoding: "utf-8" }
    );
    const leftoverPids = (psCheck.stdout || "").trim();
    assert(
      leftoverPids === "",
      `タイムアウト後、孫プロセス(generate-idea-seeds.mjs)が残っていない (残存PID: "${leftoverPids}")`
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  } else {
    console.log("\n全テストPASS: tuneup-dry-subpipeline");
  }
}

run();
