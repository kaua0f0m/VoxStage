@echo off
setlocal
title VoxStage 2.0.0 Debug
if not exist "%~dp0releases\V2.0.0-debug\VoxStage-Windows-x64\VoxStage.exe" (
  echo A versao de testes Windows ainda nao foi gerada.
  pause
  exit /b 1
)
start "" /d "%~dp0releases\V2.0.0-debug\VoxStage-Windows-x64" "%~dp0releases\V2.0.0-debug\VoxStage-Windows-x64\VoxStage.exe"
