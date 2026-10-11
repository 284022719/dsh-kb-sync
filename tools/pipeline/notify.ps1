# 同步结果通知（桌面气泡 + 状态文件）
#
# 设计要点：
#   1) 调用方（.cmd）只传「错误代码」，中文文案全部留在这个 .ps1 里。
#      原因：.cmd 由 cmd.exe 按 GBK 读取，脚本里写中文会乱码。.ps1 存为带 BOM 的
#      UTF-8，PowerShell 能正确读取中文。
#   2) 同时写一份状态文件，便于人工或后续脚本查询最近一次同步结果。
param(
  [Parameter(Mandatory = $true)][string]$Case,
  [string]$LogPath = '',
  [string]$SyncDir = 'D:\dsh\dsh-kb-sync\data\import'
)

$ErrorActionPreference = 'Continue'

# Token 在仓库外（阶段 1 迁移；见 tools\pipeline\README.md「凭据」一节）。
# 调用方通过环境变量给出实际位置，这里只做展示与回落。
$TokenPath = if ($env:DSH_KB_SYNC_TOKEN_FILE) { $env:DSH_KB_SYNC_TOKEN_FILE } else { Join-Path $env:USERPROFILE '.dsh\.dsh-kb-sync-token' }

$MESSAGES = @{
  'sync-ok'        = @{ Title = '对话知识库：同步成功'; Level = 'Info';    Body = '段 1 抓取完成，新会话与续聊已写入本地知识库。' }
  'sync-failed'    = @{ Title = '对话知识库：同步失败'; Level = 'Error';   Body = '段 1 抓取失败。若提示未授权，多半是网页端 Token 过期，需重新获取并写入 token 文件。' }
  'token-expired'  = @{ Title = '对话知识库：Token 可能已过期'; Level = 'Warning'; Body = "接口返回未授权。请重新从网页端取 Token 覆盖 $TokenPath。" }
  'token-missing'  = @{ Title = '对话知识库：找不到 Token'; Level = 'Error'; Body = "$TokenPath 不存在，无法同步。" }
  'token-old'      = @{ Title = '对话知识库：Token 已偏旧'; Level = 'Warning'; Body = 'Token 获取时间较久，可能随时失效。建议提前更新，避免同步中断。' }
  'segment2-done'  = @{ Title = '对话知识库：段 2 提炼完成'; Level = 'Info'; Body = '归类、专题与健康档案已更新。' }
  'segment2-failed'= @{ Title = '对话知识库：段 2 提炼失败'; Level = 'Error'; Body = '抓取成功，但归类/提炼步骤出错，需人工查看日志。' }
  'kb-check-failed'= @{ Title = '对话知识库：完整性检查未通过'; Level = 'Warning'; Body = '知识库三份清单数量对不上、或有会话链接指向不存在的文件、或最新对话已超过 3 天没更新。通常意味着某一步重建中途失败或同步已停摆。运行 node D:\dsh\dsh-kb-sync\data\kb\tools\kb.mjs doctor 查看详情。' }
}

$m = $MESSAGES[$Case]
if (-not $m) { $m = @{ Title = '对话知识库'; Level = 'Info'; Body = "未知状态：$Case" } }

$body = $m.Body
if ($LogPath) { $body = "$body`n日志：$LogPath" }

# ---------- 状态文件 ----------
try {
  if (-not (Test-Path $SyncDir)) { New-Item -ItemType Directory -Path $SyncDir -Force | Out-Null }
  $statusPath = Join-Path $SyncDir 'LAST-SYNC.txt'
  $line = '{0}  {1}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Case, $LogPath
  Add-Content -Path $statusPath -Value $line -Encoding UTF8
} catch { }

# ---------- 桌面气泡 ----------
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = switch ($m.Level) {
    'Error'   { [System.Drawing.SystemIcons]::Error }
    'Warning' { [System.Drawing.SystemIcons]::Warning }
    default   { [System.Drawing.SystemIcons]::Information }
  }
  $n = New-Object System.Windows.Forms.NotifyIcon
  $n.Icon = $icon
  $n.BalloonTipTitle = $m.Title
  $n.BalloonTipText = $body
  $n.BalloonTipIcon = switch ($m.Level) {
    'Error'   { [System.Windows.Forms.ToolTipIcon]::Error }
    'Warning' { [System.Windows.Forms.ToolTipIcon]::Warning }
    default   { [System.Windows.Forms.ToolTipIcon]::Info }
  }
  $n.Visible = $true
  $n.ShowBalloonTip(20000)
  Start-Sleep -Seconds 20
  $n.Visible = $false
  $n.Dispose()
} catch {
  # 通知失败不影响主流程
  Write-Host "notify failed: $($_.Exception.Message)"
}

exit 0
