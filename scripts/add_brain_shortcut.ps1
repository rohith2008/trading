$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$s = $ws.CreateShortcut($desktop + "\Brain Briefing.lnk")
$s.TargetPath = 'cmd.exe'
$s.Arguments = '/k node C:\Users\Rohith\tradingview-mcp-jackson\scripts\brain_briefing.js'
$s.WorkingDirectory = 'C:\Users\Rohith\tradingview-mcp-jackson'
$s.Description = 'Run Claude brain briefing'
$s.Save()
Write-Host "Created: $desktop\Brain Briefing.lnk"
