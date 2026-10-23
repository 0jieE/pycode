<#
.SYNOPSIS
  Installs Nginx for Windows in front of the Docker stack, so the server sees each lab PC's real IP address.

.DESCRIPTION
  Run ONCE on the Windows server, in PowerShell **as Administrator**, from the backend folder. FIRST move the Docker
  stack to Windows mode (it frees port 80), THEN run this script:

      docker compose -f docker-compose.yml -f docker-compose.windows.yml up -d
      powershell -ExecutionPolicy Bypass -File deploy\windows\install-nginx.ps1

  It: downloads Nginx for Windows (needs internet this one time; or put the zip next to this script first),
  unpacks it to C:\lab-nginx, installs deploy\windows\nginx.conf, checks it, opens TCP port 80 in the Windows
  firewall for the Private and Domain networks, and registers a task that starts Nginx at boot (as SYSTEM).
  Re-running it updates the config and restarts Nginx. To remove everything: uninstall-nginx.ps1.
#>
param(
    [string]$InstallDir = "C:\lab-nginx",
    [string]$Version = "1.26.3"
)
$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this script in PowerShell as Administrator." }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipName = "nginx-$Version.zip"
$zip = Join-Path $here $zipName

# 1. Nginx itself
if (-not (Test-Path (Join-Path $InstallDir "nginx.exe"))) {
    if (-not (Test-Path $zip)) {
        Write-Host "Downloading $zipName ..."
        Invoke-WebRequest -Uri "https://nginx.org/download/$zipName" -OutFile $zip -UseBasicParsing
    }
    $tmp = Join-Path $env:TEMP "lab-nginx-unpack"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Copy-Item -Path (Join-Path $tmp "nginx-$Version\*") -Destination $InstallDir -Recurse -Force
    Remove-Item $tmp -Recurse -Force
}

# Port 80 must be free: the Docker stack has to be in Windows mode (its Nginx on 127.0.0.1:8080) BEFORE this runs.
$busy = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue |
    Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Path -notlike "$InstallDir*" }
if ($busy) {
    $owner = (Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    throw ("Port 80 is used by '$owner'. If that is Docker, first switch the stack to Windows mode:`n" +
           "    docker compose -f docker-compose.yml -f docker-compose.windows.yml up -d`n" +
           "then run this script again.")
}

# 2. Our configuration
Copy-Item -Path (Join-Path $here "nginx.conf") -Destination (Join-Path $InstallDir "conf\nginx.conf") -Force
& (Join-Path $InstallDir "nginx.exe") -p "$InstallDir\" -t
if ($LASTEXITCODE -ne 0) { throw "The Nginx configuration test failed." }

# 3. Firewall: lab PCs may reach port 80 (Private and Domain networks; set the lab network's profile to Private)
if (-not (Get-NetFirewallRule -DisplayName "Lab system (HTTP 80)" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Lab system (HTTP 80)" -Direction Inbound -Protocol TCP -LocalPort 80 `
        -Action Allow -Profile Private,Domain | Out-Null
}

# 4. Start at boot, as SYSTEM, and restart it now
$taskName = "Lab Nginx"
Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$InstallDir*" } | Stop-Process -Force
# Forward slashes on purpose: in a Windows command line, `\"` escapes the quote, so -p "C:\lab-nginx\" would reach
# Nginx as C:\lab-nginx" (no config, not even a log). Nginx for Windows accepts C:/lab-nginx/.
$prefix = ($InstallDir -replace '\\', '/').TrimEnd('/') + '/'
$action = New-ScheduledTaskAction -Execute (Join-Path $InstallDir "nginx.exe") -Argument "-p `"$prefix`"" `
    -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$running = $null
for ($i = 0; $i -lt 10 -and -not $running; $i++) {
    Start-Sleep -Seconds 1
    $running = Get-Process nginx -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$InstallDir*" }
}
if ($running) {
    Write-Host "Nginx is running from $InstallDir and starts with Windows (task '$taskName')."
    Write-Host "Check from another device on the network: http://<this server's IP>/api/v1/health"
} else {
    $log = Join-Path $InstallDir "logs\error.log"
    if (Test-Path $log) { Write-Host "--- last lines of $log"; Get-Content $log -Tail 10 }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Host "--- task '$taskName': last result $($info.LastTaskResult), last run $($info.LastRunTime)"
    throw "Nginx did not start (see above)."
}
