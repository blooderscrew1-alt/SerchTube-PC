<#
  SerchTube Music - Actualizar en un clic (sin volver a descargar ni reinstalar)
  ============================================================================

  Que hace:
    1. Comprueba que esta carpeta es el proyecto.
    2. Descarga el ZIP de la rama 'main' desde GitHub (no necesita Git instalado)
       y copia SOLO los archivos nuevos por encima de esta carpeta.
       Tus claves (.env), tus registros (logs/) y node_modules/ NO se tocan.
    3. Ejecuta "npm install" UNICAMENTE si cambio package.json / package-lock.json /
       bun.lock o si falta node_modules. Si no cambio nada, no pierde tiempo.
    4. Reinicia el servidor si estaba corriendo, para que tome los cambios.
    5. Muestra un resumen: de que version a que version y que hizo.

  METODO PRINCIPAL (ZIP): basta Windows + PowerShell (viene incluido). No se
  necesita Git ni haber clonado el repo. Solo si el ZIP trae dependencias nuevas
  ('package.json' cambiado) se ejecuta 'npm install'; si no, no pierde tiempo.

  REPOSITORIO PRIVADO: hace falta un token de GitHub con permiso de lectura
  (scope 'repo' o fine-grained con Contents: Read-only). Se puede indicar de
  tres formas: param -Token, variable de entorno GITHUB_TOKEN, o una linea
  GITHUB_TOKEN=... dentro del archivo .env del proyecto (recomendado: asi el
  .bat funciona con doble clic sin configurar nada mas). Con repos publicos
  no se necesita token.

  Uso:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update-serchtube.ps1
    powershell ... -File scripts\update-serchtube.ps1 -SinReiniciar
    powershell ... -File scripts\update-serchtube.ps1 -Forzar      (descarta cambios locales)
    powershell ... -File scripts\update-serchtube.ps1 -Rama otra-rama
    powershell ... -File scripts\update-serchtube.ps1 -SinDependencias

  Pensado para CUALQUIER PC con Windows: no depende de rutas ni de este equipo.
#>
[CmdletBinding()]
param(
  [string]$Rama = 'main',

  # Repositorio a usar cuando la carpeta no es un repo git (modo ZIP)
  [string]$Repo = 'https://github.com/blooderscrew1-alt/SerchTube-PC.git',

  # Token de GitHub (solo hace falta si el repositorio es PRIVADO).
  # Tambien se puede indicar con la variable de entorno GITHUB_TOKEN,
  # o guardandolo en el archivo .env del proyecto: GITHUB_TOKEN=...
  [string]$Token = '',

  [int]$Puerto = 3000,

  # Descarta los cambios locales de esta carpeta en vez de abortar
  [switch]$Forzar,

  # No tocar el servidor (util si lo manejas tú)
  [switch]$SinReiniciar,

  # Reiniciar el servidor aunque no haya cambios (para aplicar cambios a mano)
  [switch]$Reiniciar,

  # No ejecutar npm install aunque hayan cambiado las dependencias
  [switch]$SinDependencias,

  # Instalar lo que falte (Node.js / Git) con winget si es posible
  [switch]$InstalarRequisitos
)

$ErrorActionPreference = 'Stop'

# Forzar TLS 1.2 y 1.3 en PowerShell para evitar fallos de conexión segura con GitHub
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
} catch {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
}

$Raiz = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Raiz 'logs'
$NombreLog = 'actualizar.log'

function Write-Paso([string]$m) { Write-Host "[Actualizar] $m" -ForegroundColor Cyan; Write-Registro $m }
function Write-Aviso([string]$m) { Write-Host "[Actualizar] $m" -ForegroundColor Yellow; Write-Registro "AVISO: $m" }
function Write-Mal([string]$m) { Write-Host "[Actualizar] $m" -ForegroundColor Red; Write-Registro "ERROR: $m" }
function Write-Registro([string]$m) {
  try {
    if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    Add-Content -LiteralPath (Join-Path $LogDir $NombreLog) -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m)
  } catch { }
}

function Save-EnvVar([string]$key, [string]$val) {
  try {
    $ruta = Join-Path $Raiz '.env'
    $lineas = @()
    if (Test-Path -LiteralPath $ruta) {
      $lineas = @(Get-Content -LiteralPath $ruta)
    }
    $encontrado = $false
    $nuevas = @()
    foreach ($lin in $lineas) {
      if ($lin -match "^\s*(?:export\s+)?$key\s*=") {
        $nuevas += "$key=`"$val`""
        $encontrado = $true
      } else {
        $nuevas += $lin
      }
    }
    if (-not $encontrado) {
      $nuevas += "$key=`"$val`""
    }
    Set-Content -LiteralPath $ruta -Value $nuevas -Encoding UTF8
  } catch {
    Write-Aviso "No se pudo guardar $key en el archivo .env: $($_.Exception.Message)"
  }
}

function Test-Comando([string]$nombre) { return [bool](Get-Command $nombre -ErrorAction SilentlyContinue) }
function Get-ServidorPid {
  try {
    return @(Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch { return @() }
}
function Stop-Servidor {
  $pids = @(Get-ServidorPid)
  if ($pids.Count -eq 0) { return $false }
  foreach ($proceso in $pids) {
    try {
      $p = Get-Process -Id $proceso -ErrorAction SilentlyContinue
      if ($p) {
        Write-Paso "Deteniendo el servidor (PID $proceso, $($p.ProcessName))..."
        Stop-Process -Id $proceso -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 500
    if (@(Get-ServidorPid).Count -eq 0) { break }
  }
  return $true
}
function Start-Servidor {
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
  $log = Join-Path $LogDir 'servidor.log'
  $metodos = @()
  if (Test-Path -LiteralPath (Join-Path $Raiz 'dist\server.cjs')) { $metodos += 'node dist\server.cjs' }
  $metodos += 'npm run dev'
  foreach ($metodo in $metodos) {
    Write-Paso "Arrancando el servidor con: $metodo"
    Start-Process -FilePath 'cmd.exe' -WorkingDirectory $Raiz -WindowStyle Hidden `
      -ArgumentList ('/c ' + $metodo + ' >> "' + $log + '" 2>&1')
    $limite = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $limite) {
      try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Puerto/api/health" -UseBasicParsing -TimeoutSec 3
        if ([int]$r.StatusCode -eq 200) { Write-Paso "Servidor listo en http://localhost:$Puerto"; return $true }
      } catch { }
      Start-Sleep -Milliseconds 800
    }
    Write-Aviso "'$metodo' no respondio; se prueba el siguiente metodo."
  }
  Write-Aviso "No se pudo confirmar el arranque. Revisa logs\servidor.log"
  return $false
}
function Copy-Tree {
  param([System.IO.FileSystemInfo]$Origen, [string]$Destino)
  # Copia recursiva respetando las exclusiones del updater (node_modules, logs,
  # dist, .git y cualquier .env*). Solo se usa si no existe robocopy.
  $nombresIgnorar = @('node_modules','logs','dist','.git')
  if ($Origen.PSIsContainer) {
    if ($nombresIgnorar -contains $Origen.Name) { return }
    if (-not (Test-Path -LiteralPath $Destino)) { New-Item -ItemType Directory -Force -Path $Destino | Out-Null }
    Get-ChildItem -LiteralPath $Origen.FullName -Force | ForEach-Object {
      Copy-Tree -Origen $_ -Destino (Join-Path $Destino $_.Name)
    }
  } else {
    if ($Origen.Name -like '.env*') { return }
    $dirPadre = Split-Path -Parent $Destino
    if (-not (Test-Path -LiteralPath $dirPadre)) { New-Item -ItemType Directory -Force -Path $dirPadre | Out-Null }
    Copy-Item -LiteralPath $Origen.FullName -Destination $Destino -Force
  }
}
function Get-HashArchivo([string]$ruta) {
  if (-not (Test-Path -LiteralPath $ruta)) { return '' }
  return (Get-FileHash -LiteralPath $ruta -Algorithm SHA256).Hash
}

function Instalar-ConWinget([string]$id, [string]$nombre) {
  if (-not (Test-Comando 'winget')) { return $false }
  Write-Paso "Instalando $nombre con winget ($id)..."
  try {
    & winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent
  } catch {
    Write-Aviso "winget no pudo instalar $nombre."
    return $false
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path', 'User')
  return $true
}

function Comprobar-Requisitos {
  # Para ACTUALIZAR solo hacen falta Windows + PowerShell (viene incluido):
  # se baja el ZIP de GitHub, no hace falta Git. Node/npm solo se necesitan
  # si cambian las dependencias o para arrancar el servidor.
  $faltan = @()
  if (-not (Test-Comando 'node') -or -not (Test-Comando 'npm')) {
    Write-Aviso "No se detecta Node.js/npm (solo hace falta si cambian las dependencias)."
  }
  if ($faltan.Count -eq 0) {
    Write-Paso "Requisitos OK: no hace falta Git, se actualiza descargando el ZIP de GitHub."
    return
  }
  foreach ($f in $faltan) { Write-Aviso "Falta $($f.Nombre)  ->  $($f.Url)" }
  if ($InstalarRequisitos) {
    foreach ($f in $faltan) { Instalar-ConWinget $f.Id $f.Nombre | Out-Null }
    $siguen = @()
    if (-not (Test-Comando 'node') -or -not (Test-Comando 'npm')) { $siguen += 'Node.js' }
    if ($siguen.Count -gt 0) {
      Write-Aviso "Todavia faltan: $($siguen -join ', '). Cierra esta ventana, vuelve a abrirla y ejecuta de nuevo."
    } else {
      Write-Paso "Requisitos instalados."
    }
  } elseif (Test-Comando 'winget') {
    Write-Paso "Puedo instalarlos yo: vuelve a ejecutar con -InstalarRequisitos"
  }
}

# ------------------------------------------------------------------ 0) Entorno
Write-Paso "Proyecto: $Raiz"
if (-not (Test-Path -LiteralPath (Join-Path $Raiz 'package.json')) -or
    -not (Test-Path -LiteralPath (Join-Path $Raiz 'server.ts'))) {
  Write-Mal "Esta carpeta no parece el proyecto de SerchTube (falta package.json o server.ts)."
  exit 1
}

$esRepo = Test-Path -LiteralPath (Join-Path $Raiz '.git')

# ------------------------------------------- 0b) Requisitos (sirve en PC nuevas)
Comprobar-Requisitos

$antes = ''
$despues = ''
$antesTitulo = ''
$despuesTitulo = ''
$detras = 0
$cambiado = $false
$stasheado = $false
$depsSaltadas = $false
$hashPackageAntes = Get-HashArchivo (Join-Path $Raiz 'package.json')
$hashLockAntes = Get-HashArchivo (Join-Path $Raiz 'package-lock.json')

# ================================================ 1) COMPROBACION RAPIDA (sin Git)
# Se pide a la API de GitHub el ultimo commit de la rama y se compara con el que
# se guardo localmente en .version-remota.txt. Si coincide, no se descarga nada.
$archivoVersion = Join-Path $Raiz '.version-remota.txt'
$versionLocal = ''
if (Test-Path -LiteralPath $archivoVersion) {
  $versionLocal = (Get-Content -LiteralPath $archivoVersion -Raw).Trim()
}

# Auto-deteccion de repositorio si existe .git/config (incluso sin git.exe instalado)
if (Test-Path -LiteralPath (Join-Path $Raiz '.git\config')) {
  try {
    $gitCfg = Get-Content -LiteralPath (Join-Path $Raiz '.git\config') -Raw
    if ($gitCfg -match 'url\s*=\s*(?:https?://github\.com/|git@github\.com:)([^\s\r\n]+)') {
      $Repo = "https://github.com/$($matches[1].Trim() -replace '\.git$', '').git"
    }
  } catch { }
}

# ---- Token o Repo personalizado en .env ----
$rutaEnv = Join-Path $Raiz '.env'
if (Test-Path -LiteralPath $rutaEnv) {
  try {
    $lineasEnv = Get-Content -LiteralPath $rutaEnv
    foreach ($lin in $lineasEnv) {
      if (-not $Token -and $lin -match '^\s*(?:export\s+)?GITHUB_TOKEN\s*=\s*(.+?)\s*$') {
        $Token = $matches[1].Trim().Trim('"').Trim("'")
      }
      if ($lin -match '^\s*(?:export\s+)?GITHUB_REPO\s*=\s*(.+?)\s*$') {
        $Repo = $matches[1].Trim().Trim('"').Trim("'")
      }
    }
  } catch { }
}
if (-not $Token) { $Token = [Environment]::GetEnvironmentVariable('GITHUB_TOKEN') }

$limpio = $Repo -replace '\.git$', '' -replace '^https?://github\.com/', ''
$partes = $limpio -split '/'
if ($partes.Count -lt 2) { Write-Mal "No pude interpretar el repositorio: $Repo"; exit 1 }
$owner = $partes[0]; $nombreRepo = $partes[1]

function Download-GitHubZip {
  param(
    [string]$Owner,
    [string]$RepoName,
    [string]$Branch,
    [string]$AuthToken,
    [string]$OutZip
  )

  $branches = @($Branch)
  if ($Branch -eq 'main') { $branches += 'master' }
  elseif ($Branch -eq 'master') { $branches += 'main' }

  $ownersToTry = @($Owner)
  if ($Owner -eq 'blooderscrew1-alt') { $ownersToTry += 'blooderscrewi-alt' }
  elseif ($Owner -eq 'blooderscrewi-alt') { $ownersToTry += 'blooderscrew1-alt' }

  if (Test-Path -LiteralPath $OutZip) {
    Remove-Item -Force -LiteralPath $OutZip -ErrorAction SilentlyContinue
  }

  foreach ($o in $ownersToTry) {
    foreach ($b in $branches) {
      $apiHeaders = @{
        'User-Agent' = 'SerchTube-Updater'
        'Accept'     = 'application/vnd.github+json'
      }
      if ($AuthToken) { $apiHeaders['Authorization'] = "Bearer $AuthToken" }

      $apiUrl = "https://api.github.com/repos/$o/$RepoName/zipball/$b"
      try {
        Write-Paso "Probando descarga desde API de GitHub ($o / rama $b)..."
        Invoke-WebRequest -Uri $apiUrl -OutFile $OutZip -UseBasicParsing -TimeoutSec 180 -Headers $apiHeaders
        if ((Test-Path -LiteralPath $OutZip) -and ((Get-Item -LiteralPath $OutZip).Length -gt 500)) {
          return @{ Success = $true; Branch = $b; Owner = $o; Method = 'api' }
        }
      } catch {
        Write-Registro "API zipball ($o / $b) no disponible: $($_.Exception.Message)"
      }

      $codeloadUrl = "https://codeload.github.com/$o/$RepoName/zip/refs/heads/$b"
      try {
        Write-Paso "Probando descarga directa de codeload ($o / rama $b)..."
        $clHeaders = @{ 'User-Agent' = 'SerchTube-Updater' }
        if ($AuthToken) { $clHeaders['Authorization'] = "Bearer $AuthToken" }
        Invoke-WebRequest -Uri $codeloadUrl -OutFile $OutZip -UseBasicParsing -TimeoutSec 180 -Headers $clHeaders
        if ((Test-Path -LiteralPath $OutZip) -and ((Get-Item -LiteralPath $OutZip).Length -gt 500)) {
          return @{ Success = $true; Branch = $b; Owner = $o; Method = 'codeload' }
        }
      } catch {
        Write-Registro "Codeload ($o / $b) no disponible: $($_.Exception.Message)"
      }

      $archiveUrl = "https://github.com/$o/$RepoName/archive/refs/heads/$b.zip"
      try {
        Write-Paso "Probando descarga desde archive ($o / rama $b)..."
        Invoke-WebRequest -Uri $archiveUrl -OutFile $OutZip -UseBasicParsing -TimeoutSec 180 -Headers @{ 'User-Agent' = 'SerchTube-Updater' }
        if ((Test-Path -LiteralPath $OutZip) -and ((Get-Item -LiteralPath $OutZip).Length -gt 500)) {
          return @{ Success = $true; Branch = $b; Owner = $o; Method = 'archive' }
        }
      } catch {
        Write-Registro "Archive ($o / $b) no disponible: $($_.Exception.Message)"
      }
    }
  }

  return @{ Success = $false }
}

$cabeceras = @{ 'User-Agent' = 'SerchTube-Updater' }
if ($Token) {
  $cabeceras['Authorization'] = "Bearer $Token"
  Write-Paso "Usando token de GitHub (acceso autenticado a repositorio privado)."
} else {
  Write-Paso "Sin token configurado: se intentara como repositorio publico."
}

Write-Paso "Buscando actualizaciones de '$owner/$nombreRepo' (rama $Rama)..."
$shaRemoto = ''
try {
  $infoApi = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$nombreRepo/commits/$Rama" `
    -Headers $cabeceras -TimeoutSec 20
  $shaRemoto = $infoApi.sha
  $despuesTitulo = $infoApi.commit.message.Split("`n")[0]
} catch {
  # Si falla con la rama main, comprobar si la rama es master
  if ($Rama -eq 'main') {
    try {
      $infoApi = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$nombreRepo/commits/master" `
        -Headers $cabeceras -TimeoutSec 20
      $shaRemoto = $infoApi.sha
      $despuesTitulo = $infoApi.commit.message.Split("`n")[0]
      $Rama = 'master'
      Write-Paso "Detectada rama principal 'master' en GitHub."
    } catch {
      Write-Aviso "No se pudo consultar la API de GitHub; se procede descargando el archivo ZIP."
    }
  } else {
    Write-Aviso "No se pudo consultar la API de GitHub; se procede descargando el archivo ZIP."
  }
}

# Version "publicada localmente": solo sabemos que tenemos la ultima si YA bajo
# ese mismo commit (archivo .version-remota.txt). Con '-Forzar' se baja siempre.
if ($Forzar) { $versionLocal = '' }

if ($shaRemoto -and $versionLocal -and ($shaRemoto -eq $versionLocal)) {
  $cambiado = $false
  $antes = $versionLocal.Substring(0, 7); $despues = $antes
  if (-not $antesTitulo) { $antesTitulo = $despuesTitulo }
  if (Test-Path -LiteralPath (Join-Path $Raiz 'dist\server.cjs')) {
    Write-Paso "Ya estas en la ultima version ($($antes)). Nada que descargar."
  } else {
    Write-Paso "El codigo ya es el ultimo ($($antes)); falta compilar una vez (npm run build)."
    $compilarPrimeraVez = $true
  }
} else {
  # ================================================= MODO ZIP (unica via: no hace falta Git)
  if ($esRepo) { Write-Aviso "Esta copia es un repo git, pero se actualiza por ZIP para no depender de Git." }
  else { Write-Paso "Se actualiza bajando el ZIP de GitHub (una sola descarga, no hace falta Git)." }

  $dirTmp = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
  $temp = Join-Path $dirTmp ("serchtube-update-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  try {
    $zip = Join-Path $temp 'repo.zip'
    
    # Intentar descargar el ZIP con el método multi-rama y multi-endpoint
    $descarga = Download-GitHubZip -Owner $owner -RepoName $nombreRepo -Branch $Rama -AuthToken $Token -OutZip $zip

    # Si la descarga falló (ej: Error 404 porque el repo es privado y no hay token o la URL es distinta)
    if (-not $descarga.Success) {
      Write-Host ""
      Write-Host "============================================================================" -ForegroundColor Yellow
      Write-Host "  NO SE PUDO DESCARGAR LA ACTUALIZACION DE GITHUB (Error 404 / No encontrado)" -ForegroundColor Yellow
      Write-Host "============================================================================" -ForegroundColor Yellow
      Write-Host "Repositorio configurado: https://github.com/$owner/$nombreRepo" -ForegroundColor White
      Write-Host ""
      Write-Host "Causas mas frecuentes:" -ForegroundColor Cyan
      Write-Host " 1. Tu repositorio es PRIVADO en GitHub: GitHub oculta los repos privados con 404" -ForegroundColor Gray
      Write-Host "    a menos que uses un Token personal de GitHub (gratuito)." -ForegroundColor Gray
      Write-Host " 2. El nombre o usuario del repositorio en GitHub no coincide exactamente." -ForegroundColor Gray
      Write-Host ""

      $reintentar = $true
      while ($reintentar) {
        Write-Host "Opciones para solucionar esto:" -ForegroundColor Cyan
        Write-Host " [1] Introducir tu GitHub Token (Recomendado si tu repositorio es Privado)" -ForegroundColor White
        Write-Host " [2] Cambiar la direccion del repositorio de GitHub (si el nombre es distinto)" -ForegroundColor White
        Write-Host " [3] Cancelar y salir" -ForegroundColor White
        Write-Host ""
        $opc = Read-Host "Elige una opcion (1, 2 o 3)"

        if ($opc -eq '1') {
          Write-Host ""
          Write-Host "Como obtener tu Token gratuito de GitHub en 30 segundos:" -ForegroundColor Cyan
          Write-Host " 1. Entra en tu navegador a: https://github.com/settings/tokens" -ForegroundColor White
          Write-Host " 2. Pulsa en 'Generate new token' -> 'Generate new token (classic)'." -ForegroundColor White
          Write-Host " 3. Pon una descripcion (ej: SerchTube) y marca la casilla 'repo'." -ForegroundColor White
          Write-Host " 4. Pulsa el boton verde 'Generate token' abajo del todo." -ForegroundColor White
          Write-Host " 5. Copia el token que empieza con 'ghp_...'" -ForegroundColor White
          Write-Host ""
          $inputToken = Read-Host "Pega tu GitHub Token aqui (se guardara automaticamente en tu .env)"
          if ($inputToken -and $inputToken.Trim().Length -gt 5) {
            $Token = $inputToken.Trim().Trim('"').Trim("'")
            Save-EnvVar -key 'GITHUB_TOKEN' -val $Token
            Write-Paso "Token guardado en tu archivo .env correctamente."
            Write-Paso "Reintentando descarga con tu nuevo Token..."
            $descarga = Download-GitHubZip -Owner $owner -RepoName $nombreRepo -Branch $Rama -AuthToken $Token -OutZip $zip
            if ($descarga.Success) {
              $reintentar = $false
              break
            } else {
              Write-Mal "El token ingresado no tiene acceso a 'https://github.com/$owner/$nombreRepo' o el repositorio no existe."
            }
          } else {
            Write-Aviso "No se introdujo ningun token."
          }
        } elseif ($opc -eq '2') {
          Write-Host ""
          $inputRepo = Read-Host "Introduce la URL o usuario/repo de tu repositorio en GitHub"
          if ($inputRepo -and $inputRepo.Trim().Length -gt 5) {
            $Repo = $inputRepo.Trim().Trim('"').Trim("'")
            Save-EnvVar -key 'GITHUB_REPO' -val $Repo
            $limpio = $Repo -replace '\.git$', '' -replace '^https?://github\.com/', ''
            $partes = $limpio -split '/'
            if ($partes.Count -ge 2) {
              $owner = $partes[0]; $nombreRepo = $partes[1]
              Write-Paso "Repositorio actualizado a: https://github.com/$owner/$nombreRepo"
              Write-Paso "Reintentando descarga..."
              $descarga = Download-GitHubZip -Owner $owner -RepoName $nombreRepo -Branch $Rama -AuthToken $Token -OutZip $zip
              if ($descarga.Success) {
                $reintentar = $false
                break
              } else {
                Write-Mal "Tampoco se pudo descargar desde 'https://github.com/$owner/$nombreRepo'."
              }
            }
          }
        } else {
          Write-Mal "Actualizacion cancelada. Para repositorios privados, anade GITHUB_TOKEN=tu_token en tu archivo .env."
          exit 1
        }
      }
    }

    if (-not (Test-Path -LiteralPath $zip)) {
      Write-Mal "No se pudo obtener el archivo ZIP de actualizacion."
      exit 1
    }

    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
    # GitHub siempre extrae los contenidos en un unico directorio principal dentro del zip
    $carpeta = Get-ChildItem -Path $temp -Directory | Select-Object -First 1
    if (-not $carpeta) { Write-Mal "El ZIP no tiene la estructura esperada."; exit 1 }

    $antes = (Get-HashArchivo (Join-Path $Raiz 'server.ts')); if ($antes) { $antes = $antes.Substring(0, 8) }
    Write-Paso "Copiando archivos nuevos (sin tocar node_modules, logs ni .env)..."
    $archivosModificados = $false
    if (Test-Comando 'robocopy') {
      # En Windows se usa robocopy porque mezcla carpetas correctamente. Con
      # Copy-Item, si la carpeta destino ya existe, el contenido terminaria
      # anidado (scripts\scripts).
      $rc = Start-Process -FilePath 'robocopy.exe' -Wait -PassThru -WindowStyle Hidden -ArgumentList @(
        "`"$($carpeta.FullName)`"", "`"$Raiz`"",
        '/E', '/XD', 'node_modules', 'logs', 'dist', '.git', '/XF', '.env*',
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'
      )
      if ($rc.ExitCode -ge 8) {
        Write-Mal "La copia de archivos fallo (robocopy codigo $($rc.ExitCode))."
        exit 1
      }
      # En robocopy, ExitCode > 0 (1 a 7) indica que se copiaron o actualizaron archivos
      if ($rc.ExitCode -gt 0) { $archivosModificados = $true }
      Write-Registro "robocopy codigo $($rc.ExitCode)"
    } else {
      Get-ChildItem -LiteralPath $carpeta.FullName -Force | ForEach-Object {
        Copy-Tree -Origen $_ -Destino (Join-Path $Raiz $_.Name)
      }
      $archivosModificados = $true
    }
    $despues = (Get-HashArchivo (Join-Path $Raiz 'server.ts')); if ($despues) { $despues = $despues.Substring(0, 8) }
    $antesTitulo = "hash $antes"
    $despuesTitulo = "hash $despues"
    # Se considera cambiado si robocopy copio archivos, o el hash cambio, o el commit SHA cambio
    $cambiado = $archivosModificados -or ($antes -ne $despues) -or ($shaRemoto -and ($shaRemoto -ne $versionLocal))
    if ($cambiado -or -not $versionLocal) {
      Set-Content -LiteralPath $archivoVersion -Value $(if ($shaRemoto) { $shaRemoto } else { $despues })
    }
    # Si hubo cambios y habia un dist/ antiguo compilado, lo limpiamos para que el servidor
    # ejecute siempre el codigo fresco recien actualizado sin artefactos viejos
    if ($cambiado -and (Test-Path -LiteralPath (Join-Path $Raiz 'dist'))) {
      Remove-Item -Recurse -Force (Join-Path $Raiz 'dist') -ErrorAction SilentlyContinue
    }
  } finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
  }
}

if (-not $cambiado) {
  Write-Paso "Ya estas en la ultima version. No hay nada que aplicar."
} else {
  Write-Paso "Actualizado: $antes -> $despues"
  if ($detras -gt 0) { Write-Paso "  Commits nuevos: $detras" }
  if ($despuesTitulo) { Write-Paso "  Ultimo: $despuesTitulo" }
}

# ------------------------------------------------------- 1) Dependencias (npm)
$hashPackageDespues = Get-HashArchivo (Join-Path $Raiz 'package.json')
$hashLockDespues = Get-HashArchivo (Join-Path $Raiz 'package-lock.json')
$necesitaNpm = $false
if (-not (Test-Path -LiteralPath (Join-Path $Raiz 'node_modules'))) {
  Write-Paso "No hay node_modules: hay que instalar dependencias."
  $necesitaNpm = $true
} elseif ($cambiado -and ($hashPackageAntes -ne $hashPackageDespues -or $hashLockAntes -ne $hashLockDespues)) {
  Write-Paso "Cambiaron las dependencias (package.json / package-lock.json)."
  $necesitaNpm = $true
} else {
  Write-Paso "No hace falta 'npm install' (dependencias sin cambios)."
}

if ($necesitaNpm -and $SinDependencias) {
  Write-Aviso "Cambiaron las dependencias pero pediste -SinDependencias: ejecuta 'npm install' a mano."
  $depsSaltadas = $true
  $necesitaNpm = $false
}
if ($necesitaNpm) {
  if (-not (Test-Comando 'npm')) { Write-Mal "No encontre 'npm'. Instala Node.js (https://nodejs.org)."; exit 1 }
  Write-Paso "Instalando dependencias (puede tardar un minuto)..."
  Push-Location $Raiz
  try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Mal "'npm install' termino con error."; exit 1 }
    Write-Paso "Dependencias al dia."
  } finally { Pop-Location }
}

# ------------------------------------------- 1b) Compilar si es la primera vez
if ($compilarPrimeraVez -and -not $SinDependencias) {
  if (Test-Comando 'npm') {
    Write-Paso "Compilando el proyecto por primera vez (npm run build)..."
    Push-Location $Raiz
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) { Write-Aviso "'npm run build' fallo; se probara 'npm run dev'." }
      else { Write-Paso "Compilacion lista (dist/server.cjs)." }
    } finally { Pop-Location }
  } else {
    Write-Aviso "Sin Node.js no se puede compilar; se intentara 'npm run dev' igualmente."
  }
}

# ---------------------------------------------------------- 2) Servidor y App
$habiaServidor = (@(Get-ServidorPid).Count -gt 0)
$startPs1 = Join-Path $PSScriptRoot 'start-serchtube.ps1'

if ($SinReiniciar) {
  Write-Paso "Servidor y aplicacion sin tocar (-SinReiniciar)."
} else {
  if ($habiaServidor -and $cambiado) {
    Write-Paso "Deteniendo servidor anterior para recargar codigo nuevo..."
    Stop-Servidor | Out-Null
  }
  
  if (Test-Path -LiteralPath $startPs1) {
    Write-Paso "Iniciando SerchTube Music y abriendo ventana..."
    # start-serchtube.ps1 arranca el servidor si hace falta y abre la app en Edge/Chrome/Brave
    Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $startPs1 + '" -SinAutoInicio') -WorkingDirectory $Raiz
  } else {
    Start-Servidor | Out-Null
  }
}

# ------------------------------------------------------------------ 3) Resumen
Write-Host ""
Write-Host "================ RESUMEN ================" -ForegroundColor Green
Write-Host " Version anterior : $antes $(if ($antesTitulo) { "- $antesTitulo" })"
Write-Host " Version nueva    : $despues $(if ($despuesTitulo) { "- $despuesTitulo" })"
Write-Host " Dependencias     : $(if ($necesitaNpm) { 'instaladas ahora' } elseif ($depsSaltadas) { 'cambiaron (no instaladas por -SinDependencias)' } else { 'sin cambios' })"
Write-Host " Servidor         : $(if ($SinReiniciar) { 'sin tocar' } elseif (@(Get-ServidorPid).Count -gt 0) { 'corriendo' } else { 'detenido' })"
Write-Host " .env, logs y node_modules no se tocaron."
if ($stasheado) {
  Write-Host " TUS CAMBIOS LOCALES estan guardados en 'git stash'." -ForegroundColor Yellow
  Write-Host "   Para recuperarlos:  git stash pop" -ForegroundColor Yellow
}
Write-Host "=========================================" -ForegroundColor Green
if ($cambiado -and -not $SinReiniciar) {
  Write-Host "`n  La ventana vieja de SerchTube se cierra y se abre una nueva automáticamente.`n" -ForegroundColor Yellow
} elseif ($cambiado) {
  Write-Host "`n  Recarga la ventana de SerchTube (F5) para ver los cambios.`n" -ForegroundColor Yellow
}
