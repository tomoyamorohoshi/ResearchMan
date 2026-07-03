# ResearchMan 運用引き継ぎ資料

> 対象読者: 今後このプロジェクトを運用・保守する人間および AI エージェント（Sonnet / Opus セッション）。
> 2026-07-03 時点の構成。変更したらこのファイルも更新すること。

## 1. システム概要

広告・クリエイティブ事例のギャラリーサイト。Next.js（App Router / SSG）+ Vercel。
データは `data/cases.json` の単一 JSON（DB なし）。サムネイルは `public/thumbnails/` にローカル永続保存（外部 CDN 非依存）。

- 本番: https://research-man.vercel.app （GitHub `main` への push で自動デプロイ）
- 事例ソース: award（受賞作）/ order（発注実績）/ radar（自動収集）。`sources` フィールドで区別
- タグ体系: `data/tag-vocabulary.json`（Tech / Form / Theme の3軸。自動収集はこの語彙外のタグを捨てる）

### Technology タブ（2026-07-03新設）

Case Study と並ぶ第2のTOP（`/technology`）。AI/HCI/CG/先端メディア技術の研究・プロトタイプ・ツールを収集。
- 仕様の単一ソース: **`TECHNOLOGY_SPEC.md`**（クライテリア・メディアリスト・運用フロー）
- データ: `data/tech.json` + `data/tech-tag-vocabulary.json`（Domain 7種 × Type 3種）。cases.json と完全分離
- サムネイル: `public/thumbnails/tech/`（既存のサムネイル監査の対象外）
- 取り込み: ユーザーのXブックマーク（`data/inbox/x-bookmarks-*.txt`）→ 調査 →
  `scripts/build-tech-from-research.mjs`（一次ソース死活・Case Study重複・サムネ下限を機械検証）
- **日次自動収集（Step 1）: 2026-07-03稼働開始**。launchd `com.researchman.techresearch`
  （**毎朝10時**・10〜23時の毎正時にキャッチアップ判定、状態: `.last-tech-research-run.txt`、
  ログ: `~/Library/Logs/researchman-tech.log`）
  - 流れ: `auto-research-tech.mjs`（Tier1ソースを4レーン日替わり巡回・日次3件上限）
    → `build-tech-from-research.mjs`（機械検証）→ commit/push → `verify-deploy.mjs`
    → `verify-tech-pages.mjs`（新規 /technology/{id} が200になるまでポーリング）→ LINE通知
  - Case Study側と同時発火してもgit競合しないよう `/tmp/researchman-git.lock` で排他
  - 通知サマリー: `/tmp/researchman-tech-last-add.json`（0件でも上書き=stale防止）

## 2. 自動収集パイプライン（無人運用の本体）

```
launchd (10〜23時の毎正時 + ログイン時)
  └─ run-if-due.mjs --daily-at 10 … 本日10時経過かつ本日分未実行なら exit 0（=1日1回）
       └─ auto-research-cc.mjs … Claude CLI で新事例を発見→検証→記事化（最大3ラウンド）
            └─ self-heal-thumbnails.mjs … 全サムネイルの健全性チェック・自動修復
                 └─ git commit & push    … data/cases.json と public/thumbnails/（tech除く）
                      └─ verify-deploy.mjs … 本番反映を最大360秒ポーリングで確認
                           └─ send-mail.mjs / notify-line.mjs … 結果種別つきで毎回通知
```

- plist: `launchd/com.researchman.autoresearch.plist`（リポジトリ版が原本。インストール先は `~/Library/LaunchAgents/`。**両方を常に一致させる**。反映は `launchctl unload` → `load`）
- **両パイプラインとも毎朝10時実行**（2026-07-03に72h/23h周期から変更）。カレンダー起動を
  10〜23時の毎正時に張り、`--daily-at`ゲートが1日1回を保証。10時にPCが落ちていても
  同日中の次の正時でキャッチアップ。収集エラー時は`--mark`で本日分を消化扱いにし連打を防ぐ
- 通知は全終端経路で送る: 成功/0件/反映未確認(unverified)/push失敗(pushfail)/収集エラー(error)
- 収集の内部モデルは **sonnet 固定**（`auto-research-cc.mjs` の `MODEL`。上位モデルは遅くてタイムアウトしやすい）
- 品質ゲート: リンク死活 → 検証済みサムネイル取得（oEmbed タイトル照合）→ 記事生成、の順に通過したものだけ採用。どこかで落ちたら孤立サムネイルも掃除して却下

### 状態ファイル・ログ

| パス | 役割 | 注意 |
|---|---|---|
| `.last-research-run.txt` / `.last-tech-research-run.txt`（リポジトリ直下・gitignored） | 前回実行時刻。毎朝10時ゲートの判定材料 | 消すと次の正時に即実行される（手動トリガとして使える） |
| `/tmp/researchman-last-add.json` | 直近実行の追加事例サマリー。通知の本文ソース | 0件の回も必ず上書きされる（stale 再通知防止。2026-07-03 修正） |
| `~/Library/Logs/researchman-auto.log` | パイプライン全ログ | 期限前スキップ（exit 3）はログを出さない仕様。**0バイトでも異常ではない** |
| `~/Library/Logs/researchman-auto-error.log` | launchd の stderr | 通常は空 |

### 通知設定（ホーム直下・リポジトリに置かない）

| ファイル | 状態 (2026-07-03) | 形式 |
|---|---|---|
| `~/.researchman-line.json` | **設定済み** | `{ "channelAccessToken": "..." }` で broadcast。`"to": "Uxxx"` を足すと push |
| `~/.researchman-mail.json` | **未設定**（通知は静かにスキップされる） | `send-mail.mjs` 冒頭コメント参照 |

通知は「おまけ」設計: 設定不備・送信失敗でも本体（収集・反映）を巻き込まず常に exit 0。

**0件の日も通知する**（2026-07-03〜）: 両パイプラインとも「変更なし」の回はLINEで
「本日の新規追加なし（収集は正常実行）」を送る。無音=障害か0件か区別できない問題の解消。
サマリーが6時間より古い場合は0件として扱う（収集クラッシュ時に旧事例を再通知しない鮮度ガード）。

### アイデアの種（毎朝10時の第3ジョブ・2026-07-03新設）

launchd `com.researchman.ideaseeds` が毎朝10時、Case Study（企画性）× Technology（技術）の
掛け合わせで「アイデアの種」10個をLINE配信する。
- `scripts/generate-idea-seeds.mjs`: 事例14件+技術12件を毎日ランダムサンプリングし、
  Claude CLI（sonnet）が「技術×技術 / 文脈×技術 / 転用」の3パターン混合で生成
- **各種に参照事例・技術の平易な解説（高校生でもわかる1文）とRMページURLを付記**（2026-07-03）。
  参照idは cases.json/tech.json と機械照合し、実在しないidのURLは出さない（誤リンク防止）。
  同一refが複数の種に出たら2回目以降はURL行のみ（解説の重複回避）
- 重複回避: 直近60個の種を `~/.researchman-idea-history.json` に保持しプロンプトで回避
- 配信: `notify-line.mjs --text-file /tmp/researchman-idea-seeds.txt`（本文そのまま送信モード）。
  ref付きで本文が長くなるため、4,800字超は空行境界で最大5メッセージに自動分割して送信
- 状態: `.last-idea-seeds-run.txt`、ログ: `~/Library/Logs/researchman-ideas.log`。
  収集2本と同じ排他ロックで直列化されるため、配信は収集完了後になる。生成エラー時は
  「❌ IdeaSeeds: 収集がエラー終了」を通知して翌朝再挑戦

## 3. 検証・監査スクリプト

| コマンド | 用途 |
|---|---|
| `npm run auto-research:cc:dry` / `auto-research:tech:dry` | 収集のフルテスト。データ更新なし・スケジュール消費なし・サムネイル自動掃除 |
| `npm run ideas:dry` | アイデアの種のフルテスト。履歴・状態を消費しない |
| `npm run self-heal` | サムネイル健全性チェック＋修復（`--dry-run` 可） |
| `npm run audit:integrity` | 全事例の機械検証（サムネ/videoId/リンク/テキスト）。`--out report.json` 可 |
| `npm run verify:deploy` | HEAD が本番に反映されたか確認（最大360秒） |
| `npm run audit:cannes` / `audit:cannes:strict` | Cannes網羅監査。`:strict`はレベル不一致・余分事例のWARNもexit 1にする |
| `npm run audit:tech` | Technology（tech.json）のフィールド/語彙/サムネイル整合検査 |
| `npm run audit:cannes` / `audit:thumbnails` / `audit:tech` | **pre-push hook で自動実行**（既定モード）。失敗すると push が中止される。
  hook原本は `scripts/hooks/pre-push`（git管理下）。実際に効くのは `.git/hooks/pre-push`（git管理外）なので、
  hookを変更したら必ず `cp scripts/hooks/pre-push .git/hooks/pre-push` で反映すること |

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

### sources欠落について（2026-07-04確認）

cases.json 454件中164件が `sources` なし。**これは仕様**（初期アーカイブのレガシーデータ）。
Cannes 2026分290件はsourcesすべて付与済みで欠落ゼロ（機械的な補完対象は無い）。
詳細は `src/lib/researchSources.ts` のコメント参照。

## 6. トラブルシューティング・ランブック

### 自動実行が走っていない
1. `launchctl list | grep researchman` … 登録確認（無ければ `launchctl load ~/Library/LaunchAgents/com.researchman.*.plist`）
2. `cat .last-research-run.txt`（Case Study）/ `.last-tech-research-run.txt`（Technology）… 前回実行時刻。
   **両方とも毎朝10時実行**（2026-07-03変更。10時にPCが落ちていても23時まで毎正時にキャッチアップ）
3. ログに何も出ないのは期限前スキップの正常動作（§2）
4. 即時実行したいとき: 状態ファイルを削除 → 次の正時に発火。またはログ付きで手動実行:
   plist 内のシェル部分をそのまま端末に貼る

### push が失敗した（ログに「pre-push監査で中止の可能性」）
- pre-push hook（Cannes 網羅監査 / サムネイル健全性監査）が FAIL している。コミットはローカルに残っている
- `git push` を手で叩いて FAIL 内容を読み、データを修正してから再 push（**監査を回避しない**）

### 通知が来ない
1. verify-deploy が時間切れだと通知はスキップされる（ログに「push成功だが反映未確認」）→ 反映は成功していることが多い。`node scripts/verify-deploy.mjs` を再実行して確認

### verify-deploy の限界（新ルート追加時の注意）
- 「landed」判定は **git の origin/main == HEAD 確認**であり、**Vercelビルド完了の確認ではない**。
  検査対象も home / サムネイル / cases.json の新規ページのみ。
- **新しいルート**（例: /technology）を追加した場合は、verify-deploy PASS後に
  `curl -s -o /dev/null -w "%{http_code}" https://research-man.vercel.app/<新ルート>` が
  200 になるまで別途確認すること（Vercelビルド中は旧デプロイが404を返す）
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
