@echo off
chcp 65001 >nul
title Pandanix
cd /d "%~dp0"
rem 회사 프록시(HTTPS_PROXY)가 설정돼 있으면 Node 가 그 값을 쓰도록 한다 (Node 22.21+)
set NODE_USE_ENV_PROXY=1

where node >nul 2>nul
if errorlevel 1 (
  echo [Pandanix] Node.js 가 설치되어 있지 않습니다.
  echo           https://nodejs.org 에서 LTS 버전^(22 이상^)을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 22 (
  echo [Pandanix] Node.js 22 이상이 필요합니다. 현재:
  node -v
  echo           https://nodejs.org 에서 LTS 버전을 설치하세요.
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
set RESTARTS=0

:run
node server.js
set CODE=%errorlevel%
if %CODE%==0 goto end
rem 비정상 종료 시 자동 재시작 (최대 5회). 원인은 data\logs\pandanix.log 참고
set /a RESTARTS+=1
if %RESTARTS% GTR 5 (
  echo [Pandanix] 서버가 반복해서 종료되어 재시작을 멈춥니다. data\logs\pandanix.log 를 확인하세요.
  goto end
)
echo [Pandanix] 서버가 종료 코드 %CODE% 로 끝났습니다. 3초 후 다시 시작합니다 ^(%RESTARTS%/5^)...
timeout /t 3 /nobreak >nul
set PANDANIX_OPEN=0
goto run

:end
pause
