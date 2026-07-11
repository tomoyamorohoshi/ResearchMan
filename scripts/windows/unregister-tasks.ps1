<#
.SYNOPSIS
  scripts\windows\register-tasks.ps1 で登録した ResearchMan の5タスクを削除する
  （ロールバック用）。

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\windows\unregister-tasks.ps1
#>

$JobNames = @("autoresearch", "techresearch", "ideaseeds", "tuneup", "watchdog")

foreach ($job in $JobNames) {
    $taskName = "ResearchMan-$job"
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "削除しました: $taskName"
    } else {
        Write-Host "未登録（スキップ）: $taskName"
    }
}

Write-Host ""
Write-Host "ResearchMan の5タスクをすべて削除しました。"
Write-Host "ログファイル（%USERPROFILE%\.researchman\logs\）・状態ファイル（.last-*-run.txt）は削除していません。"
