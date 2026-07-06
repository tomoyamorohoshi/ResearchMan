// data/ideas.json の安全な読み書き（generate-idea-seeds.mjs / backfill-idea-seeds.mjs 共用）。
//
// 背景（adversarialレビューで実証された全損経路）: 素朴な
//   try { ideas = JSON.parse(...) } catch {}
// は「ファイルが無い（初回）」と「JSONが壊れている（書き込み中クラッシュ・手編集ミス）」を
// 区別できず、破損時に ideas = [] へリセットして当日分だけを書き戻す＝過去の全カードを
// 無警告で消してそのまま push してしまう。ここでは両者を明確に区別する。
import fs from "node:fs/promises";
import path from "node:path";

/**
 * ideas.json を読む。ファイルが無ければ []（初回として正常）。
 * 存在するのにパースできない場合は「破損」として throw する
 * （呼び出し側は追記を中止すること。上書きすると全損する）。
 */
export async function readIdeasJsonSafe(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const parsed = JSON.parse(raw); // 破損時はここで throw（握り潰さない）
  if (!Array.isArray(parsed)) throw new Error(`${filePath} が配列ではありません`);
  return parsed;
}

/**
 * 原子書き込み: 同一ディレクトリの一時ファイルに書いてから rename する。
 * 書き込み途中のクラッシュ・電源断でも既存ファイルが半端な状態にならない
 * （rename は同一ファイルシステム内でアトミック）。
 */
export async function writeJsonAtomic(filePath, data) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmpPath, filePath);
}
