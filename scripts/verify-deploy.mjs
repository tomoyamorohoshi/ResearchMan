/**
 * デプロイ反映検証。push 後に本番(Vercel)が最新コミットを反映したか確認する。
 * 「収集→push だけで終わらせず、確実にライブへ反映まで見届ける」ための最終ゲート。
 *
 * 判定:
 *   1. origin/main == ローカルHEAD（push が実際に landed したか）
 *   2. 本番トップページが HTTP 200
 *   3. 追加サムネ（引数で渡した /thumbnails/xxx.jpg）がライブでローカルと同一ハッシュで配信されるか
 * 最大 ~3分ポーリング。全条件満たせば exit 0、時間切れは exit 1。
 *
 * 使い方: node scripts/verify-deploy.mjs [thumbPath ...]
 *   例) node scripts/verify-deploy.mjs /thumbnails/foo.jpg /thumbnails/bar.jpg
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import https from "https";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SITE = "https://research-man.vercel.app";
const MAX_TRIES = 24;      // 24回 × ~8秒 ≒ 3分
const INTERVAL_MS = 8000;

const thumbs = process.argv.slice(2).filter((a) => a.startsWith("/thumbnails/"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

function fetchBuf(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": "verify-deploy" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode, buf: null }); }
      const ch = [];
      res.on("data", (d) => ch.push(d));
      res.on("end", () => resolve({ status: 200, buf: Buffer.concat(ch) }));
    });
    req.on("error", () => resolve({ status: 0, buf: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, buf: null }); });
  });
}

const localHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();

async function pushLanded() {
  try {
    const remote = execSync("git ls-remote origin -h refs/heads/main", { cwd: ROOT })
      .toString().trim().split(/\s+/)[0];
    return remote === localHead;
  } catch { return false; }
}

const localThumbHash = {};
for (const t of thumbs) {
  const p = path.join(ROOT, "public" + t);
  if (fs.existsSync(p)) localThumbHash[t] = md5(fs.readFileSync(p));
}

console.log(`[verify-deploy] HEAD=${localHead.slice(0, 8)} 反映確認中（最大${Math.round(MAX_TRIES * INTERVAL_MS / 1000)}秒）...`);

let ok = false;
for (let i = 1; i <= MAX_TRIES; i++) {
  const landed = await pushLanded();
  const home = await fetchBuf(SITE + "/");
  let thumbsOk = true;
  for (const t of thumbs) {
    if (!localThumbHash[t]) continue;
    const r = await fetchBuf(SITE + t);
    if (!(r.status === 200 && r.buf && md5(r.buf) === localThumbHash[t])) { thumbsOk = false; break; }
  }
  if (landed && home.status === 200 && thumbsOk) { ok = true; console.log(`[verify-deploy] ✓ 反映確認（試行${i}回目）: push landed / home 200 / thumbs一致`); break; }
  if (i === MAX_TRIES) {
    console.log(`[verify-deploy] ⏳ 時間切れ: landed=${landed} home=${home.status} thumbs=${thumbsOk}`);
  } else {
    await sleep(INTERVAL_MS);
  }
}

process.exit(ok ? 0 : 1);
