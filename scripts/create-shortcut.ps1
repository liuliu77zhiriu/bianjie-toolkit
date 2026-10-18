# 创建「便捷工具」快捷方式
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1 -Target "D:\Tools\便捷工具\便捷工具.exe"
param(
  [string]$Target = "",
  [switch]$NoStartMenu
)

$ErrorActionPreference = 'Stop'

if (-not $Target) {
  $Target = Join-Path $PSScriptRoot '..\release\便捷工具-win32-x64\便捷工具.exe'
}
$Target = [System.IO.Path]::GetFullPath($Target)
if (-not (Test-Path -LiteralPath $Target)) {
  throw "找不到主程序：$Target。请先运行 npm run package，或用 -Target 指定 exe 路径。"
}

$workDir = Split-Path -Parent $Target
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$wsh = New-Object -ComObject WScript.Shell

function New-AppShortcut([string]$dir) {
  if (-not $dir) { return $null }
  $lnk = Join-Path $dir '便捷工具.lnk'
  $shortcut = $wsh.CreateShortcut($lnk)
  $shortcut.TargetPath = $Target
  $shortcut.WorkingDirectory = $workDir
  $shortcut.IconLocation = "$Target,0"
  $shortcut.Description = '便捷工具 · 桌面快捷工具箱（截图 / 录屏 / 备忘录 / 计时器）'
  $shortcut.WindowStyle = 1
  $shortcut.Save()
  return $lnk
}

$created = @()
$desktopLnk = New-AppShortcut $desktop
if ($desktopLnk) { $created += $desktopLnk }
if (-not $NoStartMenu) {
  $startLnk = New-AppShortcut $programs
  if ($startLnk) { $created += $startLnk }
}

Write-Output "目标程序：$Target"
foreach ($lnk in $created) {
  Write-Output "已创建快捷方式：$lnk"
}
