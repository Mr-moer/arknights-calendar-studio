@echo off
cd /d "%~dp0"
set MOCK_AI=1
echo Starting Arknights Calendar Studio in MOCK AI mode...
echo Open http://127.0.0.1:8787
node server.js
pause
