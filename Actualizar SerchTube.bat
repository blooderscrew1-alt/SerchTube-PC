@echo off
setlocal
rem ============================================================================
rem  SerchTube Music - ACTUALIZAR (un solo clic)
rem
rem  Descarga solo lo que cambio desde GitHub, ejecuta "npm install" unicamente si
rem  cambiaron las dependencias y reinicia el servidor. No toca tus claves
rem  (.env), tus registros (logs) ni node_modules.
rem
rem  Opciones: -SinReiniciar | -Forzar | -Rama otra-rama | -SinDependencias
rem ============================================================================
title Actualizar SerchTube
rem Si existe el actualizador completo (codigo + servidor compilado del Release + reinicio
rem seguro), se usa ese: asi este mismo .bat aplica tambien los cambios del servidor.
if exist "%~dp0scripts\actualizar-completo.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\actualizar-completo.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-serchtube.ps1" %*
)
echo.
pause
endlocal
