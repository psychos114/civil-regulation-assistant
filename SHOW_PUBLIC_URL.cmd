@echo off
setlocal
title Regulation Assistant - Public URL
cd /d "%~dp0"

powershell.exe -NoProfile -Command "$files=Get-ChildItem -LiteralPath . -Filter 'public_tunnel*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending; $url=$null; foreach($file in $files){$text=Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue; $matches=[regex]::Matches($text,'https://[a-z0-9-]+\.trycloudflare\.com'); if($matches.Count -gt 0){$url=$matches[$matches.Count-1].Value; break}}; if($url){Set-Content -LiteralPath '.\PUBLIC_URL.txt' -Value @('Current public URL:',$url,'','Keep the backend and tunnel running while this address is in use.') -Encoding UTF8; Write-Host ''; Write-Host 'PUBLIC URL:' -ForegroundColor Green; Write-Host $url -ForegroundColor Cyan; Write-Host ''; Write-Host 'The address was also saved in PUBLIC_URL.txt.'}else{Write-Host ''; Write-Host 'No public URL was found yet.' -ForegroundColor Yellow; Write-Host 'Start start_internet_access.bat and wait about 30 seconds.'}"

echo.
pause
