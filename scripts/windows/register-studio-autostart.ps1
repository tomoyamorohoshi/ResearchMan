# Studioサーバをログオン時に自動起動するタスクを登録する（管理者不要・1回だけ実行）
# 登録直後は無効。移行完了（Mac停止）後に有効化する:
#   Enable-ScheduledTask -TaskName "ResearchMan-Studio"
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$NpmCmd = Join-Path (Split-Path (Get-Command node).Source) "npm.cmd"

# STUDIO_NO_OPEN: 起動のたびにブラウザが勝手に開かないようにする（サーバ常駐が目的のため）
# STUDIO_JOB_BUDGET_USD: ジョブ予算上限。既定$5では10件規模のCase Studyが収集途中で
# 停止することが実測で判明したため$12に引き上げ（2026-07-13。課金ではなくサブスク枠の換算額）
# タスクスケジューラは環境変数指定を直接サポートしないため cmd /c 経由で渡す
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c set STUDIO_NO_OPEN=1&& set STUDIO_JOB_BUDGET_USD=12&& `"$NpmCmd`" run studio" `
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
Disable-ScheduledTask -TaskName "ResearchMan-Studio" | Out-Null

Write-Host "登録完了（無効化状態）: ResearchMan-Studio（ログオン時に http://localhost:5178 で常駐）"
Write-Host "移行完了後に有効化: Enable-ScheduledTask -TaskName 'ResearchMan-Studio'"
