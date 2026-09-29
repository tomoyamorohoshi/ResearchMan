// 巨大データJSON（cases/ideas/idea-layouts）の「配信用テキスト生成」と「アップロード要否判定」の純関数群。
// scripts/prepare-public-data.mjs（ローカル/dev用のpublic/dataコピー）と
// scripts/upload-public-data.mjs（Blobアップロード）で共用する。
import crypto from "crypto";

export const PUBLIC_DATA_FILES = ["cases.json", "ideas.json", "idea-layouts.json"];

// rawText: data/<name> の生テキスト。cases.jsonのみ src/lib/cases.ts と同じフィルタ
// （quarantined===trueを除外）を適用する。ideas/idea-layoutsはminifyのみ
export function buildPublicDataText(name, rawText) {
  if (name === "cases.json") {
    return JSON.stringify(JSON.parse(rawText).filter((c) => !c.quarantined));
  }
  if (name === "ideas.json" || name === "idea-layouts.json") {
    return JSON.stringify(JSON.parse(rawText)); // 従来のprepare-public-dataと同じくminify
  }
  throw new Error(`unknown public data file: ${name}`);
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function filesNeedingUpload(hashes, state, { force = false } = {}) {
  return PUBLIC_DATA_FILES.filter((f) => force || (state ?? {})[f] !== hashes[f]);
}

// ~/.researchman-favsync.json の endpoint（…/api/favorites）と同一オリジンのアップロードAPI
export function uploadUrlFromEndpoint(endpoint) {
  return `${new URL(endpoint).origin}/api/data-upload`;
}

export const UPLOAD_STATE_FILENAME = ".researchman-data-upload-state.json";

// 現在のdata/*.jsonから配信用テキストのハッシュを求める（upload-public-dataとwatchdogで共用）
export function computePublicDataHashes(dataDir, readFile) {
  const out = {};
  for (const name of PUBLIC_DATA_FILES) {
    out[name] = sha256Text(buildPublicDataText(name, readFile(`${dataDir}/${name}`)));
  }
  return out;
}

export function blobStaleReasonKey(names) {
  return `blob-stale:${[...names].sort().join(",")}`;
}

export function buildBlobStaleReport(names) {
  return [
    `⚠️ Vercel Blobの配信データが古い可能性があります（${names.join(", ")}）。`,
    "data/*.json の内容とBlobへの最終アップロード成功時のハッシュが不一致です（pre-pushのBlob同期が失敗し続けている等）。サイトは古い内容のまま更新されません。",
    "対処: node scripts/upload-public-data.mjs --force を手動実行してください（失敗する場合は出力のエラーを確認）。",
  ].join("\n");
}

// @vercel/blob の uploadPresigned は abortSignal を署名取得fetchへ渡さず、ネットワーク詰まりで
// 無期限に固まりうる（pre-pushフックが全pushをブロックする）。Promise.raceで確実に打ち切る
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 日次ジョブはgitロック（os.tmpdir()/researchman-git.lock。ディレクトリ）を握ったままdata更新→
// pre-pushのBlob同期→pushまで行う。その間にwatchdogが走ると「Blobが古い」と誤検知し、
// 1日1回の通知抑制枠を消費して本物の故障通知を握りつぶすため、ロック存在中は検査しない。
// heldFn には git-lock.mjs の isHeld を渡す（保持PIDが死んだ残骸ロックは「ジョブ実行中」と見なさない）
export function shouldSkipBlobStaleCheck(lockPath, heldFn) {
  try {
    return Boolean(heldFn(lockPath));
  } catch {
    return false;
  }
}
