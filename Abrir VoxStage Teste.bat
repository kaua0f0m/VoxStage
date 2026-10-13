@echo off
setlocal
title VoxStage 1.1.1
if not exist "%~dp0releases\V1.1.1\VoxStage-Windows-x64\VoxStage.exe" (
  echo A versao de testes Windows ainda nao foi gerada.
  pause
  exit /b 1
)
start "" /d "%~dp0releases\V1.1.1\VoxStage-Windows-x64" "%~dp0releases\V1.1.1\VoxStage-Windows-x64\VoxStage.exe"
