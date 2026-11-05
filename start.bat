@echo off
cd /d "%~dp0"
if not defined HOST set "HOST=0.0.0.0"
npm start
pause
