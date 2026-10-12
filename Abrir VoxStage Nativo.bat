@echo off
setlocal
title VoxStage Nativo

if exist "%~dp0releases\V1.0\VoxStage-Windows-x64\VoxStage.exe" (
  start "" "%~dp0releases\V1.0\VoxStage-Windows-x64\VoxStage.exe"
  exit /b 0
)

cd /d "%~dp0native-app"
if errorlevel 1 (
  echo Nao encontrei a pasta native-app ao lado deste arquivo.
  pause
  exit /b 1
)

set "NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*\node-v*-win-x64") do if not defined NODE_EXE if exist "%%~fD\node.exe" set "NODE_EXE=%%~fD\node.exe"
if not exist "%NODE_EXE%" (
  echo Node.js nao foi encontrado. Instale o Node.js LTS ou adicione node.exe ao PATH.
  pause
  exit /b 1
)

if not exist "node_modules\@tauri-apps\cli\tauri.js" (
  echo Dependencias nativas ausentes em native-app\node_modules.
  echo Instale as dependencias do projeto antes de iniciar o VoxStage nativo.
  pause
  exit /b 1
)

echo Iniciando o VoxStage em uma janela nativa do Windows...
echo A primeira abertura pode levar alguns minutos para compilar. Mantenha esta janela aberta.
"%NODE_EXE%" scripts\dev.mjs
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo O VoxStage nativo encerrou com codigo %EXIT_CODE%.
  echo Confira a mensagem de erro exibida acima.
  pause
)

exit /b %EXIT_CODE%
