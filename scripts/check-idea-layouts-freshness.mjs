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
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeIdeaLayoutsInputHash } from "./lib/idea-layouts-hash.mjs";
import { decideLocalBodyCheck, readLocalLayoutsInputHash } from "./lib/idea-layouts-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function readFromHead(repoRelPath) {
  return execFileSync("git", ["show", `HEAD:${repoRelPath}`], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 512 * 1024 * 1024, // ideas.jsonは数MB。余裕を持たせる
  });
}

/**
 * 今回のpushが ideas.json か manifest を変えるか（origin/main との差分）。
 * origin/main が無い・diffが失敗した場合は安全側（変更あり=厳格）に倒す。
 * （pre-pushフックはstdinのrefsをこのスクリプトへ渡していないため origin/main 比較を使う）
 */
function pushChangesLayoutInputs() {
  try {
    execFileSync("git", ["diff", "--quiet", "origin/main", "HEAD", "--", "data/ideas.json", "data/idea-layouts.manifest.json"], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return false; // exit 0 = 差分なし
  } catch {
    return true; // exit 1 = 差分あり / それ以外のエラー(origin/main欠落等)も変更扱い
  }
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
  let localHash = null;
  let readError = null;
  try {
    localHash = readLocalLayoutsInputHash(localPath);
  } catch (e) {
    readError = e;
  }
  const changed = pushChangesLayoutInputs();
  const verdict = decideLocalBodyCheck({ changed, bodyHash: localHash, manifestHash: manifest.inputHash });
  if (verdict !== "ok") {
    const detail = readError
      ? `ローカルのdata/idea-layouts.json が読めません（非追跡のため消えていれば再生成が必要）: ${readError.message}`
      : `ローカルのdata/idea-layouts.json がmanifestと一致しません（古い本体をBlobへアップロードしようとしています）。\n  manifestハッシュ = ${manifest.inputHash}\n  ローカル記録ハッシュ = ${localHash}`;
    if (verdict === "fail") {
      console.error(`[idea-layouts鮮度検査] ${detail}`);
      console.error(REGEN_HINT);
      process.exit(1);
    }
    // 今回のpushはideas.json/manifestを変えない（別マシン・無関係なpush）: 本体が無くても止めない。
    // Blobへの本体アップロードはupload-public-data.mjs側が一致時のみ行う
    console.warn(`[idea-layouts鮮度検査] 警告（このpushはideas.json/manifestを変更しないため通過）: ${detail}`);
  }

  console.log(
    "[idea-layouts鮮度検査] OK: manifestはHEADのdata/ideas.jsonと一致し、ローカルのdata/idea-layouts.json もmanifestと一致しています。",
  );
}

main().catch((e) => {
  console.error("[idea-layouts鮮度検査] 予期しないエラー:", e.message);
  process.exit(1);
});
