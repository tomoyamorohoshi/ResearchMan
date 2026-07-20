<#
.SYNOPSIS
  Studioサーバ（port 5178）の死活監視・自動復旧タスク ResearchMan-studiokeeper を
  Windows タスクスケジューラへ「現在ユーザー・管理者権限不要」で登録する。

.DESCRIPTION
  2026-07-17〜21、Studioサーバ（LINEボットの実体、tsx watch）が無言で死んでいても
  ログオン時起動タスク（ResearchMan-Studio、AtLogOnトリガーのみ）は再起動されず、
  既存watchdog（1日2回）にもStudio死活監視が無いためLINEボットが無応答のまま気づかれ
  なかった実インシデントの再発防止。scripts\windows\studio-keeper.mjs を15分毎に実行し、
  GET http://127.0.0.1:5178/api/jobs で死活判定→死亡時は port 5178 のPIDだけkill→
  ResearchMan-Studioタスク再起動→復旧確認→logs\incidents.json記録→LINE通知、を行う。

  - タスク名: ResearchMan-studiokeeper
  - アクション: cmd /c node scripts\windows\studio-keeper.mjs >> logs\studio-keeper.log 2>&1
    （作業ディレクトリ=リポジトリルート）
  - トリガー: 15分毎（登録直後の時刻を起点に無期限リピート）
  - 設定: StartWhenAvailable（起動遅延時の追い付き実行）・MultipleInstances=IgnoreNew
    （多重起動防止。studio-keeper.mjs自体の実行は数秒〜長くても90秒程度で終わる想定）
  - 実行アカウント: 現在ユーザー（LogonType=Interactive。ログオン中のみ実行）
  - register-studio-autostart.ps1 と異なり、登録後は最初から有効（移行期の無効化は不要。
    Studio死活監視は常時稼働させておく必要があるため）

.USAGE
  powershell -ExecutionPolicy Bypass -File scripts\windows\register-studio-keeper.ps1
#>

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$KeeperScript = Join-Path $RepoRoot "scripts\windows\studio-keeper.mjs"

if (-not (Test-Path $KeeperScript)) {
    throw "studio-keeper.mjs が見つかりません: $KeeperScript"
}

# node.exe の解決（register-tasks.ps1 と同じ方針: 既知の既定パス→PATH上のnodeの順）
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
$LogPath = Join-Path $LogDir "studio-keeper.log"

Write-Host "リポジトリルート: $RepoRoot"
Write-Host "node.exe: $NodeExe"
Write-Host "ログ: $LogPath"
Write-Host ""

# cmd /c 経由で標準出力・標準エラーをログへ追記する（run-job.mjs系の自前ログ実装とは異なり、
# studio-keeper.mjs自体は console.log/console.error に出すだけなので、リダイレクトで捕捉する）
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$NodeExe`" `"$KeeperScript`" >> `"$LogPath`" 2>&1" `
    -WorkingDirectory $RepoRoot

# 15分毎・実質無期限リピート（登録直後の時刻を起点にする。PS5.1で動く書式）。
# [TimeSpan]::MaxValue はXMLのDuration型の範囲を超えてRegister-ScheduledTaskが
# HRESULT 0x80041318で失敗するため使わない。10年（3650日）を「実質無期限」として使う
# （register-tasks.ps1のWeeklyトリガと違いRepetitionDurationは有限値が必須）
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 15) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    # 10分の根拠: 死活確認(5秒)+復旧ポーリング上限(90秒)+マージン。
    # ハングしたstudio-keeper自体が次周期を塞がないよう上限を設ける

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$taskName = "ResearchMan-studiokeeper"
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
    -Description "ResearchMan Studio keeper (15-min health check & auto-recovery, port 5178)" `
    | Out-Null

Write-Host "登録完了（有効）: $taskName（15分毎に $KeeperScript を実行）"
