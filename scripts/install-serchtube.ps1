<#
  SerchTube Music - instalacion de una copia nueva
  ============================================================================
  Se usa despues de descargar el ZIP y descomprimirlo en una carpeta.
  No necesita Git. Hace una sola vez:

    1. Comprueba Node.js y npm.
    2. Instala las dependencias (node_modules).
    3. Crea .env a partir de .env.example si no existe.
    4. Arranca SerchTube y registra el autoinicio de Windows.

  Uso:
    Instalar en esta PC.bat
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-serchtube.ps1
    powershell ... -File scripts\install-serchtube.ps1 -SinAutoInicio
#>
[CmdletBinding()]
param(
  [int]$Puerto = 3000,
  [switch]$SinAutoInicio
)

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
function Write-Paso([string]$m) { Write-Host "[Instalar] $m" -ForegroundColor Cyan }
function Write-Mal([string]$m) { Write-Host "[Instalar] $m" -ForegroundColor Red }

try {
  if (-not (Test-Path -LiteralPath (Join-Path $Raiz 'package.json'))) {
    Write-Mal "No encuentro package.json. Descomprimi el ZIP completo en esta carpeta."
    exit 1
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    Write-Mal "Falta Node.js/npm. Instala Node.js LTS desde https://nodejs.org y volve a ejecutar este archivo."
    exit 1
  }
  Write-Paso "Node.js: $((& node --version) -join '')  npm: $((& npm --version) -join '')"

  Push-Location $Raiz
  try {
    # Siempre se ejecuta npm install: un node_modules viejo o incompleto hacia
    # que el servidor no arrancara y el instalador lo saltaba por existir.
    Write-Paso "Verificando e instalando dependencias (puede tardar uno o dos minutos)..."
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      Write-Mal "'npm install' termino con error. Revisa la conexion a Internet y volve a intentar."
      exit 1
    }
    Write-Paso "Dependencias al dia."

    $envFile = Join-Path $Raiz '.env'
    $envExample = Join-Path $Raiz '.env.example'
    if (-not (Test-Path -LiteralPath $envFile) -and (Test-Path -LiteralPath $envExample)) {
      Copy-Item -LiteralPath $envExample -Destination $envFile
      Write-Paso "Creado .env desde .env.example (despues podes cargar tus claves en Ajustes)."
    }
  } finally {
    Pop-Location
  }

  $startPs1 = Join-Path $PSScriptRoot 'start-serchtube.ps1'
  if (-not (Test-Path -LiteralPath $startPs1)) {
    Write-Mal "No encuentro scripts\start-serchtube.ps1. El ZIP esta incompleto."
    exit 1
  }

  Write-Paso "Iniciando SerchTube..."
  $startArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startPs1, '-Puerto', "$Puerto")
  if ($SinAutoInicio) { $startArgs += '-SinAutoInicio' }
  & powershell.exe @startArgs
  exit $LASTEXITCODE
} catch {
  Write-Mal "Error: $($_.Exception.Message)"
  exit 1
}
