# ResearchMan Windows タスクスケジューラ移行

macOS launchd（`launchd/com.researchman.*.plist`）5ジョブの Windows 版。各jobのシェルロジックは
`scripts/windows/run-job.mjs` に忠実に移植されている。

## ジョブ一覧と対応するplist

| job（CLIの引数） | 元のplist | 内容 | 発火時刻 |
|---|---|---|---|
| `autoresearch` | com.researchman.autoresearch.plist | Case Study 日次自動収集 | 毎日10:00〜23:00 毎正時 |
| `techresearch` | com.researchman.techresearch.plist | Technology 日次自動収集 | 毎日10:00〜23:00 毎正時 |
| `ideaseeds` | com.researchman.ideaseeds.plist | アイデアの種 生成・LINE配信 | 毎日10:15〜23:15 毎正時15分 |
| `tuneup` | com.researchman.tuneup.plist | 週次チューンアップ（2026-07-14に隔週/毎月1・15日から変更。ファイル名`biweekly-tuneup.mjs`は後方互換で維持） | 毎週月曜08:30の単発トリガ（PC停止時はStartWhenAvailableでキャッチアップ） |
| `watchdog` | com.researchman.watchdog.plist | 自己回復ウォッチドッグ | 毎日12:30〜23:30 毎正時30分（実際に動くのは12:30枠・18:30枠の1日2回のみ。日曜18:30枠のみ`--deep`） |

`tuneup`以外の4ジョブは「毎正時に起動し、`scripts/run-if-due.mjs` のゲートが『本日分が未実行かつ
実行時刻を過ぎているか』を判定して初めて本体が走る」設計はMac時代のまま。PCがスリープ/電源OFFでも
次に起動した正時にキャッチアップされる。`tuneup`のみ2026-07-14に単発の週次トリガ（毎週月曜08:30）へ
変更し、`run-job.mjs`側で「月曜以外はスキップ」する保険を追加している（タスクスケジューラの
`StartWhenAvailable`が月曜以外へキャッチアップした場合の保険。詳細は`scripts/windows/run-job.mjs`の
`runTuneup()`コメント参照）。

## セットアップ手順

1. **登録**（現在ユーザー・管理者権限不要。登録直後は全タスクが無効化状態になる）:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\register-tasks.ps1
   ```
2. Mac側（launchd 5ジョブ）を停止する（`launchctl unload ~/Library/LaunchAgents/com.researchman.*.plist` 等）。
   **Mac側とWindows側を同時に有効化しない**こと（同じリポジトリへの二重push・git競合の原因になる）。
3. Windows側を有効化する:
   ```powershell
   Get-ScheduledTask -TaskName "ResearchMan-*" | Enable-ScheduledTask
   ```
4. 動作確認: タスクスケジューラ（`taskschd.msc`）で `ResearchMan-*` を選び「実行」で手動起動するか、
   次の発火時刻を待ってログを確認する。

## 無効化（一時停止したいとき）

```powershell
Get-ScheduledTask -TaskName "ResearchMan-*" | Disable-ScheduledTask
```

## ロールバック（タスクを完全に削除）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\unregister-tasks.ps1
```
登録時に作成された5タスクを削除する。ログファイル・状態ファイル（`.last-*-run.txt`）は削除されないので、
Mac側へ戻す場合もそれらは手動で確認すること。

## ログの場所

`%USERPROFILE%\.researchman\logs\researchman-<short>.log`

| job | ログファイル |
|---|---|
| autoresearch | `researchman-auto.log` |
| techresearch | `researchman-tech.log` |
| ideaseeds | `researchman-ideas.log` |
| tuneup | `researchman-tuneup.log` |
| watchdog | `researchman-watchdog.log` |

短縮名（auto/tech/ideas/tuneup/watchdog）は macOS 時代の `~/Library/Logs/researchman-*.log` の
ファイル名をそのまま踏襲している。`scripts/lib/log-health.mjs` の `defaultLogPath()` が
これと同じ規則でパスを組み立て、`watchdog.mjs` の「直近2run連続エラー」検知等に使うため、
ファイル名を変更しないこと。5MB超で `.log.1` へ自動ローテートされる（plist同様）。

## 手動実行（デバッグ用）

```powershell
& "C:\Program Files\nodejs\node.exe" scripts\windows\run-job.mjs autoresearch
```
`run-if-due.mjs` のゲートは通常どおり働く（本日分が実行済みなら何もせず終了する）。
ゲートを無視して強制的に本体を試したい場合は、対応する `.last-*-run.txt` を手動で削除するか、
古い日時に書き換えてから実行すること。

## 排他ロック・状態ファイルの共有について

- git排他ロック（`os.tmpdir()\researchman-git.lock`）・`.last-*-run.txt` などの状態ファイルは
  Mac版のスクリプト本体（`scripts/*.mjs`）と共通のものを使う。Windows移植で追加したのは
  ジョブのオーケストレーション層（`run-job.mjs`・タスクスケジューラ登録）のみで、
  収集・検証・通知ロジック本体（`scripts/auto-research-*.mjs` 等）は無改変。
- `/tmp/...` 直書きだった一時ファイルパスは全て `os.tmpdir()` ベースに置換済み（2026-07-11）。
  Windows・macOS間でファイルを直接受け渡すことはない（各OS上で完結する）ため、
  OSが変わってもファイル名さえ一致していれば書き手・読み手は同じ挙動になる。
