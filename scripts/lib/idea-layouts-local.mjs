// data/idea-layouts.json（git非追跡の本体）に関する共有ヘルパ。
// check-idea-layouts-freshness.mjs（pre-push検査）と upload-public-data.mjs（Blob送信）で共用する。
import fs from "node:fs";

/**
 * ローカル本体の inputHash。precomputeが最初のキーとして先頭に書くので先頭4KBの正規表現で読み、
 * 全体パース(68MB)を避ける。取れない場合のみ全体をパースする。ファイルが無ければ throw。
 */
export function readLocalLayoutsInputHash(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.toString("utf-8", 0, n).match(/"inputHash"\s*:\s*"([0-9a-f]+)"/);
    if (m) return m[1];
  } finally {
    fs.closeSync(fd);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")).inputHash;
}

/**
 * 検査(b)「ローカル本体 == manifest」の判定。
 * - 本体が一致: "ok"
 * - 不一致/欠落かつ今回のpushが ideas.json か manifest を変える: "fail"（厳格。Blobへ正しい本体を送れない）
 * - 不一致/欠落だが今回のpushは無関係（別マシン・別件push）: "warn"（通す。(a)は常に厳格）
 * bodyHash: 本体が無い/読めないとき null
 */
export function decideLocalBodyCheck({ changed, bodyHash, manifestHash }) {
  if (bodyHash !== null && bodyHash !== undefined && bodyHash === manifestHash) return "ok";
  return changed ? "fail" : "warn";
}
