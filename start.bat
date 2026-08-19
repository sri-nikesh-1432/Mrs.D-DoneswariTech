@echo off
title Doneswari AI Telecaller — Launcher
color 0A

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║         Doneswari AI Telecaller — Starting...           ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ── Verify .env exists ────────────────────────────────────────────────────────
if not exist "%BACKEND%\.env" (
    echo  [WARNING] backend\.env not found — copying from .env.example
    copy "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
    echo  [ACTION REQUIRED] Edit backend\.env and set your GROQ_API_KEY
    echo  Get your free key at: https://console.groq.com
    echo.
    pause
)

:: ── Verify API key is set ─────────────────────────────────────────────────────
findstr /C:"your_groq_api_key_here" "%BACKEND%\.env" >nul 2>&1
if %errorlevel%==0 (
    echo  [WARNING] GROQ_API_KEY is still the placeholder value.
    echo  Edit backend\.env and replace: your_groq_api_key_here
    echo.
    pause
)

:: ── Ensure runtime directories exist ─────────────────────────────────────────
if not exist "%BACKEND%\logs"          mkdir "%BACKEND%\logs"
if not exist "%BACKEND%\static"        mkdir "%BACKEND%\static"
if not exist "%BACKEND%\static\audio"  mkdir "%BACKEND%\static\audio"

:: ── Start Backend ─────────────────────────────────────────────────────────────
echo  Starting backend on http://localhost:8000 ...
start "Doneswari Backend" cmd /k "cd /d "%BACKEND%" && python -m uvicorn app.main:app --reload --host localhost --port 8000"

:: ── Wait for backend to initialise ───────────────────────────────────────────
echo  Waiting for backend to start...
timeout /t 4 /nobreak >nul

:: ── Start Frontend ────────────────────────────────────────────────────────────
echo  Starting frontend on http://localhost:5176 ...
start "Doneswari Frontend" cmd /k "cd /d "%FRONTEND%" && npm run dev"

:: ── Wait for Vite to start ────────────────────────────────────────────────────
timeout /t 3 /nobreak >nul

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║                   Both servers running!                  ║
echo  ║                                                          ║
echo  ║  🌐 Frontend:  http://localhost:5176                     ║
echo  ║  ⚙️  Backend:   http://localhost:8000                     ║
echo  ║  📖 API Docs:  http://localhost:8000/docs                ║
echo  ║                                                          ║
echo  ║  Close the Backend and Frontend windows to stop.         ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ── Open browser ─────────────────────────────────────────────────────────────
start http://localhost:5176

pause
