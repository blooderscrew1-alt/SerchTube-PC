@echo off
setlocal
rem Arranca SerchTube en Chrome. Útil cuando el reconocimiento de voz de Edge
rem devuelve "network" (fallo del servicio Web Speech de Edge).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-serchtube.ps1" -Navegador chrome
if errorlevel 1 (
  echo.
  echo No se pudo iniciar con Chrome. Verifica que Chrome este instalado.
  echo Tambien podes probar "Iniciar SerchTube con Brave.bat".
  pause
)
endlocal
