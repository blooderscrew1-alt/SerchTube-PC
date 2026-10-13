@echo off
setlocal
rem ============================================================================
rem  SerchTube Music - ACTUALIZAR (un solo clic)
rem
rem  NO NECESITA GIT. Descarga el ZIP de la ultima version desde GitHub, copia
rem  solo los archivos nuevos por encima y reinicia el servidor. Ejecuta
rem  "npm install" unicamente si cambiaron las dependencias (si no, no lo toca).
rem  No altera tus claves (.env), tus registros (logs) ni node_modules.
rem  Despues de actualizar ya NO hace falta ejecutar nada mas: el propio .bat
rem  arranca la app si estaba cerrada.
rem
rem  Si el repositorio de GitHub es PRIVADO: anade una linea GITHUB_TOKEN=tu_token
rem  al archivo .env (o pasa -Token tu_token). Con repos publicos no hace falta.
rem
rem  Opciones: -SinReiniciar | -Forzar | -Rama otra-rama | -SinDependencias | -Token XXX
rem ============================================================================
title Actualizar SerchTube
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-serchtube.ps1" %*
echo.
pause
endlocal
