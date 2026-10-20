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
import { lensOrderForDay } from "./lib/case-lenses.mjs";
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

// ── v3: レンズ4（新しい表現手法・テクノロジー表現）にゲーム/VR上限が入っている ──
{
  const idx4 = roundFoci.findIndex((f) => /表現手法/.test(f.label));
  assert(idx4 !== -1, "roundFociに新しい表現手法レンズが存在する");
  const order = lensOrderForDay(localDayIndex(new Date()), roundFoci.length);
  const round = order.indexOf(idx4) + 1;
  const prompt = buildDiscoveryPrompt({ ...baseArgs, round, roundFoci });
  assert(prompt.includes(roundFoci[idx4].label), "レンズ4のラベルがプロンプトに含まれる");
  assert(/ゲーム.{0,6}(最大|上限)|(最大|上限).{0,6}ゲーム/.test(roundFoci[idx4].diversity), "research-tuning.jsonのレンズ4 diversityにゲーム/VR件数の上限指示が含まれる");
  assert(/XR|VR/.test(roundFoci[idx4].diversity), "レンズ4 diversityにXR/VRへの言及がある");
}

// ── レンズ1（広告）の上限指示が従来どおり維持されている ──
{
  const idx1 = roundFoci.findIndex((f) => /広告/.test(f.label));
  assert(idx1 !== -1, "roundFociに広告フォーカスが存在する");
  assert(/広告賞ネタは全体の半分以下/.test(roundFoci[idx1].diversity), "レンズ1 diversityの広告賞上限指示が従来どおり維持されている");
}

// ── 4レンズが毎日1回ずつ回る（日替わりなのは開始位置だけ） ──
{
  const now = new Date();
  const order = lensOrderForDay(localDayIndex(now), roundFoci.length);
  assert(new Set(order).size === roundFoci.length, "当日のレンズ順は全レンズの順列");
  for (let round = 1; round <= roundFoci.length; round++) {
    const expectedFocus = roundFoci[order[round - 1]];
    const prompt = buildDiscoveryPrompt({ ...baseArgs, round, roundFoci });
    assert(prompt.includes(expectedFocus.label), `round=${round}: 当日のレンズ順で期待フォーカス「${expectedFocus.label.slice(0, 12)}...」が選ばれる`);
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
