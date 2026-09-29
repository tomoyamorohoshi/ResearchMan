/**
 * assignShapeKinds(src/lib/ideaCollageLayout.ts)のidea単位・永続キャッシュ。
 *
 * 背景: assignShapeKindsはidea1件あたり約6秒(最大39回のsolveFixedSizeShape全探索)で、900件だと
 * 約80分かかる。結果はideaごとの入力だけで決まる決定論的な純関数なので、毎日変更のない
 * 約890件を再計算する必要は無い。キャッシュヒット時は保存済みの{kind, generous}を返すだけで、
 * 出力(data/idea-layouts.json)はキャッシュ有無でバイト等価になる(=ALGO_VERSIONを上げる必要なし)。
 *
 * キャッシュキー = sha256(salt + idea入力全部)。
 * - salt: ALGO_VERSION・関連ソースファイルの内容ハッシュ(コード指紋)・フォント/行幅定数。
 *   ideaShapes.ts等を編集してALGO_VERSIONの更新を忘れても、指紋が変わるため古い結果は使い回されない。
 * - idea入力: id(hashId由来のデフォルト種・ジッタ)・title・dateLabel・seed・refs全体
 *   (solveFixedSizeShapeに渡る全入力。refsは順序・desc含む全フィールドをJSONで畳み込む)。
 *
 * 保存先は既定でリポジトリ外(~/.researchman/cache/)。デプロイ肥大・git汚染を避けるため。
 * 破損・読み書き失敗はすべて握りつぶして全計算にフォールバックする(機能を壊さない)。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_FILE_VERSION = 1;

export function defaultShapeCachePath() {
  return (
    process.env.IDEA_SHAPE_CACHE_PATH ||
    path.join(os.homedir(), ".researchman", "cache", "idea-shape-assignments.json")
  );
}

/** 関連ソースファイル群の内容ハッシュ。1文字でも変われば別値になる。 */
export function computeCodeFingerprint(filePaths) {
  const h = crypto.createHash("sha256");
  for (const p of filePaths) {
    h.update(path.basename(p)).update("\0").update(fs.readFileSync(p)).update("\0");
  }
  return h.digest("hex");
}

/** 形状決定に影響するidea外の入力(バージョン・コード指紋・フォント/幅定数)を1つの文字列にまとめる。 */
export function buildShapeCacheSalt({ algoVersion, codeFingerprint, constants }) {
  return JSON.stringify([algoVersion, codeFingerprint, constants]);
}

/** idea1件のキャッシュキー。JSON配列でシリアライズするので連結による境界衝突は起きない。 */
export function shapeAssignmentCacheKey(idea, salt) {
  const payload = JSON.stringify([salt, idea.id, idea.title, idea.dateLabel, idea.seed, idea.refs ?? null]);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function isValidEntry(v, validKinds) {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof v.kind === "string" &&
    validKinds.includes(v.kind) &&
    typeof v.generous === "boolean"
  );
}

function loadEntries(filePath, validKinds, warn) {
  const entries = new Map();
  let text;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    if (e && e.code !== "ENOENT") warn(`idea-shape-cache: 読み込み失敗(全計算にフォールバック): ${e.message}`);
    return entries;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.version === CACHE_FILE_VERSION && parsed.entries && typeof parsed.entries === "object") {
      for (const [k, v] of Object.entries(parsed.entries)) {
        if (isValidEntry(v, validKinds)) entries.set(k, { kind: v.kind, generous: v.generous });
      }
    } else {
      warn("idea-shape-cache: 形式が想定外のため破棄して全計算にフォールバック");
    }
  } catch (e) {
    warn(`idea-shape-cache: 破損しているため破棄して全計算にフォールバック: ${e.message}`);
  }
  return entries;
}

/**
 * ファイル永続のキャッシュを作る。get/set/flush/finalizeはいずれもthrowしない。
 * - get(idea): ヒットなら{kind, generous}、無ければundefined(ヒット・保存したキーは「今回使用」として記録)
 * - set(idea, assignment): メモリに追加
 * - flush(): 読み込み済み+新規の全エントリをtmp→rename(原子的)で書き出す。途中で強制終了しても
 *   それまでの計算結果が残るよう、呼び出し側は進捗ごとに呼ぶ
 * - finalize(): 今回使われなかった古いエントリを掃除して書き出す(ideaが編集・削除された分の肥大防止)
 */
export function createFileShapeCache({ filePath, salt, validKinds, warn = (m) => console.warn(m) }) {
  const entries = loadEntries(filePath, validKinds, warn);
  const touched = new Set();
  let dirty = false;

  function write(keys) {
    const obj = {};
    for (const k of keys) obj[k] = entries.get(k);
    const tmp = `${filePath}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_FILE_VERSION, entries: obj }));
      fs.renameSync(tmp, filePath);
      dirty = false;
    } catch (e) {
      warn(`idea-shape-cache: 書き込み失敗(キャッシュ無しで続行): ${e.message}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // 後始末の失敗は無視
      }
    }
  }

  return {
    get(idea) {
      const key = shapeAssignmentCacheKey(idea, salt);
      const v = entries.get(key);
      if (v) touched.add(key);
      return v ? { kind: v.kind, generous: v.generous } : undefined;
    },
    set(idea, assignment) {
      const key = shapeAssignmentCacheKey(idea, salt);
      entries.set(key, { kind: assignment.kind, generous: assignment.generous });
      touched.add(key);
      dirty = true;
    },
    flush() {
      if (dirty) write([...entries.keys()]);
    },
    finalize() {
      for (const k of [...entries.keys()]) if (!touched.has(k)) entries.delete(k);
      write([...entries.keys()]);
    },
  };
}
