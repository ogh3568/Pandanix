@echo off
chcp 65001 >nul
title Pandanix Doctor
cd /d "%~dp0"
rem 회사 프록시(HTTPS_PROXY)가 설정돼 있으면 Node 가 그 값을 쓰도록 한다 (Node 22.21+)
set NODE_USE_ENV_PROXY=1
where node >nul 2>nul
if errorlevel 1 (
  echo [Pandanix] Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치하세요.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if "%~1"=="--live" (
  node server\doctor-cli.js --live
) else (
  node server\doctor-cli.js
  echo.
  echo API 연결까지 테스트하려면:  doctor.bat --live
)
pause
