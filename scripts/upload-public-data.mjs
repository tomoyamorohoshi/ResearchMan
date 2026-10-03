// 巨大データJSON（cases/ideas/idea-layouts）をVercel Blobへアップロードする。
// 背景: 同梱配信(public/data)だと日次デプロイのたびにDeployment Storageが65MB級で増える。
//   Blobに固定パス(public-data/<name>)で上書きし、クライアントはBlob→/data/の順にfetchする。
// Blobにはbrotli事前圧縮bytesを public-data/<name>.br として置く（src/lib/publicDataBlob.ts）。
// 方式: 46MB超はFunctionsのボディ上限(4.5MB)を超えるため、/api/data-upload で署名付きURLの発行を受け、
//   @vercel/blob/client の uploadPresigned でBlobへ直接アップロードする（Bearer認証は
//   ~/.researchman-favsync.json の token を流用。トークン値はログに出さない）。
// 使い方: node scripts/upload-public-data.mjs [--force] [--dry-run]
//   既定は「前回成功時とハッシュが違うファイルだけ」上げる（状態: ~/.researchman-data-upload-state.json）。
//   pre-pushフックから毎回呼ばれる（変更が無ければハッシュ比較だけで即終了）。失敗時はexit 1。
import fs from "fs";
import { execFileSync } from "child_process";
import os from "os";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { uploadPresigned } from "@vercel/blob/client";
import {
  PUBLIC_DATA_FILES,
  buildPublicDataText,
  sha256Text,
  filesNeedingUpload,
  uploadUrlFromEndpoint,
  UPLOAD_STATE_FILENAME,
  withTimeout,
} from "./lib/public-data.mjs";
import { readLocalLayoutsInputHash } from "./lib/idea-layouts-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FAVSYNC_CONFIG_PATH = path.join(os.homedir(), ".researchman-favsync.json");
const STATE_PATH = path.join(os.homedir(), UPLOAD_STATE_FILENAME);
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
// ネットワーク詰まりでpre-pushフックが固まり全pushをブロックしないよう、1試行ごとに打ち切る
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS) || 120 * 1000;

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// idea-layouts.json は git 非追跡。ローカル本体が存在し、かつ inputHash がHEADのmanifestと一致する
// 場合だけ送る（古い/別の本体をBlobへ上げて本番レイアウトを壊さない）。cases/ideas は常に対象
function ideaLayoutsUploadable() {
  try {
    const manifest = JSON.parse(
      execFileSync("git", ["show", "HEAD:data/idea-layouts.manifest.json"], { cwd: path.join(__dirname, ".."), encoding: "utf-8" }),
    );
    const bodyHash = readLocalLayoutsInputHash(path.join(DATA_DIR, "idea-layouts.json"));
    if (bodyHash === manifest.inputHash) return true;
    console.warn("[upload-public-data] 警告: ローカルのidea-layouts.jsonがHEADのmanifestと不一致のため、このファイルはアップロードしません");
  } catch (e) {
    console.warn(`[upload-public-data] 警告: idea-layouts.jsonを検証できないためアップロードしません: ${e instanceof Error ? e.message : e}`);
  }
  return false;
}

const uploadNames = PUBLIC_DATA_FILES.filter((n) => n !== "idea-layouts.json" || ideaLayoutsUploadable());
const texts = {};
for (const name of uploadNames) {
  texts[name] = buildPublicDataText(name, fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
}
const hashes = Object.fromEntries(uploadNames.map((n) => [n, sha256Text(texts[n])]));

const state = readJsonSafe(STATE_PATH) ?? {};
const targets = filesNeedingUpload(hashes, state, { force }).filter((n) => n in texts);
if (targets.length === 0) {
  console.log("[upload-public-data] 変更なし（前回アップロード済みと同一）");
  process.exit(0);
}
console.log(`[upload-public-data] アップロード対象: ${targets.join(", ")}${dryRun ? " (dry-run)" : ""}`);
if (dryRun) process.exit(0);

const cfg = readJsonSafe(FAVSYNC_CONFIG_PATH);
if (!cfg?.endpoint || !cfg?.token) {
  console.error(`[upload-public-data] ${FAVSYNC_CONFIG_PATH} に endpoint/token がありません`);
  process.exit(1);
}
const handleUploadUrl = process.env.DATA_UPLOAD_URL || uploadUrlFromEndpoint(cfg.endpoint);

// pre-pushフックを長時間ブロックしないよう全体の予算も持つ（超過後は残りの試行をしない。次回pushで再試行）
const DEADLINE = Date.now() + (Number(process.env.UPLOAD_BUDGET_MS) || 4 * 60 * 1000);

let failed = 0;
for (const name of targets) {
  const raw = Buffer.from(texts[name]);
  // Vercelのオンザフライ圧縮(65MB級で約18MB)より、窓16MB・品質9の事前圧縮のほうが小さい(約8MB)。
  // 品質11だと約75秒かかるため9で妥協（約9秒）
  const body = zlib.brotliCompressSync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  let ok = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok && Date.now() < DEADLINE; attempt++) {
    try {
      const res = await withTimeout(uploadPresigned(`public-data/${name}.br`, body, {
        access: "private",
        handleUploadUrl,
        headers: { authorization: `Bearer ${cfg.token}` },
        contentType: "application/octet-stream",
        multipart: body.length > MULTIPART_THRESHOLD,
        abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      }), UPLOAD_TIMEOUT_MS, `upload ${name}`);
      state[name] = hashes[name];
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
      console.log(`✓ ${name}: ${(raw.length / 1024).toFixed(0)} KB → br ${(body.length / 1024).toFixed(0)} KB → ${res.url}`);
      ok = true;
    } catch (err) {
      console.error(`[upload-public-data] ${name} 試行${attempt}/${MAX_ATTEMPTS}失敗: ${err instanceof Error ? err.message : err}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
