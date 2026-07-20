/**
 * Agent生出力のデバッグダンプ（全パース失敗箇所で共通利用）。
 *
 * job 66218d63の死因対策: パース失敗時にAgentの生出力(writerResult.text等)をどこにも
 * 保存せず捨てていたため、実際に何が返ってきて何故パースに失敗したのか事後に確認できず
 * 死因特定が不可能だった。パース失敗のたびに studio/workdir/debug/<jobId>-<label>.txt へ
 * 保存し、呼び出し側のエラー/警告メッセージに保存パスを含めることで可観測性を持たせる。
 *
 * studio/workdir/ は .gitignore 済み（ローカル専用の実行時生成物）のため、ここで書き出す
 * ファイルもリポジトリに混入しない。
 *
 * レビュー指摘C: ダンプはあくまで補助的なデバッグ情報のため、この関数自体（mkdir/writeFile）
 * が例外を投げるとパース失敗時の部分成功設計（一部のチャンク/ケースが失敗しても他は成功
 * させる設計）を巻き込んで全滅させてしまう。内部で例外を捕捉しconsole.warnするだけに留め、
 * 保存に失敗した場合はundefinedを返す（throwしない）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @param workdir studio/workdir の絶対パス（呼び出し側がROOTから組み立てて渡す）。
 * @param jobId ジョブID。
 * @param label 失敗箇所を示す短いラベル（例: "writer-chunk-0", "link-verify"）。
 * @param text 保存するAgent生出力テキスト。
 * @returns 保存先の絶対パス。保存に失敗した場合はundefined（throwしない）。
 */
export async function dumpAgentDebug(
  workdir: string,
  jobId: string,
  label: string,
  text: string,
): Promise<string | undefined> {
  const dir = path.join(workdir, "debug");
  try {
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${jobId}-${label}.txt`);
    await writeFile(filePath, text, "utf-8");
    return filePath;
  } catch (err) {
    console.warn(`[studio] dumpAgentDebug failed to save debug dump (jobId=${jobId}, label=${label}):`, err);
    return undefined;
  }
}
