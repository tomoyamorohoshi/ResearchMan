// Researching画面の「残り 〜XX分程度」表示。
// サーバの progress 文字列（server/pipeline/caseResearch.ts / ideaResearch.ts の
// setProgress）を前方一致でフェーズに対応づけ、実測ジョブの所要から残り時間の目安を返す。
// 正確さより桁感を優先する（ユーザー合意: ざっくりでOK）。
// フェーズごとの目安はサーバ側で計測できるようになったら置き換える（P4のSSE進捗と同時に）。
const PHASE_ETA_MINUTES: Array<[prefix: string, minutes: number]> = [
  // Research(Case Study)。case-collector/link-checker/award-verifier/case-writerの
  // Agent呼び出しを重ねるため長め（実測: P1 E2E・MVリサーチの2本）。
  ["収集を開始", 20], // クライアント側の初期表示
  ["収集中", 20],
  ["重複チェック", 12],
  ["受賞情報", 10],
  ["執筆", 9],
  ["サムネイル", 7],
  ["オーダータグ", 6],
  // Research(Technology)。Case Studyと所要時間の性質が違う（並列agent呼び出しではなく
  // 発掘+執筆1パスを最大2ラウンド・機械的な死活検証・単発サムネ取得）ため文言を分け、
  // ETAバケットが衝突しないようにする（DESIGN.md §10 P2実装時の指示）。
  // 初期値は auto-research-tech.mjs の実測感（1ラウンドあたり実質数分〜）からの見積り。
  // 実測が取れ次第、他フェーズ同様コメントで更新する。
  ["技術収集を開始", 8], // クライアント側の初期表示
  // adversarial-reviewer指摘#4: 「既存データ読み込み中」（Case Study）と前方一致で
  // 衝突しないよう「技術データ読み込み中」に文言を分け、専用エントリを先行配置する
  // （下の共通プレフィックス「既存データ」20分に誤って当たると、実際は数秒で終わる
  // フェーズに20分残りと表示されてしまう）。
  ["技術データ読み込み中", 1],
  ["技術収集中", 8],
  ["重複・書式を検証中", 1],
  ["技術情報の一次ソースを検証中", 2],
  ["技術サムネイル取得中", 3],
  // idea(テーマ駆動アイディエーション)。Agent呼び出しはキーワード抽出(haiku)+生成(sonnet)の
  // 2回のみで、収集はローカルデータ検索のため切り口選定〜検証は実測で計2分程度と短い
  // （実測: P3 E2E・「空の描き方が美しいMVの企画と演出」6案・全体で約9分52秒。
  // 内訳: 切り口選定〜生成検証=約2分、反映中（データ書き込み。precompute-idea-layouts.mjs
  // 込み）=約7分半（447.1秒） ← ここがidea側の主要ボトルネック、build/commit/verifyは
  // 数十秒。件数(86件)が増えるほどprecomputeは伸びる想定）。
  ["切り口を選定しています", 3], // クライアント側の初期表示
  ["お気に入りを確認中", 3],
  ["切り口を選定中", 2],
  ["検索キーワードを抽出中", 2],
  ["関連事例・技術を検索中", 2],
  ["アイデア生成中", 2],
  ["生成結果を検証中", 1],
  // 以下はResearch/idea共通のプレフィックス（両パイプラインで文言が一致する）。
  // 「反映中（データ」はidea側だとprecompute-idea-layouts.mjsを含み実測7分半かかった
  // （Research側の実測6分より重い）ため、共通値をidea寄りにやや引き上げてある。
  ["既存データ", 20],
  ["一次ソース検証", 12],
  ["反映中（データ", 8],
  ["品質監査", 5],
  ["反映中（commit", 3],
  ["本番反映", 2],
];

export function estimateRemainingMinutes(progress: string | undefined): number | null {
  if (!progress) return null;
  for (const [prefix, minutes] of PHASE_ETA_MINUTES) {
    if (progress.startsWith(prefix)) return minutes;
  }
  return null;
}
