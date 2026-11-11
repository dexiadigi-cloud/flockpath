@echo off
REM Flockpath local run, Windows.
REM Starts the Flockpath web app AND the generation worker together.
REM This is a local web app, not a desktop app: the app opens in
REM your browser at http://localhost:3000.
REM Windows note: this script is UNTESTED on Windows as of Nov 2, 2026.
REM It was tested on Linux. Run it once on Windows and report any
REM error line before a pastor uses it.
REM Stop: close this window, then run stop-flockpath.bat to stop
REM the worker if it is still running.
cd /d "%~dp0\.."
where node >nul 2>nul || (echo Flockpath: Node.js is not installed. Install Node 20 or newer, then run this script again. & exit /b 1)
where npm >nul 2>nul || (echo Flockpath: npm is not installed. Install Node 20 or newer, then run this script again. & exit /b 1)
where python >nul 2>nul || (echo Flockpath: Python is not installed. Install Python 3.11 or newer, then run this script again. & exit /b 1)
python -c "import llama_cpp" >nul 2>nul || (echo Flockpath: Python package llama-cpp-python is not installed. Run: python -m pip install llama-cpp-python, then run this script again. & exit /b 1)
if not exist "models\Qwen3.5-4B-S-TS-Q4_K_S.gguf" (
  echo Flockpath: model not found, downloading about 1.8 GB ^(one time only^)...
  if not exist models mkdir models
  curl -L -o "models\Qwen3.5-4B-S-TS-Q4_K_S.gguf" "https://huggingface.co/TheStageAI/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-S-TS-Q4_K_S.gguf" || (echo Flockpath: model download failed. & exit /b 1)
)
certutil -hashfile "models\Qwen3.5-4B-S-TS-Q4_K_S.gguf" SHA256 | findstr /C:"9f020bfc77a9503a641e3e0511de04b4bfba16b9facfa62c3772b4f8e318ba55" >nul || (echo Flockpath: model hash does not match. Delete models\Qwen3.5-4B-S-TS-Q4_K_S.gguf and run this script again. & exit /b 1)
if not exist node_modules (
  echo Flockpath: installing app packages ^(one time only^)...
  call npm ci || call npm install || (echo Flockpath: npm install failed. & exit /b 1)
)
if not exist .next (
  echo Flockpath: building the app ^(one time only, then cached^)...
  call npm run build || (echo Flockpath: app build failed. & exit /b 1)
)
if not exist data mkdir data
start "Flockpath worker" /min cmd /c "python scripts\generate_worker.py --loop >> data\worker.log 2>&1"
echo Flockpath: worker started, log data\worker.log.
echo Flockpath: open http://localhost:3000 in your browser.
start http://localhost:3000
call npm run start
call stop-flockpath.bat
