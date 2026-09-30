# UNO Multiplayer - launch script for Windows PowerShell
$Host.UI.RawUI.WindowTitle = "UNO Multiplayer"
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { Read-Host "npm install failed. Press Enter to exit"; exit 1 }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   UNO Multiplayer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Run the server as a child process so we can stop exactly that process later.
$server = Start-Process -FilePath "node" -ArgumentList "server/index.js" -NoNewWindow -PassThru

Start-Sleep -Seconds 2
if ($server.HasExited) {
    Read-Host "The server failed to start. Press Enter to exit"
    exit 1
}

Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "Share the Network address above with players on your Wi-Fi." -ForegroundColor Yellow
Write-Host "Press Enter to stop the server..." -ForegroundColor White
Read-Host | Out-Null

Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
Write-Host "Server stopped." -ForegroundColor Green
