/**
 * scripts/windows/studio-keeper.mjs（Studio死活監視・自動復旧）の純関数部分。
 *
 * 背景: 2026-07-17 20:44以降 Studioサーバ（LINEボットの実体、tsx watch）が無言で
 * 死んでいてもスケジュールタスク（AtLogOnトリガーのみ）は再起動されず、LINEボットが
 * 無応答のまま気づかれなかった実インシデントの再発防止。
 *
 * ここには外部コマンド実行・ネットワーク呼び出しを含まない純関数だけを置く
 * （node:testで単体テストできるようにするため。branch-guard.mjs / quarantine.mjs と同じ方針）。
 */

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
