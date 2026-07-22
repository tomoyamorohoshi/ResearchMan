<#
.SYNOPSIS
  logs/notify-queue.jsonl（routine通知の積み残しキュー）を1本のダイジェストにまとめて
  LINEへ送る scripts/notify-digest.mjs を、毎日23:45に実行するタスク ResearchMan-digest を
  Windows タスクスケジューラへ「現在ユーザー・管理者権限不要」で登録する。

.DESCRIPTION
  2026-07-18、LINE公式アカウント無料枠（200通/月）超過対応の一環。日次収集の「成功/変更なし」
  等のroutine通知はnotify-line.mjs --priority routineでlogs/notify-queue.jsonlに積むだけになり、
  実送信はこのタスクが23:45に1回だけ行う（OPERATIONS.md参照）。

  - タスク名: ResearchMan-digest
  - アクション: cmd /c node scripts\notify-digest.mjs >> logs\digest.log 2>&1
    （作業ディレクトリ=リポジトリルート）
  - トリガー: 毎日23:45
  - 設定: StartWhenAvailable（起動遅延時の追い付き実行）・MultipleInstances=IgnoreNew
    （多重起動防止。notify-digest.mjs自体の実行はLINE API呼び出し数回程度で短時間に終わる想定）
  - 実行アカウント: 現在ユーザー（LogonType=Interactive。ログオン中のみ実行）

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\windows\register-digest-task.ps1
#>

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DigestScript = Join-Path $RepoRoot "scripts\notify-digest.mjs"

if (-not (Test-Path $DigestScript)) {
    throw "notify-digest.mjs が見つかりません: $DigestScript"
}

# node.exe の解決（register-tasks.ps1・register-studio-keeper.ps1と同じ方針:
# 既知の既定パス→PATH上のnodeの順）
$NodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $NodeExe)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $NodeExe = $cmd.Source }
}
if (-not (Test-Path $NodeExe)) {
    throw "node.exe が見つかりません（既定パス $NodeExe も PATH 上の node も無し）。Node.js のインストールを確認してください。"
}

$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir "digest.log"

Write-Host "リポジトリルート: $RepoRoot"
Write-Host "node.exe: $NodeExe"
Write-Host "ログ: $LogPath"
Write-Host ""

# cmd /c 経由で標準出力・標準エラーをログへ追記する（notify-digest.mjs自体は
# console.log/console.error に出すだけなので、リダイレクトで捕捉する）。
#
# 注意: register-studio-keeper.ps1の2026-07-22修正コメント参照。cmd.exe の /c は
# コマンド文字列中に引用符が3組以上あると、先頭・末尾の引用符だけを剥がす古い互換挙動に
# フォールバックし、`"node.exe" "script.mjs" >> "log" 2>&1` のような形が壊れる
# （ログファイルすら作成されない）。対策としてコマンド全体をもう一段引用符で包む（"" ... ""）。
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"`"$NodeExe`" `"$DigestScript`" >> `"$LogPath`" 2>&1`"" `
    -WorkingDirectory $RepoRoot

$trigger = New-ScheduledTaskTrigger -Daily -At "23:45"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    # 10分の根拠: quota確認+LINE送信+ファイルI/Oのみで通常数秒〜十数秒。
    # ハングした場合でも次周期（翌日23:45）を塞がないよう上限を設ける

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$taskName = "ResearchMan-digest"
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "既存タスク $taskName を削除して再登録します"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $taskName `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Principal $principal `
    -Description "ResearchMan notify digest (daily 23:45, sends logs/notify-queue.jsonl as one LINE message)" `
    | Out-Null

Write-Host "登録完了（有効）: $taskName（毎日23:45に $DigestScript を実行）"
