@echo off
setlocal
rem ============================================================================
rem  SerchTube Music - instalar una copia nueva
rem
rem  Descomprimi el ZIP y ejecuta este archivo UNA vez. Instala dependencias,
rem  crea .env si falta, arranca SerchTube y registra el autoinicio.
rem
rem  Opciones: -SinAutoInicio | -Puerto 3000
rem ============================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-serchtube.ps1" %*
if errorlevel 1 (
  echo.
  echo No se pudo completar la instalacion. Revisa el mensaje de arriba.
  pause
)
endlocal
