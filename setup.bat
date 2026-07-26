@echo off
title Doneswari AI Telecaller — Setup
color 0A

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║       Doneswari AI Telecaller — First-Time Setup        ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend

:: ── Check Python ──────────────────────────────────────────────────────────────
echo  [1/4] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)
python --version
echo.

:: ── Check Node.js ─────────────────────────────────────────────────────────────
echo  [2/4] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)
node --version
npm --version
echo.

:: ── Install Python dependencies ───────────────────────────────────────────────
echo  [3/4] Installing Python backend dependencies...
cd /d "%BACKEND%"
pip install -r requirements.txt --quiet --upgrade
if %errorlevel% neq 0 (
    echo  [ERROR] pip install failed. Check your Python/pip installation.
    pause & exit /b 1
)
echo  [OK] Python dependencies installed.
echo.

:: ── Install Node.js dependencies ──────────────────────────────────────────────
echo  [4/4] Installing frontend dependencies (Vite)...
cd /d "%FRONTEND%"
npm install --silent
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed. Check your Node.js installation.
    pause & exit /b 1
)
echo  [OK] Frontend dependencies installed.
echo.

:: ── Create .env if missing ────────────────────────────────────────────────────
if not exist "%BACKEND%\.env" (
    echo  Creating .env from .env.example...
    copy "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
    echo  [ACTION REQUIRED] Edit backend\.env and set your GROQ_API_KEY
    echo  Get your free key at: https://console.groq.com
    echo.
) else (
    echo  [OK] .env already exists.
)

:: ── Create required directories ───────────────────────────────────────────────
if not exist "%BACKEND%\logs"          mkdir "%BACKEND%\logs"
if not exist "%BACKEND%\static"        mkdir "%BACKEND%\static"
if not exist "%BACKEND%\static\audio"  mkdir "%BACKEND%\static\audio"
echo  [OK] Runtime directories ready.
echo.

echo  ╔══════════════════════════════════════════════════════════╗
echo  ║                    Setup Complete!                       ║
echo  ║                                                          ║
echo  ║  Next steps:                                             ║
echo  ║  1. Edit backend\.env  →  set GROQ_API_KEY               ║
echo  ║  2. Run start.bat to launch the application              ║
echo  ║                                                          ║
echo  ║  Frontend: http://localhost:5175                         ║
echo  ║  Backend:  http://localhost:8000                         ║
echo  ║  API Docs: http://localhost:8000/docs                    ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
pause
