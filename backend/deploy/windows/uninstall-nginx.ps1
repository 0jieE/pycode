<#
.SYNOPSIS
  Removes what install-nginx.ps1 set up (run as Administrator). The Docker stack can then go back to plain mode:
      docker compose up -d        (Docker's own Nginx on port 80 again)
#>
param([string]$InstallDir = "C:\lab-nginx")
$ErrorActionPreference = "Continue"

Unregister-ScheduledTask -TaskName "Lab Nginx" -Confirm:$false -ErrorAction SilentlyContinue
Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$InstallDir*" } | Stop-Process -Force
Remove-NetFirewallRule -DisplayName "Lab system (HTTP 80)" -ErrorAction SilentlyContinue
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
Write-Host "Removed. Start the Docker stack without docker-compose.windows.yml to use port 80 directly again."
