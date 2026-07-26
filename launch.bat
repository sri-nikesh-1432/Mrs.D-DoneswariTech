@echo off
title Doneswari AI Telecaller - Launcher

echo Starting backend on http://127.0.0.1:8000 ...
start "Backend" cmd /k "cd /d "%~dp0backend" && python -m uvicorn app:app --host 127.0.0.1 --port 8000"

echo Waiting for backend to start...
timeout /t 3 /nobreak >nul

echo Starting frontend on http://localhost:3000 ...
start "Frontend" cmd /k "cd /d "%~dp0frontend" && python -m http.server 3000"

timeout /t 2 /nobreak >nul
echo.
echo  ✅ Frontend URL: http://localhost:3000
echo  ✅ Backend API:  http://127.0.0.1:8000
echo  ✅ API Docs:     http://127.0.0.1:8000/docs
echo.
start http://localhost:3000
