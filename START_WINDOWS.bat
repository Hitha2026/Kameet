@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if "%JWT_SECRET%"=="" set JWT_SECRET=local-development-secret-change-before-deployment
set PORT=3000
start "Pong Network Arena" cmd /k npm start
timeout /t 3 >nul
start http://localhost:3000
