<#
.SYNOPSIS
  ResearchMan の5ジョブ（autoresearch / techresearch / ideaseeds / tuneup / watchdog）を
  Windows タスクスケジューラへ「現在ユーザー・管理者権限不要」で登録する。

.DESCRIPTION
  各jobの発火時刻は launchd/com.researchman.*.plist の StartCalendarInterval 配列を
  そのまま再現する（下記 $JobSchedules 参照。時刻を変える場合は元のplistも合わせて確認すること）。

  - タスク名: ResearchMan-<job>
  - アクション: "<node.exe>" scripts\windows\run-job.mjs <job>（作業ディレクトリ=リポジトリルート）
  - 設定: StartWhenAvailable（起動遅延時の追い付き実行）・MultipleInstances=IgnoreNew（多重起動防止）
  - 実行アカウント: 現在ユーザー（LogonType=Interactive。ログオン中のみ実行・パスワード保存不要）
  - 登録直後に Disable-ScheduledTask で無効化する（Mac側(launchd)停止前の二重運用防止。
    移行完了時に手動で Enable-ScheduledTask すること）

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\windows\register-tasks.ps1
#>

$ErrorActionPreference = "Stop"

# scripts/windows/register-tasks.ps1 -> リポジトリルート（クローン場所に依存しない）
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RunJobScript = Join-Path $RepoRoot "scripts\windows\run-job.mjs"

if (-not (Test-Path $RunJobScript)) {
    throw "run-job.mjs が見つかりません: $RunJobScript"
}

# node.exe の解決（既定の既知パス→PATH上のnodeの順。CLAUDE.mdに記載の既定パスを優先）
$NodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $NodeExe)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $NodeExe = $cmd.Source }
}
if (-not (Test-Path $NodeExe)) {
    throw "node.exe が見つかりません（既定パス $NodeExe も PATH 上の node も無し）。Node.js のインストールを確認してください。"
}

Write-Host "リポジトリルート: $RepoRoot"
Write-Host "node.exe: $NodeExe"
Write-Host ""

# job → StartCalendarInterval相当（launchd/com.researchman.*.plist を参照）
#   autoresearch : 毎日10:00〜23:00の毎正時（14回）
#   techresearch : 毎日10:00〜23:00の毎正時（14回。autoresearchと同時刻だがgit排他ロックで直列化される）
#   ideaseeds    : 毎日10:15〜23:15の毎正時15分（14回。収集2本より15分遅らせて配信）
#   tuneup       : 毎週月曜08:30の単発トリガ（2026-07-14に隔週/毎月1・15日08:30から変更。
#                  PC停止時はタスクスケジューラのStartWhenAvailableでキャッチアップ。
#                  run-job.mjs側にも「月曜以外はスキップ」の保険があり、run-if-due.mjsのdaily-at
#                  ゲートで同日重複防止する。旧「毎日8:30〜23:30毎正時30分（16回）＋
#                  --monthly-days 1,15」構成は廃止）
#   watchdog     : 毎日12:30〜23:30の毎正時30分（12回。AM/PM 2段ゲートで実際は1日2回のみ実行）
$JobSchedules = [ordered]@{
    autoresearch = @{ Type = "DailyHours"; Hours = 10..23; Minute = 0 }
    techresearch = @{ Type = "DailyHours"; Hours = 10..23; Minute = 0 }
    ideaseeds    = @{ Type = "DailyHours"; Hours = 10..23; Minute = 15 }
    tuneup       = @{ Type = "Weekly"; DayOfWeek = "Monday"; Hour = 8; Minute = 30 }
    watchdog     = @{ Type = "DailyHours"; Hours = 12..23; Minute = 30 }
}

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)
    # 3時間の根拠: ロック待ち最大45分（ideaseeds/tuneup）＋ 本体実行の想定上限90分
    # （staleロック奪取閾値と同じ）＋ verify-deployポーリング最大~13分に余裕を足した値。
    # plist時代は無制限だったが、ハング残骸がロックを90分超塞ぐ事故を防ぐため上限は設ける

$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

foreach ($job in $JobSchedules.Keys) {
    $taskName = "ResearchMan-$job"
    $sched = $JobSchedules[$job]

    $triggers = @()
    if ($sched.Type -eq "Weekly") {
        $startTime = Get-Date -Hour $sched.Hour -Minute $sched.Minute -Second 0
        $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $sched.DayOfWeek -At $startTime
    } else {
        foreach ($hour in $sched.Hours) {
            $startTime = Get-Date -Hour $hour -Minute $sched.Minute -Second 0
            $triggers += New-ScheduledTaskTrigger -Daily -At $startTime
        }
    }

    $action = New-ScheduledTaskAction `
        -Execute $NodeExe `
        -Argument "`"$RunJobScript`" $job" `
        -WorkingDirectory $RepoRoot

    # 既存タスクがあれば一旦削除してから登録し直す（再実行安全・冪等にするため）
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "既存タスク $taskName を削除して再登録します"
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    Register-ScheduledTask `
        -TaskName $taskName `
        -Trigger $triggers `
        -Action $action `
        -Settings $Settings `
        -Principal $Principal `
        -Description "ResearchMan $job job (migrated from launchd/com.researchman.$job.plist)" `
        | Out-Null

    # 登録直後に必ず無効化する（Mac側launchdと同時に有効なままだと二重実行・git競合の危険がある）
    Disable-ScheduledTask -TaskName $taskName | Out-Null

    if ($sched.Type -eq "Weekly") {
        Write-Host "登録完了（無効化状態）: $taskName（毎週$($sched.DayOfWeek) $($sched.Hour):$($sched.Minute.ToString('00'))）"
    } else {
        Write-Host "登録完了（無効化状態）: $taskName（$($sched.Hours.Count)回/日 @ 毎時$($sched.Minute)分）"
    }
}

Write-Host ""
Write-Host "全5タスクを登録しました（すべて無効化状態です）。"
Write-Host "Mac側(launchd)を停止し、移行が完了したら以下で有効化してください:"
Write-Host '  Get-ScheduledTask -TaskName "ResearchMan-*" | Enable-ScheduledTask'
