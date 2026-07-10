# ResearchMan Studio（ローカル専用）

RM（ResearchMan、Next.js 本体・Vercelデプロイ）とは完全に独立した、ローカル専用の
Node.js アプリです。「テーマ指定リサーチ」と「アイデア生成」を UI から実行するための
骨組み（P0）です。

P0 時点では実データ収集（Claude Agent SDK 等）は未実装で、ダミーの結果カードを返します。
実収集・SSE 進捗・ジョブ履歴充実・コスト上限・LINE通知などは P1 以降で追加します。

## 起動

```bash
npm run studio:install   # 初回のみ（studio/ 配下の依存をインストール）
npm run studio           # サーバ起動。既定で http://localhost:5178 を自動で開く
```

## 環境変数

- `STUDIO_PORT` — サーバのポート番号（既定 5178）。
- `STUDIO_NO_OPEN` — 何か値を設定するとサーバ起動時のブラウザ自動起動を抑制する
  （自動テスト実行時など）。
- `ANTHROPIC_API_KEY` — P1 以降、実リサーチ/アイデア生成で使用予定。P0 では未使用。

## データ

ジョブ履歴は `studio/workdir/jobs/<id>.json` に保存されます
（`workdir/` はルート `.gitignore` で無視対象）。
