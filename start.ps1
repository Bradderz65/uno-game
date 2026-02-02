# UNO Multiplayer - Launch Script
# Run this script to start the game

$Host.UI.RawUI.WindowTitle = "UNO Multiplayer Game"

# Change to script directory
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   UNO Multiplayer - Starting..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Start the server as a background job
$serverJob = Start-Job -ScriptBlock {
    Set-Location $using:PSScriptRoot
    node server/index.js 2>&1
}

Write-Host "Waiting for server to start..." -ForegroundColor Yellow

# Wait for server to be ready (check output for ready message)
$ready = $false
$timeout = 30
$elapsed = 0

while (-not $ready -and $elapsed -lt $timeout) {
    Start-Sleep -Seconds 1
    $elapsed++
    
    $output = Receive-Job -Job $serverJob -Keep 2>$null
    if ($output -match "UNO Server Started") {
        $ready = $true
    }
}

if (-not $ready) {
    Write-Host "Server failed to start within $timeout seconds." -ForegroundColor Red
    Stop-Job -Job $serverJob
    Remove-Job -Job $serverJob
    Read-Host "Press Enter to exit"
    exit 1
}

# Extract network URL
$output = Receive-Job -Job $serverJob -Keep
$networkLine = $output | Select-String "Network:"
$networkUrl = if ($networkLine) { ($networkLine -split "Network:")[1].Trim() } else { "N/A" }

Write-Host ""
Write-Host "Server is ready!" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Local:   " -NoNewline -ForegroundColor White
Write-Host "http://localhost:3000" -ForegroundColor Green
Write-Host "   Network: " -NoNewline -ForegroundColor White
Write-Host $networkUrl -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Share the Network URL with other players!" -ForegroundColor Yellow
Write-Host ""

# Open browser
Start-Process "http://localhost:3000"

Write-Host "Press " -NoNewline
Write-Host "Enter" -ForegroundColor Red -NoNewline
Write-Host " to stop the server and exit..."
Write-Host ""

# Wait for user input
Read-Host | Out-Null

Write-Host "Stopping server..." -ForegroundColor Yellow

# Stop the server job
Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
Remove-Job -Job $serverJob -ErrorAction SilentlyContinue

# Also kill any remaining node processes for this project
Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $_.Kill()
    } catch {}
}

Write-Host "Done!" -ForegroundColor Green
