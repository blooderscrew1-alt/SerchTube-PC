# SerchTube Remote — APK Android

Contenedor nativo mínimo para el mando de SerchTube.

## Qué hace

- Al abrir por primera vez prueba el último host guardado.
- Si no responde, busca hosts de SerchTube en la red Wi‑Fi (puerto 3000) y conecta al primero disponible.
- El menú de tres puntos permite:
  - Escanear el QR que muestra la pantalla del host.
  - Buscar otro host y elegir de una lista (sin conectar automáticamente).
  - Ingresar la IP manualmente.
- Comprueba al iniciar si hay una versión nueva en GitHub y solo muestra un aviso si existe.
- Conserva el host guardado al cerrar la app o perder la conexión.
- Si el host no responde, muestra “Reconectando…” y reintenta solo cada pocos segundos; no vuelve a pedir escanear el QR.
- Guarda la IP para abrir directo las próximas veces.
- No requiere HTTPS ni instalar la PWA.

El escaneo de QR usa la cámara del sistema y la librería ZXing Core 3.5.3
(Apache License 2.0), incluida en `android/libs`.

## Compilar

Requiere JDK y Android SDK (build-tools 36.0.0, platform android-36):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File android\build-apk.ps1
```

El APK firmado se genera en:

```text
public/SerchTubeRemote.apk
```

## Instalar

El botón de instalar del mando, en Android, descarga ese APK desde GitHub.
Android pedirá permitir la instalación desde el navegador y confirmar la instalación.

La keystore de firma está en `android/keystore/serchtube.keystore` para que las
actualizaciones futuras puedan instalarse encima sin desinstalar.
