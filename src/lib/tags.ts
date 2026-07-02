// ハッシュタグの統制語彙（client/server 両用の純粋関数）。
//
// 命名規則: `<軸>/<キーワード>` の2階層。軸は3つ：
//   - "Tech"  … 使われている技術（何で作られているか）    例: Tech/AI, Tech/XR
//   - "Form"  … アウトプットの形式（何として世に出たか）  例: Form/Film, Form/Exhibition
//   - "Theme" … 題材・文脈（何についてか）                例: Theme/Music, Theme/Sports
//
// アイデア発想時の逆引きを想定した設計：
//   「AIを使った事例」→ #AI、「展示・インスタレーション」→ #Exhibition、
//   「音楽まわり」→ #Music のように、軸をまたいで検索・絞り込みできる。
// 表示は "#" + キーワード部分のみ（Tech/AI → #AI）。格納値はフルパスで一意性を保つ。
//
// 語彙を増やすときはここに1行足す（自由記述タグは禁止＝表記ゆれ防止）。

import vocabulary from "../../data/tag-vocabulary.json";

export type TagAxis = "Tech" | "Form" | "Theme";

export const TAG_AXES: TagAxis[] = ["Tech", "Form", "Theme"];

// 軸ごとの統制語彙。単一ソースは data/tag-vocabulary.json
// （scripts/auto-research-cc.mjs などNode側スクリプトも同じJSONを読む）。
// 各タグの意味:
//   Tech/AI=生成AI・ML, Tech/XR=AR/VR/MR/メタバース, Tech/Game=ゲーム(エンジン)活用,
//   Tech/Web=インタラクティブWeb, Tech/Data=データ活用, Tech/Robotics=ロボット・ドローン,
//   Tech/3D=3Dスキャン/プリント/CG, Tech/Device=ハードウェア, Tech/Projection=投影・照明,
//   Tech/Audio=音声・音響技術
//   Form/Film=映像・CM, Form/MV=ミュージックビデオ, Form/Website, Form/App, Form/SNS,
//   Form/Event=イベント・フェス, Form/Exhibition=展示, Form/Installation=体験装置,
//   Form/OOH=屋外・交通, Form/Product=プロダクト・パッケージ, Form/Print, Form/Stunt=PR施策
//   Theme/Music, Theme/Sports, Theme/Fashion, Theme/Art=アート・カルチャー,
//   Theme/Entertainment=エンタメ・アニメ・映画, Theme/Food, Theme/Health, Theme/Education,
//   Theme/SocialGood=社会課題, Theme/Sustainability, Theme/Retail=小売・コマース, Theme/Mobility
export const TAG_VOCABULARY: Record<TagAxis, string[]> = vocabulary as Record<
  TagAxis,
  string[]
>;

export const ALL_TAGS: string[] = TAG_AXES.flatMap((a) => TAG_VOCABULARY[a]);

const tagSet = new Set(ALL_TAGS);

export function isValidTag(tag: string): boolean {
  return tagSet.has(tag);
}

// "Tech/AI" → "AI"（チップ表示用。呼び出し側で "#" を付ける）
export function tagLabel(tag: string): string {
  const i = tag.indexOf("/");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

export function tagAxis(tag: string): TagAxis | undefined {
  const axis = tag.split("/")[0] as TagAxis;
  return TAG_AXES.includes(axis) ? axis : undefined;
}
