/**
 * デプロイ反映検証。push 後に本番(Vercel)が最新コミットを反映したか確認する。
 * 「収集→push だけで終わらせず、確実にライブへ反映まで見届ける」ための最終ゲート。
 *
 * 判定:
 *   1. origin/main == ローカルHEAD（push が実際に landed したか）
 *   2. 本番トップページが HTTP 200
 *   3. 追加サムネ（引数で渡した /thumbnails/xxx.jpg）がライブでローカルと同一ハッシュで配信されるか
 *   4. 直近追加事例の詳細ページ（/cases/<id>）が本番で 200 を返すか
 *      ※旧ビルドでもトップは200を返すため、これが「新ビルドが実際に出た」ことの証明になる。
 *        /tmp/researchman-last-add.json（auto-research-cc.mjs が実行毎に書く）から自動取得。
 * 最大 ~6分ポーリング。全条件満たせば exit 0、時間切れは exit 1。
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
const MAX_TRIES = 45;      // 45回 × ~8秒 ≒ 6分（SSG 450ページ超のVercelビルドは3分を超えることがある）
const INTERVAL_MS = 8000;
const LAST_ADD_PATH = "/tmp/researchman-last-add.json";
// 古いサマリーで誤検証しない。verify-deployはpush直後の同一パイプライン実行内で
// 即座に読むため2hで十分短い（notify-line.mjsのSUMMARY_MAX_AGE_MS=6hより厳しいのは意図的。
// notify-line側はロック待ち・キャッチアップ実行での遅延を許容する必要があるため）
const LAST_ADD_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const thumbs = process.argv.slice(2).filter((a) => a.startsWith("/thumbnails/"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

function fetchBuf(url) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const req = https.get(url, { headers: { "User-Agent": "verify-deploy" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return settle({ status: res.statusCode, buf: null }); }
      const ch = [];
      const finish = () => settle({ status: 200, buf: Buffer.concat(ch) });
      res.on("data", (d) => ch.push(d));
      res.on("end", finish);
      // 本文受信中に接続が切れてもPromiseを必ず解決する（未解決awaitでプロセスが静かに死ぬのを防ぐ）
      res.on("close", finish);
      res.on("error", finish);
    });
    req.on("error", () => settle({ status: 0, buf: null }));
    req.setTimeout(15000, () => { settle({ status: 0, buf: null }); req.destroy(); });
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

// 直近実行で追加された事例の詳細ページを「新ビルドが出た」証拠として検証する。
// --skip-pages 指定時は省略（Technology日次パイプライン用。tech側の新規ページ検証は
// verify-tech-pages.mjs が担うため、Case Study用サマリーをここで読むと誤検証になる）
let newCasePaths = [];
if (!process.argv.includes("--skip-pages")) {
  try {
    const st = fs.statSync(LAST_ADD_PATH);
    if (Date.now() - st.mtimeMs < LAST_ADD_MAX_AGE_MS) {
      const lastAdd = JSON.parse(fs.readFileSync(LAST_ADD_PATH, "utf-8"));
      newCasePaths = (lastAdd.cases || []).slice(0, 2).map((c) => `/cases/${c.id}`);
    }
  } catch {}
}
if (newCasePaths.length) console.log(`[verify-deploy] 新規ページ検証対象: ${newCasePaths.join(", ")}`);

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
  let pagesOk = true;
  for (const p of newCasePaths) {
    const r = await fetchBuf(SITE + p);
    if (r.status !== 200) { pagesOk = false; break; }
  }
  if (landed && home.status === 200 && thumbsOk && pagesOk) { ok = true; console.log(`[verify-deploy] ✓ 反映確認（試行${i}回目）: push landed / home 200 / thumbs一致 / 新規ページ${newCasePaths.length}件 200`); break; }
  if (i === MAX_TRIES) {
    console.log(`[verify-deploy] ⏳ 時間切れ: landed=${landed} home=${home.status} thumbs=${thumbsOk} pages=${pagesOk}`);
  } else {
    await sleep(INTERVAL_MS);
  }
}

process.exit(ok ? 0 : 1);
