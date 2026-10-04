/**
 * scripts/windows/studio-keeper.mjs（Studio死活監視・自動復旧）の純関数部分。
 *
 * 背景: 2026-07-17 20:44以降 Studioサーバ（LINEボットの実体、tsx watch）が無言で
 * 死んでいてもスケジュールタスク（AtLogOnトリガーのみ）は再起動されず、LINEボットが
 * 無応答のまま気づかれなかった実インシデントの再発防止。
 *
 * ここには外部コマンド実行・ネットワーク呼び出しを含まない純関数だけを置く
 * （node:testで単体テストできるようにするため。branch-guard.mjs / quarantine.mjs と同じ方針）。
 * ただし writeJsonAtomicSync のみ例外（下記コメント参照）。
 */
import fs from "fs";
import path from "path";

// netstat -ano の生出力から、指定ポートをLISTENしているPIDを重複なく返す。
// 例: "  TCP    0.0.0.0:5178           0.0.0.0:0              LISTENING       105884"
// アドレス末尾の ":<port>" を厳密一致で見るため、5178 と 51780 を混同しない
// （前方一致・includes()は使わない）。IPv4/IPv6の2行が同じPIDを指す場合は1件に統合する。
export function parseListeningPids(netstatOutput, port) {
  if (!netstatOutput) return [];
  const target = String(port);
  const pids = new Set();
  const lineRe = /^\s*TCP\S*\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i;
  for (const line of netstatOutput.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, matchedPort, pid] = m;
    if (matchedPort === target) pids.add(pid);
  }
  return [...pids];
}

// logs/incidents.json（配列）へインシデントを追記した新しい配列を返す。既存配列は破壊しない。
// 既存が配列でなければ（初回・壊れたファイル等）空配列として扱う。
export function appendIncident(existingIncidents, incident) {
  const base = Array.isArray(existingIncidents) ? existingIncidents : [];
  return [...base, incident];
}

// ログサイズが上限を超えているか（境界＝上限そのものはローテートしない。超過のみtrue）。
export function shouldRotate(sizeBytes, limitBytes) {
  return sizeBytes > limitBytes;
}

// UTCエポックのDateから「JST(+09:00)のISO8601文字列（秒精度）」を組み立てる。
// jstDateString（scripts/lib/jst-date.mjs）と同じ「エポックに9時間分足してtoISOStringで
// 切り出す」方式なので、実行環境のプロセスタイムゾーン設定に依存しない
// （run-job.mjs の unixDateString はプロセスのローカル時刻getterに依存するのに対し、
// こちらはインシデント記録用に環境非依存で再現可能な値を作る）。
export function toJstIsoString(d = new Date()) {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const shifted = new Date(d.getTime() + JST_OFFSET_MS);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+09:00");
}

// checkAlive（注入された死活確認の非同期関数、引数なし）を最大retries回試し、
// 1回でも成功したら即trueを返す（残りの試行はしない）。全て失敗したらfalse。
// sleep（注入された非同期の待機関数）は各失敗の直後に呼ぶが、最後の試行の後は呼ばない
// （復旧シーケンスへ進む/exitする直前に無駄な待機をしないため）。
// ジョブ実行中の一過性負荷での1回の失敗だけで誤killする事故を防ぐためのリトライ
// （checkAlive/sleepを注入するのは実時間を待たずにnode:testで検証できるようにするため）。
export async function retryCheckAlive(checkAlive, sleep, retries, intervalMs) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (await checkAlive()) return true;
    if (attempt < retries - 1) await sleep(intervalMs);
  }
  return false;
}

// logs/incidents.json に書き込むファイル内容（JSON文字列＋改行）を組み立てる純関数。
export function buildIncidentsFileContent(incidents) {
  return `${JSON.stringify(incidents, null, 2)}\n`;
}

// 同一ディレクトリの一時ファイルに書いてからrenameするアトミック書き込み（同期版）。
// scripts/lib/ideas-io.mjs の writeJsonAtomic（fs/promises版）と同じ命名パターン・同じ方式。
// studio-keeper.mjs 側の既存コードが同期API（fs.writeFileSync等）に揃っているため非同期化しない。
// 本来この関数は外部I/Oを行うため「純関数だけを置く」というファイル冒頭の方針からは外れるが、
// node:testから直接I/Oを検証する（一時ディレクトリでrename方式であることを確認する）ために
// ここに置く（詳細は実装時の報告を参照）。
export function writeJsonAtomicSync(filePath, content) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

// Studioタスク（`npm.cmd run studio` → npm --prefix studio run dev → tsx watch server/index.ts）
// の連鎖に属するプロセスか。無関係なnode.exe（run-job.mjs / claude CLI / next dev等）を巻き込まないよう
// 「run studio」という単語だけでは判定せず、npm起動形・--prefix studio・tsx+server/index.ts に限定する。
const STUDIO_CHAIN_RES = [
  /\bnpm(?:\.cmd|-cli\.js)?"?\s+(?:--prefix\s+studio\s+)?run\s+(?:studio|dev)\b/i,
  /--prefix\s+studio\s+run\s+dev\b/i,
  /\btsx\b[^\n]*server[\/\\]index\.ts/i,
];
function isStudioChain(proc) {
  const cmd = proc && proc.CommandLine;
  if (!cmd) return false;
  if (/studio-keeper|run-job\.mjs/i.test(cmd)) return false;
  return STUDIO_CHAIN_RES.some((re) => re.test(cmd));
}

// プロセススナップショット（Win32_Process: ProcessId/ParentProcessId/Name/CommandLine の配列）と
// LISTENしているPID群から、`taskkill /F /T /PID` するルートPID（文字列）の配列を返す純関数。
// (a) LISTEN pidごとに、Studio連鎖に属する親を辿った最上位 (b) コマンドラインがタスク起動形に一致するもの。
// 他のルートの子孫は除外する。`taskkill /IM node.exe` 相当の広い選択は行わない。
// 背景(2026-10-05): leaf(server)だけkillすると親cmd/npm/tsx watchが残りタスクがRunningのまま
// IgnoreNewで再起動が無視され続けたため、ツリーごと落とす。
export function findStudioKillRoots(snapshot, listeningPids) {
  if (!Array.isArray(snapshot)) return [];
  const byPid = new Map();
  for (const proc of snapshot) {
    if (proc && proc.ProcessId != null) byPid.set(String(proc.ProcessId), proc);
  }
  const parentOf = (pid) => {
    const proc = byPid.get(pid);
    if (!proc || proc.ParentProcessId == null) return null;
    const ppid = String(proc.ParentProcessId);
    return byPid.has(ppid) ? ppid : null;
  };
  const selected = new Set();
  for (const raw of Array.isArray(listeningPids) ? listeningPids : []) {
    let cur = String(raw);
    if (!byPid.has(cur)) continue;
    const seen = new Set([cur]);
    for (;;) {
      const parent = parentOf(cur);
      if (!parent || seen.has(parent) || !isStudioChain(byPid.get(parent))) break;
      seen.add(parent);
      cur = parent;
    }
    selected.add(cur);
  }
  for (const [pid, proc] of byPid) {
    if (isStudioChain(proc)) selected.add(pid);
  }
  const hasSelectedAncestor = (pid) => {
    const seen = new Set([pid]);
    let cur = parentOf(pid);
    while (cur && !seen.has(cur)) {
      if (selected.has(cur)) return true;
      seen.add(cur);
      cur = parentOf(cur);
    }
    return false;
  };
  return [...selected].filter((pid) => !hasSelectedAncestor(pid));
}
