@echo off
cd /d "%~dp0"

echo ========================================
echo  Mrs. D - AI Voice Receptionist Platform
echo  Retell AI-level human conversation
echo ========================================
echo.

:: Start Backend
echo [1/2] Starting Backend on port 8000...
start "Mrs.D Backend" cmd /c "cd /d backend && python -m uvicorn app.main:app --reload --host localhost --port 8000"

:: Wait for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Frontend
echo [2/2] Starting Frontend on port 5176...
start "Mrs.D Frontend" cmd /c "cd /d frontend && npx vite --port 5176 --host localhost"

echo.
echo Frontend:  http://localhost:5176
echo Backend:   http://localhost:8000
echo API Docs:  http://localhost:8000/docs
echo WebSocket: ws://localhost:8000/ws/voice
echo.
:: Open browser
start http://localhost:5176
pause
