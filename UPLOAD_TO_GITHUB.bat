@echo off
setlocal
if "%~1"=="" (
  echo.
  echo Usage:
  echo   UPLOAD_TO_GITHUB.bat https://github.com/USERNAME/REPOSITORY.git
  echo.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed or is not available in PATH.
  pause
  exit /b 1
)
if not exist .git git init
git add .
git commit -m "Pong Network Arena 2.1 - mirrored bricks and GitHub deployment" 2>nul
git branch -M main
git remote remove origin 2>nul
git remote add origin "%~1"
git push -u origin main
if errorlevel 1 (
  echo.
  echo Upload failed. Confirm your GitHub sign-in and repository URL.
) else (
  echo.
  echo Project uploaded successfully.
)
pause
