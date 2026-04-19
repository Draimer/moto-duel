@echo off
setlocal
cd /d "%~dp0"

set "ROOT=%CD%"
set "BRIDGE_EXE=%ROOT%\MouseBridge\MouseBridge\bin\Debug\net8.0-windows\MouseBridge.exe"
if not exist "%BRIDGE_EXE%" set "BRIDGE_EXE=%ROOT%\MouseBridge\MouseBridge\bin\Debug\net10.0\MouseBridge.exe"

if exist "%BRIDGE_EXE%" (
  start "Moto Duel MouseBridge" "%BRIDGE_EXE%"
) else (
  echo MouseBridge.exe not found. Expected at:
  echo   %BRIDGE_EXE%
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "Moto Duel Server" cmd /k "cd /d ""%ROOT%"" && py -m http.server 8000"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    start "Moto Duel Server" cmd /k "cd /d ""%ROOT%"" && python -m http.server 8000"
  ) else (
    echo Python or py launcher not found.
    echo Please install Python, then run this file again.
    pause
    exit /b 1
  )
)

timeout /t 3 /nobreak >nul
start "" "http://localhost:8000/index.html"
endlocal
