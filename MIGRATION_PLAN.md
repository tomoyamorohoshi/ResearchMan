# RM運用 Mac→Windows 移行計画

作成: 2026-07-11 / 計画: Fable / 実装: Sonnet（サブエージェント） / レビュー: Fable
状態: 実施中

## ゴール
「つけっぱなしPC」をMacからこのWindows機に移す。移行後:
- 毎朝の自動収集（5ジョブ）がWindowsタスクスケジューラで動く
- StudioがこのPCで常駐し、Mac・スマホからはTailscale経由のブラウザで使える
- Macは電源を切ってよい（ブラウザで見る係になる）

## 前提調査の結果（2026-07-11 Fable実測）
- リポジトリ: https://github.com/tomoyamorohoshi/ResearchMan.git（Z:=\\NOMACBOOK-PRO\Projects はMacの共有。移行後は使わない）
- 新ローカル: C:\Users\tomoy\Projects\ClaudeApps\ResearchMan（core.autocrlf=false / core.filemode=false でclone済み）
- claude CLI: C:\Users\tomoy\.local\bin\claude.exe（認証済み・--print動作が自動収集の中核）
- 定時ジョブ5本: autoresearch(10-14時の毎時+run-if-due) / techresearch / ideaseeds / tuneup / watchdog(12:30-16:30の毎時+run-if-due)
- Mac依存箇所:
  1. /tmp/ 直書き（researchman-git.lock・researchman-last-add.json 等、scripts/とstudio/serverに十数箇所）
  2. resolveClaudeBin の which 依存＋Mac固定パス（scripts/lib/claude-cli.mjs）
  3. launchd plist 内の zsh スクリプト（ログローテ・mkdirロック・stale奪取・エラー時LINE通知）
  4. 秘密情報・履歴がMacのホーム直下: ~/.researchman-line.json（LINEトークン）/ ~/.researchman-favsync.json / ~/.researchman-idea-history.json
- ⚠ このPCのC:ドライブが移行開始時点でほぼ満杯（935GB/935GB）→ P1で空き確保が先決

## フェーズ（タスク#1〜#7に対応）
- **P1** clone✓・運用データ移送✓（.last-*-run.txt / studio\workdir\jobs / logs）・ディスク空き確保→npm install（root+studio）
- **P2** クロスプラットフォーム改修（Sonnet）: tmpパスヘルパー新設（os.tmpdir()）・claude-cli.mjsのWindows対応。既存テスト全通過を維持
- **P3** ジョブ移植（Sonnet）: scripts/windows/run-job.mjs（plistのzshロジックをNode化: ログローテ5MB・ロック待ち30分/stale90分奪取・run-if-due・エラー時notify-line）＋register-tasks.ps1（5タスク、**初期は無効**・「開始時刻を逃した場合すぐ実行」有効）
- **P4** Studio動作確認: studioテスト全通過・サーバ起動・UI応答
- **P5** Tailscale導入（ログインのみユーザー操作）・ファイアウォール5178許可・AC時スリープ無効化
- **P6** Mac側引き継ぎ: migration/mac-decommission.sh をユーザーがMacで1回実行（秘密3ファイルをZ:経由で移送→launchd 5ジョブ停止）→Windows側で秘密をホームへ配置・共有から削除→タスク有効化
- **P7** Fableレビュー: adversarial-reviewerで差分レビュー＋運用チェック（push認証dry-run / CRLF混入なし / claude.exe非対話認証 / LINE dry-run / 再起動後の自動復帰）＋E2E（watchdog実走1本）＋OPERATIONS.md更新

## 二重運用の防止（重要）
Mac停止（P6）が完了するまでWindowsのタスクは**無効のまま**。.last-*-run.txt を移送済みのため、有効化当日の二重実行も run-if-due が防ぐ。

## commit/push の順序制約（敵対的レビュー指摘#1・2026-07-11）
本移行のコード変更（/tmp→os.tmpdir()化）は、**MacのlaunchdジョブがまだloadされたままMac側リポジトリに取り込まれると危険**:
plist（/tmp直書き）が読むファイルとスクリプト（os.tmpdir()=/var/foldersに解決）が書くファイルが食い違い、
LINE通知の空配信に加えて **git排他ロックの相互排他が壊れる**（plistは/tmpをロック、Studio/watchdogは/var/foldersをロック）。
→ 対処: **この変更のcommit/pushは、ユーザーがmac-decommission.sh（launchd 5ジョブ停止）を実行し終えるまで行わない。**
（watchdogにはgit pullを行う経路があるため、「pushしなければMacに届かない」を保証線にする）

## ロールバック
Mac側は launchctl load で5ジョブを再開できる（plistは削除しない）。Windows側タスクは schtasks /delete で全撤去可能。リポジトリはGitHubが正なので、どちらのマシンからでも再開できる。
