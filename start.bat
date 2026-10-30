@echo off
chcp 65001 >nul
title Pandanix
cd /d "%~dp0"
rem 회사 프록시(HTTPS_PROXY)가 설정돼 있으면 Node 가 그 값을 쓰도록 한다 (Node 22.21+)
set NODE_USE_ENV_PROXY=1

where node >nul 2>nul
if errorlevel 1 (
  echo [Pandanix] Node.js 가 설치되어 있지 않습니다.
  echo           https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [Pandanix] 처음 실행: 의존성을 설치합니다 ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [Pandanix] npm install 실패. 네트워크/프록시를 확인하세요.
    pause
    exit /b 1
  )
)

echo [Pandanix] 서버를 시작합니다. 브라우저가 자동으로 열립니다.
echo           종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
set PANDANIX_OPEN=1
node server.js
pause
