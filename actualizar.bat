@echo off
setlocal
rem ============================================================================
rem  SerchTube Music - ACTUALIZADOR (un solo clic)
rem
rem  - NO NECESITA GIT: Descarga e instala cambios directamente desde GitHub.
rem  - NO NECESITA EJECUTAR NPM RUN DEV MANUALMENTE: Inicia el servidor y abre
rem    la aplicacion SerchTube en tu navegador automaticamente.
rem  - NO NECESITA NPM INSTALL CONSTANTE: Solo se ejecuta si cambian dependencias.
rem  - NO TOCA TUS CLAVES (.env), registros (logs/) ni configuraciones locales.
rem ============================================================================
title Actualizar SerchTube
cd /d "%~dp0"

echo ============================================================================
echo   SerchTube Music - Actualizando desde GitHub...
echo ============================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0scripts\update-serchtube.ps1' %*"
set PS_EXIT=%ERRORLEVEL%

if %PS_EXIT% NEQ 0 (
    echo.
    echo ============================================================================
    echo  [AVISO] No se pudo completar la actualizacion automatica.
    echo.
    echo  Si tu repositorio en GitHub es PRIVADO o tiene otro usuario:
    echo    1. Puedes ingresar tu token de GitHub cuando se solicite.
    echo    2. O agregar en tu archivo .env:
    echo       GITHUB_REPO=https://github.com/tu-usuario/tu-repo
    echo       GITHUB_TOKEN=tu_token_aqui
    echo ============================================================================
    echo.
    pause
) else (
    echo.
    echo [OK] Proceso completado exitosamente.
    timeout /t 5 /nobreak >nul 2>&1 || pause
)

endlocal
