// scripts/auto-research-cc.mjs の発見プロンプト生成・ラウンド埋め合わせロジックの単体検証。
// 実Claude CLI呼び出し・実ファイルI/Oなしに純関数として検証する（TDD: 実装前にこのテストを
// 書き、失敗を確認してから修正した）。
//
// 検証対象の背景: data/cases.json のコミット差分実測で、直近3日間(8/15〜8/17)の新規事例
// 14件中10件(71%)がTech/Gameタグに偏った。原因は Round2 の diversity 指示が広告キャンペーン
// にだけ上限をかけ、ゲーム/XRに上限が無い非対称設計だったこと、および発見フェーズがラウンド
// 単位で失敗（タイムアウト等）した際に埋め合わせが無く、その日の採用が残りラウンドのフォーカス
// （実質ゲーム寄り）に全て寄ってしまったこと。
//
// 実行: node scripts/smoke-auto-research-cc-prompts.mjs
import { buildDiscoveryPrompt, shouldAddMakeupRound } from "./auto-research-cc.mjs";
import { localDayIndex } from "./lib/day-index.mjs";
import researchTuning from "../data/research-tuning.json" with { type: "json" };

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

const roundFoci = researchTuning.cc.roundFoci;
const baseArgs = { lastRunDate: new Date("2026-08-10T00:00:00+09:00"), existingTitles: "（既存タイトルなし）", seenThisRun: [] };

// ── Round2（テック/ゲーム/XRフォーカス）にゲーム/VR上限が入っている ──
{
  const now = new Date();
  const idx2 = roundFoci.findIndex((f) => /ゲーム/.test(f.label) && /テック|プロダクト/.test(f.label));
  assert(idx2 !== -1, "roundFociにテック・ゲーム・XRフォーカスが存在する");
  // このフォーカスが選ばれるround番号を逆算する
  const dayIdx = localDayIndex(now);
  const round = ((idx2 - dayIdx) % roundFoci.length + roundFoci.length) % roundFoci.length + 1;
  const prompt = buildDiscoveryPrompt({ ...baseArgs, round, roundFoci });
  assert(prompt.includes(roundFoci[idx2].label), "Round2のフォーカスラベルがプロンプトに含まれる");
  assert(/ゲーム.{0,6}(最大|上限)|(最大|上限).{0,6}ゲーム/.test(roundFoci[idx2].diversity), "research-tuning.jsonのRound2 diversityにゲーム/VR件数の上限指示が含まれる");
  assert(/[XVR]{1,3}/.test(roundFoci[idx2].diversity) || /XR|VR/.test(roundFoci[idx2].diversity), "Round2 diversityにXR/VRへの言及がある");
}

// ── Round1（広告キャンペーンフォーカス）の上限指示が従来どおり維持されている ──
{
  const idx1 = roundFoci.findIndex((f) => /広告/.test(f.label));
  assert(idx1 !== -1, "roundFociに広告キャンペーンフォーカスが存在する");
  assert(/広告賞ネタは全体の半分以下/.test(roundFoci[idx1].diversity), "Round1 diversityの広告賞上限指示が従来どおり維持されている");
}

// ── ラウンドローテーションが従来どおり日替わりで動く（回帰防止） ──
{
  const now = new Date();
  const dayIdx = localDayIndex(now);
  for (let round = 1; round <= 3; round++) {
    const expectedFocus = roundFoci[(dayIdx + round - 1) % roundFoci.length];
    const prompt = buildDiscoveryPrompt({ ...baseArgs, round, roundFoci });
    assert(prompt.includes(expectedFocus.label), `round=${round}: localDayIndexベースのローテーションで期待フォーカス「${expectedFocus.label.slice(0, 12)}...」が選ばれる`);
  }
}

// ── ラウンド失敗時の埋め合わせ: shouldAddMakeupRound ──
{
  assert(
    shouldAddMakeupRound({ makeupAlreadyAdded: false, elapsedMs: 0, budgetMs: 1000 }) === true,
    "未埋め合わせ・時間内なら埋め合わせを追加する"
  );
  assert(
    shouldAddMakeupRound({ makeupAlreadyAdded: true, elapsedMs: 0, budgetMs: 1000 }) === false,
    "既に埋め合わせ済みなら追加しない（1日1回だけに上限する）"
  );
  assert(
    shouldAddMakeupRound({ makeupAlreadyAdded: false, elapsedMs: 2000, budgetMs: 1000 }) === false,
    "総経過時間が上限を超えていたら追加しない（総実行時間の無制限な増大を防ぐ）"
  );
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
} else {
  console.log("\n全テストPASS: auto-research-cc-prompts");
}
