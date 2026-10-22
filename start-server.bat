@echo off
cd /d "%~dp0"
if "%DEEPSEEK_API_KEY%"=="" (
  set /p DEEPSEEK_API_KEY=DeepSeek API Key: 
)
if "%DEEPSEEK_MODEL%"=="" set DEEPSEEK_MODEL=deepseek-flash
echo Starting Arknights Calendar Studio...
echo Open http://127.0.0.1:8787
node server.js
pause
