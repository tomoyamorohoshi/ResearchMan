# LINE webhook を Tailscale Funnel で公開する手順（Windows）

> **注記（2026-07-13〜）**: LINEのWebhook URLはVercel中継（`/api/line-webhook`、
> `src/app/api/line-webhook/route.ts`）が本線。Funnel直結はLINEからの配信成功率が
> 実測12〜37%と不安定だったため中継に切り替えた（詳細はOPERATIONS.md「LINE連携
> （LINEで依頼）」）。本書のFunnel直結手順は、中継のフォールバック/転送先として
> 引き続き必要（中継はこの`/line-webhook`エンドポイントへ転送する構成のため）。

ResearchMan Studio の `POST /api/line-webhook` だけをインターネットに公開し、Studio UI
本体（`/`・`/api/jobs` 等）は非公開（tailnet内のみ）のままにする。実行はユーザーが行う
（このドキュメントはコマンドを書くだけで、実行はしない）。

前提:
- Windows機に Tailscale がインストール・ログイン済みで、このマシンがtailnetに参加している。
- Tailscale管理コンソール（<https://login.tailscale.com/admin>）で **HTTPS Certificates** が
  有効化されている（Studioの Vite 設定で `.ts.net` ホストを許可済み＝MagicDNS運用前提の
  ため、既に有効化されている想定）。
- ResearchMan Studio が起動していて `http://127.0.0.1:5178` で listen している
  （既定ポート。`STUDIO_PORT` を変えている場合はそのポート番号に読み替える）。

## 1. パス限定でリバースプロキシ設定（Serve）

`tailscale serve` で「`/line-webhook` パスだけを Studio のwebhookルートへ転送する」設定を
作る（この時点ではまだインターネットには公開されない。tailnet内のみ）。

```powershell
tailscale serve --bg --set-path /line-webhook http://127.0.0.1:5178/api/line-webhook
```

設定を確認:

```powershell
tailscale serve status
```

## 2. インターネットへ公開（Funnel）

同じ設定をFunnelで公開する。ポートは通常 443（HTTPS）を使う。

```powershell
tailscale funnel 443 on
```

公開状態の確認:

```powershell
tailscale funnel status
```

出力に表示される公開URL（例: `https://<マシン名>.<tailnet名>.ts.net/`）と、このマシンの
MagicDNS名は次のコマンドでも確認できる:

```powershell
tailscale status
```

**Webhook URLは `https://<マシン名>.<tailnet名>.ts.net/line-webhook` になる**
（`/api/line-webhook` ではなく `--set-path` で指定した `/line-webhook` である点に注意。
Studio内部のパス `/api/line-webhook` へは `tailscale serve` の設定がプロキシしてくれる）。

初回のみ、Tailscale側でFunnel機能自体がACLで許可されていないと `tailscale funnel` が
エラーになることがある（近年のバージョンでは既定で許可されていることが多い）。エラーが出た
場合は管理コンソールの Access Controls（ACL）で `nodeAttrs` に funnel 関連の属性を追加する
必要がある可能性があるため、エラーメッセージと公式ドキュメント
（<https://tailscale.com/kb/1223/funnel>）を確認すること。

CLIのフラグ名はTailscaleのバージョンによって変わることがあるため、上記コマンドが
エラーになる場合は `tailscale serve --help` / `tailscale funnel --help` で現行バージョンの
書式を確認すること。

## 3. LINE Developers Console 側の設定

1. <https://developers.line.biz/> → 対象プロバイダー → 対象チャネル（Messaging API）を開く。
2. 「Messaging API設定」タブ → **Webhook URL** に手順2で確認した公開URL
   （`https://<マシン名>.<tailnet名>.ts.net/line-webhook`）を入力し、**Verify** を押して
   200が返ることを確認する（この時点では `~/.researchman-line.json` に `channelSecret` が
   未設定だとStudio側が503を返しVerifyが失敗する。先に §4 の設定を済ませてから行うこと）。
3. **「Webhookの利用」を ON** にする。
4. **「応答メッセージ」を OFF** にする（LINE公式のデフォルト自動応答文と、この機能の返信が
   二重に届くのを防ぐため）。
5. 「あいさつメッセージ」は任意（このままでも動作に影響しない）。

## 4. ResearchMan側の設定（このドキュメントでは実行しない。参考として手順のみ）

`~/.researchman-line.json` に以下を追加する（`channelAccessToken` は既存キー。無ければ
`scripts/researchman-line.example.json` の手順を先に済ませる）:

```json
{
  "channelAccessToken": "（既存の長期チャネルアクセストークン）",
  "channelSecret": "（LINE Developers Console → Messaging API設定 → Channel secret）",
  "allowedUserId": "（後述。最初は未設定のままでよい）"
}
```

`allowedUserId` が未設定の状態で自分のLINEから何かメッセージを送ると、Studio側が
「あなたのuserIdは Uxxx です。~/.researchman-line.json に "allowedUserId" として
設定してください」と返信するので、その値を `allowedUserId` に設定して保存する
（Studioサーバの再起動は不要。次のwebhookリクエストからファイルを読み直す）。

## 5. 動作確認

1. LINEアプリから「調べて 生成AIを使った屋外広告の事例」のように送る。
2. 解釈内容（種別・テーマ・観点・件数など）の確認メッセージが返ってくることを確認する。
3. 「OK」と返信し、「実行開始（完了時にまた通知します）」が返ってくることを確認する。
4. ジョブ完了後、既存パイプラインのLINE通知（追加事例の一覧等）が届くことを確認する
   （Studio UIの「ジョブ履歴」からも同じジョブを確認できる）。
