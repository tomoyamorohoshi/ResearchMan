# ResearchMan 運用引き継ぎ資料

> 対象読者: 今後このプロジェクトを運用・保守する人間および AI エージェント（Sonnet / Opus セッション）。
> 2026-07-03 時点の構成。変更したらこのファイルも更新すること。

## 1. システム概要

広告・クリエイティブ事例のギャラリーサイト。Next.js（App Router / SSG）+ Vercel。
データは `data/cases.json` の単一 JSON（DB なし）。サムネイルは `public/thumbnails/` にローカル永続保存（外部 CDN 非依存）。

- 本番: https://research-man.vercel.app （GitHub `main` への push で自動デプロイ）
- 事例ソース: award（受賞作）/ order（発注実績）/ radar（自動収集）。`sources` フィールドで区別
- タグ体系: `data/tag-vocabulary.json`（Tech / Form / Theme の3軸。自動収集はこの語彙外のタグを捨てる）

## 2. 自動収集パイプライン（無人運用の本体）

```
launchd (毎時起動 + ログイン時)
  └─ run-if-due.mjs           … 前回実行から71時間経過していなければ exit 3 で即終了
       └─ auto-research-cc.mjs … Claude CLI で新事例を発見→検証→記事化（最大3ラウンド）
            └─ self-heal-thumbnails.mjs … 全サムネイルの健全性チェック・自動修復
                 └─ git commit & push    … data/cases.json と public/thumbnails/ のみ
                      └─ verify-deploy.mjs … 本番反映を最大360秒ポーリングで確認
                           └─ send-mail.mjs / notify-line.mjs … 反映確認後にのみ通知
```

- plist: `launchd/com.researchman.autoresearch.plist`（リポジトリ版が原本。インストール先は `~/Library/LaunchAgents/`。**両方を常に一致させる**。反映は `launchctl unload` → `load`）
- 毎時起動 + 71h ゲート方式なのは、launchd の `StartCalendarInterval` がスリープ中の実行時刻を取りこぼすため。PC が落ちていても復帰後1時間以内に必ず実行される
- 収集の内部モデルは **sonnet 固定**（`auto-research-cc.mjs` の `MODEL`。上位モデルは遅くてタイムアウトしやすい）
- 品質ゲート: リンク死活 → 検証済みサムネイル取得（oEmbed タイトル照合）→ 記事生成、の順に通過したものだけ採用。どこかで落ちたら孤立サムネイルも掃除して却下

### 状態ファイル・ログ

| パス | 役割 | 注意 |
|---|---|---|
| `.last-research-run.txt`（リポジトリ直下・gitignored） | 前回実行時刻。71h ゲートの判定材料 | 消すと次の毎時起動で即実行される（手動トリガとして使える） |
| `/tmp/researchman-last-add.json` | 直近実行の追加事例サマリー。通知の本文ソース | 0件の回も必ず上書きされる（stale 再通知防止。2026-07-03 修正） |
| `~/Library/Logs/researchman-auto.log` | パイプライン全ログ | 期限前スキップ（exit 3）はログを出さない仕様。**0バイトでも異常ではない** |
| `~/Library/Logs/researchman-auto-error.log` | launchd の stderr | 通常は空 |

### 通知設定（ホーム直下・リポジトリに置かない）

| ファイル | 状態 (2026-07-03) | 形式 |
|---|---|---|
| `~/.researchman-line.json` | **設定済み** | `{ "channelAccessToken": "..." }` で broadcast。`"to": "Uxxx"` を足すと push |
| `~/.researchman-mail.json` | **未設定**（通知は静かにスキップされる） | `send-mail.mjs` 冒頭コメント参照 |

通知は「おまけ」設計: 設定不備・送信失敗でも本体（収集・反映）を巻き込まず常に exit 0。

## 3. 検証・監査スクリプト

| コマンド | 用途 |
|---|---|
| `npm run auto-research:cc:dry` | 収集のフルテスト。cases.json 更新なし・スケジュール消費なし・サムネイル自動掃除 |
| `npm run self-heal` | サムネイル健全性チェック＋修復（`--dry-run` 可） |
| `node scripts/audit-integrity.mjs` | 全事例の機械検証（サムネ/videoId/リンク/テキスト）。`--out report.json` 可 |
| `node scripts/verify-deploy.mjs` | HEAD が本番に反映されたか確認（最大360秒） |
| `npm run audit:cannes` / `audit:thumbnails` | **pre-push hook で自動実行**。失敗すると push が中止される |

## 4. 過去に踏んだ重大バグと再発防止ルール

### settle パターン（http 処理の絶対ルール）

`req.destroy()` は req の `'error'`（ECONNRESET）を発火させる。データ受信中など**非同期の位置**で
destroy すると、error 側の `resolve(null)` が正常系より先に走り「生きているリンクを死と誤判定」
「60KB 超ページで og:image 全滅」という実バグを踏んだ（2026-07 に根絶済み）。

このリポジトリで http を Promise ラップするときの必須形:

```js
let settled = false;
const settle = (v) => { if (settled) return; settled = true; resolve(v); };
// 1. 打ち切るときは 必ず「先に settle、後で destroy」
// 2. res には end だけでなく close / error でも settle する
//    （close がないと異常切断で Promise が永久未解決 → プロセスがイベントループ枯渇で静死）
// 3. リダイレクトは 3xx 全体 (301/302/303/307/308) を追跡し、追跡前に res.resume() する
```

準拠済み: `save-thumbnail.mjs` / `verify-video.mjs` / `audit-integrity.mjs` / `verify-deploy.mjs` /
`notify-line.mjs` / `self-heal-thumbnails.mjs` / `ensure-thumbnails.mjs`。
**新しい http 処理を書くときは verify-video.mjs の `httpGet` を写経すること。**

### その他の教訓

- **dry-run がスケジュールを消費しない**こと（`saveLastRunDate` は `!DRY_RUN` ガード必須）
- 発見プロンプトには**全既存タイトル**を渡す（直近30件だけ渡すと既出の有名事例を再提案し全滅する）
- 「ytimg が 200」だけではサムネ検証にならない。**必ず oEmbed でタイトルを取り事例と照合**（`verify-video.mjs` を共用）
- macOS に `timeout` コマンドは無い（GNU coreutils）。シェルで使わない

## 5. audit-integrity の結果の読み方（誤検知に注意）

2026-07-03 のフル実行: 455件中 問題23件（videoId-mismatch 19 / link-dead 2 / thumbnail-dup 1）。
ただし大半は誤検知気味なので、**修正前に必ず個別確認**すること:

- `videoId-mismatch`: タイトル表記揺れで正しい動画も flag される
  （例: 事例「#LIKEAGIRL」 vs 動画「Always #Like a Girl」→ 正しい対応）。機械判定は「疑い」であって確定ではない
- `link-dead`: 並列度8のプール実行だと同時アクセスでタイムアウトが揺れ、**実行ごとに件数が大きく変動する**
  （15件→2件を観測）。疑わしい URL は直列で `isUrlAlive` を再実行して確認する。
  `olympics.com` は bot ブロックで常に false になる既知の誤検知
- 精度を上げたい場合は並列度を下げる or リトライを足す（未対応の改善余地）

## 6. トラブルシューティング・ランブック

### 自動実行が走っていない
1. `launchctl list | grep researchman` … 登録確認（無ければ `launchctl load ~/Library/LaunchAgents/com.researchman.autoresearch.plist`）
2. `cat .last-research-run.txt` … 前回実行時刻（+71h が次回）
3. ログが 0 バイトなのは期限前スキップの正常動作（§2）
4. 即時実行したいとき: `rm .last-research-run.txt` → 次の毎時起動で発火。またはログ付きで手動実行:
   plist 内のシェル部分をそのまま端末に貼る

### push が失敗した（ログに「pre-push監査で中止の可能性」）
- pre-push hook（Cannes 網羅監査 / サムネイル健全性監査）が FAIL している。コミットはローカルに残っている
- `git push` を手で叩いて FAIL 内容を読み、データを修正してから再 push（**監査を回避しない**）

### 通知が来ない
1. verify-deploy が時間切れだと通知はスキップされる（ログに「push成功だが反映未確認」）→ 反映は成功していることが多い。`node scripts/verify-deploy.mjs` を再実行して確認
2. LINE: `node scripts/notify-line.mjs --dry-run` で本文確認 → 設定は `~/.researchman-line.json`
3. メール: `~/.researchman-mail.json` が未設定なら仕様どおりスキップ

### サムネイルが壊れた・欠けた
- `npm run self-heal` が診断から修復まで行う（oEmbed 照合済みの安全な取得）
- 5KB 未満はプレースホルダ疑いとして検出される

### cases.json を手で直すとき
- `id` は `toId(title, year, client)` 由来。**既存 id を変えるとサムネイルのファイル名と URL が両方壊れる**
- 直したら `node scripts/audit-integrity.mjs` → `npm run build` で検証してから push

## 7. 運用体制メモ

- 以後の運用・保守セッションは Sonnet / Opus を想定（この資料は 2026-07-03 の Fable 5 セッションで、
  実運用経路のデバッグ（stale 通知バグ・dry-run スケジュール消費バグの修正）と併せて作成）
- 大きな判断材料はセッションメモリ（`~/.claude/projects/.../memory/`）にもある。特に
  `radar-curation`（キュレーション方針）と `node-http-destroy-bug`（settle パターンの経緯）
