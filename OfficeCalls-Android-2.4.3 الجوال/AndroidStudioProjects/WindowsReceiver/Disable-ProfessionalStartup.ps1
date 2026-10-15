$ErrorActionPreference='Stop'
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name OfficeCallsProfessional -ErrorAction SilentlyContinue
Write-Output 'OfficeCalls Professional autostart disabled. Program and call history were retained.'
