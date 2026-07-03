/**
 * 発見プロンプトに渡す既存タイトル文字列の組み立て。
 * 600件以下は全件（現状455件・挙動不変）。600件超なら「直近400＋ランダム200」に切替え、
 * プロンプトの肥大化・レイテンシ悪化を抑える。ただし機械照合(existingIds/existingTitleKeys)は
 * 呼び出し側で別途常に全件行うため、しきい値超でも重複は確実に弾かれる（この関数はプロンプト表示用のみ）。
 * cases配列は新しい事例ほど先頭にある前提（auto-research-cc.mjsは [...toAdd, ...existingCases] で追記）。
 *
 * auto-research-cc.mjs本体（importするとmain()が即実行される）とは別モジュールに置く。
 * こうしないとこの関数を単体テストするための import だけで本番収集（Claude CLI呼び出し・
 * cases.json書き換え）が走ってしまう（2026-07-04に実際に踏んだ事故）。
 */
const EXISTING_TITLES_THRESHOLD = 600;
const EXISTING_TITLES_RECENT = 400;
const EXISTING_TITLES_RANDOM = 200;

export function buildExistingTitlesText(cases) {
  if (cases.length <= EXISTING_TITLES_THRESHOLD) {
    return { text: cases.map((c) => c.title).join(" / "), mode: "full" };
  }
  const recent = cases.slice(0, EXISTING_TITLES_RECENT);
  const rest = cases.slice(EXISTING_TITLES_RECENT);
  const pool = [...rest];
  const sample = [];
  for (let i = 0; i < EXISTING_TITLES_RANDOM && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    sample.push(pool.splice(idx, 1)[0]);
  }
  return {
    text: [...recent, ...sample].map((c) => c.title).join(" / "),
    mode: `recent${EXISTING_TITLES_RECENT}+random${EXISTING_TITLES_RANDOM}`,
  };
}
