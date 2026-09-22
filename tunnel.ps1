# tunnel.ps1 — expose the local MySQL (port 3306) to the internet via ngrok TCP.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\tunnel.ps1
#
# - Reuses a running ngrok agent if one is up, else starts one detached.
# - Waits for the tunnel, then prints the exact DB_HOST / DB_PORT values to
#   paste into Vercel (Settings -> Environment Variables) and copies them to
#   the clipboard. Remember to REDEPLOY after changing env vars.
# - Inspector UI: http://localhost:4040

$ErrorActionPreference = 'Stop'

$candidates = @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
  "$env:LOCALAPPDATA\Microsoft\WindowsApps\ngrok.exe",
  "ngrok"
)
$ngrok = $candidates | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $ngrok) {
  throw "ngrok.exe not found. Install it with: winget install ngrok.ngrok"
}

$alreadyRunning = $false
try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2 | Out-Null
  $alreadyRunning = $true
} catch {}

if ($alreadyRunning) {
  Write-Host "ngrok agent already running — reusing it."
} else {
  Start-Process -FilePath $ngrok -ArgumentList 'tcp', '3306' -WindowStyle Hidden
  Write-Host "ngrok agent starting (hidden window)..."
}

# Poll the local API until the TCP tunnel reports a public address.
$addr = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $tunnels = (Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels
    $tcp = $tunnels | Where-Object { $_.public_url -like 'tcp://*' } | Select-Object -First 1
    if ($tcp) { $addr = $tcp.public_url -replace '^tcp://', ''; break }
  } catch {}
}

if (-not $addr) {
  Write-Host ""
  Write-Host "Tunnel did not come up within 15s. Open http://localhost:4040 to see why." -ForegroundColor Red
  Write-Host "Common causes:"
  Write-Host "  - ERR_NGROK_8013: free accounts must add a card: https://dashboard.ngrok.com/settings#id-verification"
  Write-Host "  - ERR_NGROK_121:  agent too old — run: ngrok update"
  exit 1
}

$parts = $addr -split ':'
$dbHost = $parts[0]
$dbPort = $parts[1]

Write-Host ""
Write-Host "Tunnel is live: $addr" -ForegroundColor Green
Write-Host ""
Write-Host "Put these in Vercel -> your project -> Settings -> Environment Variables"
Write-Host "(all environments), then REDEPLOY:"
Write-Host ""
Write-Host "  DB_HOST = $dbHost"
Write-Host "  DB_PORT = $dbPort"
Write-Host "  DB_USER = vercel"
Write-Host "  DB_NAME = storepanel"
Write-Host "  DB_PASSWORD = (value of VERCEL_DB_PASSWORD in the project .env)"
Write-Host ""
try {
  Set-Clipboard -Value $dbHost
  Write-Host "DB_HOST copied to clipboard."
} catch {}
Write-Host ""
Write-Host "Inspector: http://localhost:4040"
Write-Host "This window can be closed; the agent keeps running in the background."
Write-Host "To stop the tunnel:  taskkill /IM ngrok.exe /F"
