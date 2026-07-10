# ResearchMan Studio（ローカル専用）

RM（ResearchMan、Next.js 本体・Vercelデプロイ）とは完全に独立した、ローカル専用の
Node.js アプリです。「テーマ指定リサーチ」と「アイデア生成」を UI から実行すると、
裏で Claude Agent SDK がパイプラインを回し、**デイリーの自動収集と同じ完全自動反映**
（収集→検証→commit/push→本番反映確認→LINE通知）で Web の RM に反映します。
承認ステップはありません（品質は機械ガードレール＋事後LINE通知で担保します）。

P0〜P4 全フェーズ実装済みです（DESIGN.md §10）。

## 起動

```bash
npm run studio:install   # 初回のみ（studio/ 配下の依存をインストール）
npm run studio           # サーバ起動。既定で http://localhost:5178 を自動で開く
```

## できること

- **Research タブ**: 種別（**Case Study** / **Technology** / **両方**）＋テーマ＋参照URL
  （任意）＋観点＋件数を指定して実行 → RMのCase/Techカードで結果表示（自動反映済み・
  クリックで本番詳細ページへ）。
- **idea タブ**: テーマ（お題）＋縛り・文脈（任意）＋切り口の源（全事例から／お気に入り
  中心）＋件数を指定して実行 → RMの有機シェイプ（/ideas）カードで結果表示（自動反映済み）。
- **進捗表示（SSE優先）**: 実行中は `GET /api/jobs/:id/stream`（Server-Sent Events）で
  リアルタイムに進捗が更新される。接続に失敗/切断した場合は自動で3秒間隔のポーリングへ
  フォールバックする。
- **ジョブ履歴**: フッターの「ジョブ履歴」リンクから、過去に実行したジョブの一覧（日時・
  タブ・テーマ・状態）を見られる。クリックすると当時の結果カードをそのまま再表示できる
  （承認・編集はできない、閲覧専用）。
- **コスト上限**: ジョブ単位で累積コストを追跡し、予算上限（既定 $5、`STUDIO_JOB_BUDGET_USD`
  で上書き可）を超えた場合はその時点で安全に停止する（commit前ならロールバック、commit後
  は停止のみ）。エラーとしてLINE通知され、ジョブ履歴にも理由が残る。

## 環境変数

- `STUDIO_PORT` — サーバのポート番号（既定 5178）。
- `STUDIO_NO_OPEN` — 何か値を設定するとサーバ起動時のブラウザ自動起動を抑制する
  （自動テスト実行時など）。
- `STUDIO_JOB_BUDGET_USD` — ジョブ単位のコスト予算上限（USD、既定 5）。
- `ANTHROPIC_API_KEY` — 実リサーチ/アイデア生成（Claude Agent SDK）で使用。

## データ

- ジョブ履歴は `studio/workdir/jobs/<id>.json` に保存される
  （`workdir/` はルート `.gitignore` で無視対象）。各ジョブJSONには結果カードに加え、
  commit hash・本番反映URL・累積コスト（`cost`）・フェーズごとの所要時間
  （`phaseDurationsMs`、将来のETA較正用）が記録される。
- 反映先データ（`data/cases.json` / `data/tech.json` / `data/ideas.json` +
  `data/idea-layouts.json`）はRM本体（リポジトリルート）のものをそのまま更新する。
  Studio自体はRMのNext.jsビルド／Vercelデプロイの対象には含まれない
  （ルート `eslint.config.*` で `studio/**` を明示的にlint対象外にしている）。

## テスト

```bash
npm --prefix studio test   # server/**/*.test.ts（node:test、tsx経由）
```

子プロセス・git・実ネットワークを伴うロジック（監査・commit/push・verify-deploy等）は
既存スクリプト同様に自動テスト対象外。ただし危険側の分岐（コスト予算超過・厳密verify
のタイムアウト判定・SSEイベント配送・監査中の非ブロッキング性）は依存注入や実子プロセス
での単体テストで検証している。実際の収集〜本番反映〜LINE通知の一気通貫確認はE2E
（実ジョブ1本の手動実行）で行う。

## 制約・注意

- デイリー3ジョブ（launchd）と `/tmp/researchman-git.lock` を共有する。デイリー実行中は
  Studioからのジョブはロック取得に失敗し、即座にエラーとして返る（デイリー側のような
  待機はしない。ユーザーが画面の前で待っているUIのため）。
- 反映系スクリプト（`scripts/*.mjs`）は無改変で子プロセス呼び出しするのみ。Studio固有の
  ロジック（厳密verify・コスト上限・進捗計測等）はすべて `studio/server/pipeline/` 側に
  閉じている。
