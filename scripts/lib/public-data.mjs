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
