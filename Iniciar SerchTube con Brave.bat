@echo off
setlocal
rem Arranca SerchTube en Brave. Útil cuando el reconocimiento de voz de Edge
rem devuelve "network" (fallo del servicio Web Speech de Edge).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-serchtube.ps1" -Navegador brave
if errorlevel 1 (
  echo.
  echo No se pudo iniciar con Brave. Verifica que Brave este instalado.
  echo Tambien podes probar "Iniciar SerchTube con Chrome.bat".
  pause
)
endlocal
