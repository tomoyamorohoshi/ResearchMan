# RM移行: 管理者権限が必要な初期設定をまとめて行う（1回だけ実行）
# 使い方: スタートボタン右クリック →「ターミナル(管理者)」→
#   powershell -ExecutionPolicy Bypass -File C:\Users\tomoy\Projects\ClaudeApps\ResearchMan\scripts\windows\setup-admin.ps1
$ErrorActionPreference = "Continue"
# 実行内容を後から検証できるようログを残す（リモート操作時はウィンドウがすぐ閉じるため）
Start-Transcript -Path (Join-Path $env:USERPROFILE ".researchman\logs\setup-admin.log") -Force | Out-Null

Write-Host "== 1/3 休止ファイル(hiberfil.sys, 約12.7GB)を削除 =="
powercfg /hibernate off
if ($?) { Write-Host "  OK: 休止機能を無効化しました（常時起動運用では不要）" }

Write-Host "== 2/3 Studio用ファイアウォール受信許可 (TCP 5178) =="
$rule = Get-NetFirewallRule -DisplayName "ResearchMan Studio" -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -DisplayName "ResearchMan Studio" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5178 -Profile Private | Out-Null
    Write-Host "  OK: ルールを追加しました（プライベートネットワークのみ）"
} else {
    Write-Host "  スキップ: ルールは既に存在します"
}

Write-Host "== 3/3 Tailscale のインストール =="
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    Write-Host "  スキップ: インストール済みです"
} else {
    winget install --id tailscale.tailscale -e --accept-source-agreements --accept-package-agreements
    Write-Host "  インストール後、タスクトレイのTailscaleアイコンからログインしてください（Macも同じアカウントで）"
}

Write-Host ""
$free = (Get-PSDrive C).Free / 1GB
Write-Host ("完了。C: 空き容量: {0:N1} GB" -f $free)
Write-Host "この後はClaude Codeに「管理者セットアップを実行した」と伝えてください。"
Stop-Transcript | Out-Null
