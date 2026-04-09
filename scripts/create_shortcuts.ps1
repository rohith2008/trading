$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')

# Shortcut 1: One-click setup bat
$s1 = $ws.CreateShortcut($desktop + "\Claude Trading Setup.lnk")
$s1.TargetPath = 'C:\Users\Rohith\tradingview-mcp-jackson\scripts\setup_all.bat'
$s1.WorkingDirectory = 'C:\Users\Rohith\tradingview-mcp-jackson'
$s1.Description = 'Launch TradingView + start trade journal auto-updater'
$s1.IconLocation = 'C:\Windows\System32\cmd.exe,0'
$s1.Save()
Write-Host "Created: $desktop\Claude Trading Setup.lnk"

# Shortcut 2: Excel trade journal
$s2 = $ws.CreateShortcut($desktop + "\Trade Journal.lnk")
$s2.TargetPath = 'C:\Users\Rohith\tradingview-mcp-jackson\trades\trade-journal.xlsx'
$s2.Description = 'Claude trade journal - live P&L'
$s2.Save()
Write-Host "Created: $desktop\Trade Journal.lnk"
