# UNO Dev Server - Live Code Updates
$Host.UI.RawUI.WindowTitle = "UNO Dev Server (Live Reload)"

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   UNO Dev Server - Live Code Updates" -ForegroundColor Cyan  
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting development server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "When ready, open: " -NoNewline
Write-Host "http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "Make changes to CSS/JS files and they will" -ForegroundColor White
Write-Host "update instantly without refreshing!" -ForegroundColor White
Write-Host ""
Write-Host "Press " -NoNewline
Write-Host "Ctrl+C" -ForegroundColor Red -NoNewline
Write-Host " to stop the server."
Write-Host ""

npm run dev
