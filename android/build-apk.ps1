# Construye SerchTubeRemote.apk sin Gradle, usando Android SDK + JDK.
# Uso: powershell -ExecutionPolicy Bypass -File android\build-apk.ps1

$ErrorActionPreference = 'Stop'

$androidDir = $PSScriptRoot
$projectDir = Split-Path $androidDir -Parent
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$buildTools = Join-Path $sdk 'build-tools\36.0.0'
$androidJar = Join-Path $sdk 'platforms\android-36\android.jar'
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Java\latest\jdk-25' }

if (-not (Test-Path $androidJar)) { throw "No existe android.jar en $androidJar" }
if (-not (Test-Path (Join-Path $buildTools 'aapt2.exe'))) { throw "No existe aapt2 en $buildTools" }
if (-not (Test-Path (Join-Path $javaHome 'bin\javac.exe'))) { throw "No existe javac en $javaHome" }

$work = Join-Path $androidDir 'build'
$gen = Join-Path $work 'gen'
$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
$keystore = Join-Path $androidDir 'keystore\serchtube.keystore'
$output = Join-Path $projectDir 'public\SerchTubeRemote.apk'
$zxingJar = Join-Path $androidDir 'libs\core-3.5.3.jar'

if (-not (Test-Path $zxingJar)) {
  throw "Falta la librería ZXing en $zxingJar"
}

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $gen, $classes, $dex, (Split-Path $keystore), (Split-Path $output) | Out-Null

Write-Host '1/6 Compilando recursos...'
$resZip = Join-Path $work 'resources.zip'
& (Join-Path $buildTools 'aapt2.exe') compile --dir (Join-Path $androidDir 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile falló' }

Write-Host '2/6 Enlazando manifiesto y recursos...'
$unsigned = Join-Path $work 'unsigned.apk'
& (Join-Path $buildTools 'aapt2.exe') link -o $unsigned -I $androidJar `
  --manifest (Join-Path $androidDir 'AndroidManifest.xml') `
  --java $gen --min-sdk-version 24 --target-sdk-version 36 --auto-add-overlay $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link falló' }

Write-Host '3/6 Compilando Java...'
$sources = @(
  (Join-Path $androidDir 'src\com\serchtube\remote\MainActivity.java'),
  (Join-Path $gen 'com\serchtube\remote\R.java')
)
& (Join-Path $javaHome 'bin\javac.exe') --release 11 -classpath "$androidJar;$zxingJar" -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw 'javac falló' }

Write-Host '4/6 Generando classes.dex...'
$classFiles = Get-ChildItem $classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
& (Join-Path $buildTools 'd8.bat') --lib $androidJar --min-api 24 --output $dex $classFiles $zxingJar
if ($LASTEXITCODE -ne 0) { throw 'd8 falló' }

Push-Location $work
try {
  Copy-Item (Join-Path $dex 'classes.dex') (Join-Path $work 'classes.dex') -Force
  & (Join-Path $javaHome 'bin\jar.exe') uf $unsigned 'classes.dex'
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo añadir classes.dex' }
} finally {
  Pop-Location
}

Write-Host '5/6 Alineando APK...'
$aligned = Join-Path $work 'aligned.apk'
& (Join-Path $buildTools 'zipalign.exe') -f -p 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign falló' }

if (-not (Test-Path $keystore)) {
  Write-Host '6/6 Generando keystore y firmando...'
  & (Join-Path $javaHome 'bin\keytool.exe') -genkeypair -v -keystore $keystore `
    -storepass serchtube -keypass serchtube -alias serchtube `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=SerchTube, OU=Remote, O=SerchTube, L=MX, ST=MX, C=MX"
  if ($LASTEXITCODE -ne 0) { throw 'keytool falló' }
} else {
  Write-Host '6/6 Firmando APK...'
}

& (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore `
  --ks-pass pass:serchtube --key-pass pass:serchtube `
  --out $output $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner falló' }

Write-Host "APK listo: $output"
Get-Item $output | Select-Object FullName, Length
