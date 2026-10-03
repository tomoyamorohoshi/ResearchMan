// data/idea-layouts.json の鮮度検査（DESIGN: goofy-hatching-mango.md 2026-07-08改訂・
// 事前計算方式。2026-10-04: 本体を非追跡化しmanifest方式へ変更）。pre-pushフックから呼ばれ、
// 次の2点を満たさなければpushを拒否する（鮮度の機械保証。ビルド時フォールバックで古い
// レイアウトを黙って使う方が有害という判断のため、フォールバックは作らずここで止める）。
//   (a) SHA256(HEAD:data/ideas.json + ALGO_VERSION) == HEAD:data/idea-layouts.manifest.json の inputHash
//       （pushされる中身での整合。manifestは本体の鮮度証明としてコミットされる）
//   (b) ローカルディスクの data/idea-layouts.json の inputHash == manifest の inputHash
//       （本体は非追跡=68MBのためGitHub上限回避。直後のBlobアップロードが正しい中身を送ることの保証）
//
// tsx不要（重いTSモジュールをimportしない）: pre-pushの度に毎回走るため、起動コストを
// 最小にする目的でハッシュ計算だけを行うプレーンなNode ESMスクリプトにしている。
//
// 重要: (a)の検査対象は**作業ツリーではなくHEAD（=pushされる中身）**。作業ツリーを読むと
// 「ディスク上は更新済みだが、コミットには ideas.json しか入っていない」ケース
// （launchdラッパーの add 漏れ等）を素通しする（2026-07-08レビューで実際に検出した経路）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeIdeaLayoutsInputHash } from "./lib/idea-layouts-hash.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function readFromHead(repoRelPath) {
  return execFileSync("git", ["show", `HEAD:${repoRelPath}`], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 512 * 1024 * 1024, // ideas.jsonは数MB。余裕を持たせる
  });
}

/** ローカル本体の inputHash。先頭数KBに出力される（precomputeが最初のキーに書く）ので全体パースを避ける */
function readLocalLayoutsInputHash(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.toString("utf-8", 0, n).match(/"inputHash"\s*:\s*"([0-9a-f]+)"/);
    if (m) return m[1];
  } finally {
    fs.closeSync(fd);
  }
  // 想定外のキー順の場合だけ全体をパース
  return JSON.parse(fs.readFileSync(filePath, "utf-8")).inputHash;
}

const REGEN_HINT =
  "npx tsx scripts/precompute-idea-layouts.mjs を実行し、data/idea-layouts.manifest.json を**コミットしてから**再度pushしてください。";

async function main() {
  let ideasRawText;
  let manifest;
  try {
    ideasRawText = readFromHead("data/ideas.json");
    manifest = JSON.parse(readFromHead("data/idea-layouts.manifest.json"));
  } catch (e) {
    console.error(`[idea-layouts鮮度検査] HEADのdata/ideas.json / data/idea-layouts.manifest.jsonが読めません: ${e.message}`);
    console.error(REGEN_HINT);
    process.exit(1);
  }
  const expectedHash = computeIdeaLayoutsInputHash(ideasRawText);

  if (manifest.inputHash !== expectedHash) {
    console.error(
      "[idea-layouts鮮度検査] HEADのdata/idea-layouts.manifest.json がHEADのdata/ideas.jsonと一致しません（古いレイアウトをpushしようとしています）。",
    );
    console.error(`  期待ハッシュ = ${expectedHash}`);
    console.error(`  記録ハッシュ = ${manifest.inputHash}`);
    console.error(REGEN_HINT);
    process.exit(1);
  }

  const localPath = path.join(ROOT, "data/idea-layouts.json");
  let localHash;
  try {
    localHash = readLocalLayoutsInputHash(localPath);
  } catch (e) {
    console.error(`[idea-layouts鮮度検査] ローカルのdata/idea-layouts.json が読めません（非追跡のため消えていれば再生成が必要）: ${e.message}`);
    console.error(REGEN_HINT);
    process.exit(1);
  }
  if (localHash !== manifest.inputHash) {
    console.error(
      "[idea-layouts鮮度検査] ローカルのdata/idea-layouts.json がmanifestと一致しません（古い本体をBlobへアップロードしようとしています）。",
    );
    console.error(`  manifestハッシュ = ${manifest.inputHash}`);
    console.error(`  ローカル記録ハッシュ = ${localHash}`);
    console.error(REGEN_HINT);
    process.exit(1);
  }

  console.log(
    "[idea-layouts鮮度検査] OK: manifestはHEADのdata/ideas.jsonと一致し、ローカルのdata/idea-layouts.json もmanifestと一致しています。",
  );
}

main().catch((e) => {
  console.error("[idea-layouts鮮度検査] 予期しないエラー:", e.message);
  process.exit(1);
});
