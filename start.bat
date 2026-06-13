@echo off

REM Start backend
start "Backend" cmd /k "cd /d C:\Users\surya\Documents\ReflexNet\backend && npm run dev"

REM Start frontend
start "Frontend" cmd /k "cd /d C:\Users\surya\Documents\ReflexNet\frontend && npm run dev"

REM Wait 5 seconds
timeout /t 2 /nobreak >nul

REM Open the app
start http://localhost:5173/