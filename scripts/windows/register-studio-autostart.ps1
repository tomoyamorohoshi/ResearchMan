# Studioサーバをログオン時に自動起動するタスクを登録する（管理者不要・1回だけ実行）
# 2026-07-21: Studioが無言で死んでいてもタスク出力が捨てられ死因ログが残らなかった実
# インシデントの再発防止として、出力を logs\studio.log へリダイレクトするよう変更。
# あわせて「登録後は無効化」の移行期挙動を廃止し、登録後は有効なままにする
# （移行（Mac停止）は完了済み。無効化すると再起動されずLINEボットが無応答のまま気づかれない）。
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$NpmCmd = Join-Path (Split-Path (Get-Command node).Source) "npm.cmd"
$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir "studio.log"

# STUDIO_NO_OPEN: 起動のたびにブラウザが勝手に開かないようにする（サーバ常駐が目的のため）
# STUDIO_JOB_BUDGET_USD: ジョブ予算上限。既定$5では10件規模のCase Studyが収集途中で
# 停止することが実測で判明したため$12に引き上げ（2026-07-13。課金ではなくサブスク枠の換算額）
# タスクスケジューラは環境変数指定を直接サポートしないため cmd /c 経由で渡す。
# `>> "<logs\studio.log>" 2>&1` で標準出力・標準エラーの両方を捕捉する（次回死んだときに
# 死因ログを残すため。ローテートは scripts/windows/studio-keeper.mjs が10MB超で行う）
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c set STUDIO_NO_OPEN=1&& set STUDIO_JOB_BUDGET_USD=12&& `"$NpmCmd`" run studio >> `"$LogPath`" 2>&1" `
    -WorkingDirectory $RepoRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero)  # 常駐サーバのため実行時間無制限
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$existing = Get-ScheduledTask -TaskName "ResearchMan-Studio" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "既存タスク ResearchMan-Studio を削除して再登録します"
    Unregister-ScheduledTask -TaskName "ResearchMan-Studio" -Confirm:$false
}

Register-ScheduledTask `
    -TaskName "ResearchMan-Studio" `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Principal $principal `
    -Description "ResearchMan Studio server (auto-start at logon, port 5178)" `
    | Out-Null

Write-Host "登録完了（有効）: ResearchMan-Studio（ログオン時に http://localhost:5178 で常駐）"
Write-Host "出力ログ: $LogPath"
