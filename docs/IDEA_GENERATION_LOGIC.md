# アイデア出しロジック（現状まとめ・2026-07-16時点）

RMのアイデア生成は**2系統**ある。同じ `data/ideas.json` / `data/idea-layouts.json` に書き込み、`/ideas` ページに表示される。

| | A. テーマ駆動（LINE/Studio「アイデア出し」） | B. デイリー「アイデアの種」 |
|---|---|---|
| 入口 | LINEメニュー4番 / POST /api/jobs (tab:"idea") | タスクスケジューラ 毎朝10:15（毎正時キャッチアップ） |
| 本体 | `studio/server/pipeline/ideaResearch.ts` | `scripts/generate-idea-seeds.mjs` |
| 発想の骨格 | **切り口(angle)** = `data/idea-angles.json`（22語彙） | **patternMix** = `data/idea-tuning.json` |
| お題 | theme必須 + constraint/source/count | なし（ランダムサンプリング） |
| id | `studio-<date>-N` | `<date>-N` |

## A. テーマ駆動の流れ

1. **入力**: theme（必須）/ constraint（プロンプトに添える縛り）/ source（「全事例から」or「お気に入り中心」）/ count（1〜10、既定6）/ dryRun（省略可。trueなら採点・改稿までを実行し反映以降をスキップしてjob.ideaPreviewに記録。E2E検証用）
2. **切り口を選定** — `data/idea-angles.json` の22語彙（見立て変換・媒体の物理特性活用・引き算/不在・制約を武器に・虚構の実在化など。全事例からClaudeが帰納生成した「発想の型」で、各切り口に体現事例2〜6件が紐づく）から count 個を選ぶ。「お気に入り中心」の場合、お気に入り事例を体現例に持つ切り口の重みを `1 + 該当数×3` に引き上げる
3. **検索キーワード抽出** — haikuでthemeから日本語キーワード3〜6個
4. **関連事例・技術を検索** — 事例は `search-cases.mjs`（キーワードOR検索、max(8, count×2)件）、技術はin-processスコアリング（title+5/domains+4/summary+3/point+1、max(6, count)件）。ここで提示したidの集合が後の参照許可リストになる
5. **咀嚼**（ヤング『アイデアのつくり方』②相当。2026-07-16追加）— 生成前に素材を要素分解し、切り口ごとに有望な組み合わせ候補（部分アイデア）を2〜3個書き出す（Sonnet1回・全切り口まとめてbatch）。enhancerでありゲートではない: 呼び出し失敗・JSON解析失敗は空配列にフォールバックし、そのまま次段（直接生成）へ進む
6. **アイデア生成** — 各切り口＋体現事例(最大3)＋テーマ関連の事例/技術＋咀嚼結果（部分アイデア候補。あれば）を材料に、Sonnetが1パス生成（最大3リトライ）。出力には各案の`rationale`（なぜこの組み合わせが効くかの1行言語化）も必須項目として含める（欠落しても案自体は捨てず空文字で保存）
7. **機械検証**（1つでも外れた案は捨てる）:
   - seedが「〜かも。」で終わる形式
   - patternが今回選んだ切り口のlabelと一致（勝手なパターン名を排除）
   - 既視感チェック: 既存ideas.json＋今回採用分との正規化title/seed重複
   - refsは**プロンプトで提示した実在idのみ**（ハルシネーションid排除）
   - 通過0件なら失敗
8. **採点→改稿→再検証**（ヤング⑤相当。質の批評→育成。2026-07-16追加）— 機械検証を通過した案全件をSonnet1回でbatch採点（discovery/surprise/conviction各1〜5、15点満点）。合計が改稿閾値(11点)未満の案はSonnet1回でbatch改稿（切り口は変更禁止。指摘note付き）→ **改稿後も機械検証を必ず再通過**させる（通過しなければ破棄）→ 再採点し、破棄閾値(8点)未満なら破棄。採点・改稿の呼び出し自体が失敗した場合はenhancer方針で「無採点のまま元の案を通す」。count未達（採点・改稿を経ても依頼数に届かない）は警告付きで続行、全滅（1件も残らない）なら失敗
9. **反映** — ideas.json追記 → レイアウト事前計算（`precompute-idea-layouts.mjs`。3ティア分のシェイプ・配置を計算。Vercelビルド凍結事故の教訓でビルド外に分離。2026-07-15に高速化・rename堅牢化済み）→ next build監査 → ideas.json+idea-layouts.jsonを**必ずペアで**commit/push（pre-pushの鮮度検査が入力ハッシュ一致を強制）→ /ideasに新規id全件が出るまでポーリング → LINE通知

## B. デイリー「アイデアの種」の流れ

1. 毎朝、cases.jsonから **caseSample:14件** / tech.jsonから **techSample:12件** をサンプリング（`samplingWeights` でタグ/ドメイン別の倍率調整可。既定は一様）
2. **patternMix** の比率で種を **seedCount:10個** 生成:
   - contextXTech 0.4 — 事例の文脈×技術「この課題をこの技術で解けるかも」
   - techXTech 0.2 — 技術A×技術B「組み合わせたらこんな表現ができるかも」
   - repurpose 0.2 — 転用「本来と違う使い方をしたら役立つかも」
   - free 0.2 — 自由枠
3. 軽い検証（seed必須・5個未満リトライ・seed完全一致の重複スキップ）→ LINE配信が本務 → ideas.json追記＋レイアウト計算＋commit/push

## チューニングの場所

- **Aの発想の幅** → `data/idea-angles.json`（切り口語彙。`generateIdeaAnglesCli.ts` で全事例から再生成可能。15〜25語彙）
- **Aの採点閾値** → `studio/server/pipeline/ideaPure.ts` の `IDEA_CRITIQUE_REVISE_THRESHOLD`（改稿対象。既定11/15点）・`IDEA_CRITIQUE_DISCARD_THRESHOLD`（改稿後破棄。既定8/15点）
- **Bの傾向** → `data/idea-tuning.json`（patternMix・サンプリング件数/重み・promptText）。**週次チューンアップ**（毎週月曜08:30）が、お気に入り分布＋ごみ箱（負のシグナル）＋ユーザー追加事例（sources:"User"）から自動改訂する（ガードレール・dry-run検証つき）
- 両系統ともデイリー収集と同じgitロックで直列化。テーマ駆動はデイリージョブ実行中だと即エラーを返す

## 主要ファイル

- `studio/server/pipeline/ideaResearch.ts` / `ideaPure.ts` / `ideaPrompts.ts` / `ideaAngles.ts` — A系統
- `scripts/generate-idea-seeds.mjs` — B系統
- `scripts/precompute-idea-layouts.mjs` — レイアウト事前計算（共通）
- `data/idea-angles.json` / `data/idea-tuning.json` / `data/ideas.json` / `data/idea-layouts.json`
