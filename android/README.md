# SerchTube Remote — APK Android

Contenedor nativo mínimo para el mando de SerchTube.

## Qué hace

- Al abrir por primera vez busca el host de SerchTube en la red Wi‑Fi (puerto 3000).
- Si lo encuentra, carga `/?role=satellite` en un WebView a pantalla completa.
- Si no lo encuentra, permite escribir la IP manualmente.
- Guarda la IP para abrir directo las próximas veces.
- No requiere HTTPS ni instalar la PWA.

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
