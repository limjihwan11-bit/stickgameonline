@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Stick Game Online

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 Node.js를 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 필요한 패키지를 처음 한 번 설치합니다...
  call npm.cmd install
  if errorlevel 1 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
  )
)

echo.
echo 젓가락 온라인을 시작합니다.
echo 브라우저 주소: http://localhost:5173
echo 이 창을 닫으면 게임 서버도 종료됩니다.
echo.

start "" /b cmd /c "ping 127.0.0.1 -n 4 ^>nul ^& start http://localhost:5173"
call npm.cmd run dev

echo.
echo 서버가 종료되었습니다.
pause
