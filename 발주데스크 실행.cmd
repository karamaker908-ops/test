@echo off
setlocal
chcp 65001 >nul
title Kennya Order Desk
pushd "%~dp0" || goto failed
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE_EXE%" goto run
set "NODE_EXE=node.exe"
where node.exe >nul 2>&1 || goto missing
:run
"%NODE_EXE%" "%~dp0server.mjs" --desktop
if errorlevel 1 goto failed
exit /b 0
:missing
echo Node.js 24 이상을 설치한 뒤 다시 실행해 주세요.
pause
exit /b 1
:failed
echo 발주데스크 실행 중 오류가 발생했습니다. 위 오류 내용을 확인해 주세요.
pause
exit /b 1
