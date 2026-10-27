@echo off
setlocal
cd /d "%~dp0"

rem ChatStory local preview launcher for Windows.
rem The development server binds to loopback only; no LAN exposure.
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS first:
  echo https://nodejs.org/en/download
  pause
  exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm was not found. Please install Node.js with npm.
  pause
  exit /b 1
)

if not exist "node_modules\next\package.json" (
  echo First launch: installing application dependencies...
  call npm ci --no-fund --no-audit
  if errorlevel 1 (
    echo The installation failed. No chat files were loaded.
    pause
    exit /b 1
  )
)

rem Open a browser only after the local app responds.
start "ChatStory browser opener" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "$u='http://127.0.0.1:3000/'; for($i=0;$i -lt 120;$i++){try{$r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 1;if($r.StatusCode -ge 200){Start-Process $u;exit 0}}catch{} Start-Sleep -Seconds 1}"

echo Starting ChatStory on this computer only:
echo http://127.0.0.1:3000/
echo Keep this window open while using ChatStory. Close with Ctrl+C.
call npm run dev -- --hostname 127.0.0.1 --port 3000

echo ChatStory stopped.
pause
endlocal
