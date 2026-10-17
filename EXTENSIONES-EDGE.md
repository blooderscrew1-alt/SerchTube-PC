# Extensiones de Edge dentro de SerchTube

Este documento explica cómo se integran las extensiones del navegador con
SerchTube Music y qué hay que hacer para que la extensión **YouTube Auto Zoom –
Barras negras** actúe sobre los vídeos que se reproducen en la aplicación.

---

## 1. Por qué las extensiones "no funcionaban" en SerchTube

SerchTube se abre en una **ventana tipo app** de Edge (`--app=http://localhost:3000`)
usando **tu perfil normal**, así que las extensiones instaladas **sí se cargan** y
sus *content scripts* sí se ejecutan dentro de la página. El problema era doble:

| Causa | Detalle |
| --- | --- |
| **No hay barra de extensiones** | La ventana tipo app no muestra la barra de iconos, así que el popup de la extensión no se podía abrir. |
| **El vídeo vive en un `iframe`** | YouTube se reproduce dentro de un `<iframe>` de `youtube.com`. La extensión solo actúa cuando detecta pantalla completa **dentro del iframe**, pero SerchTube pone en pantalla completa el documento padre (`localhost`). Dentro del iframe `document.fullscreenElement` es `null`, así que la extensión se quedaba siempre inactiva. |

---

## 2. La solución: puente por `postMessage`

```
SerchTube (localhost)                     iframe de YouTube
  botón "Auto Zoom"  ──postMessage──►  content.js de la extensión
                     ◄──postMessage──  estado real (modo, barras, bloqueos)
```

* SerchTube envía mensajes al `contentWindow` del iframe `#yt-player-iframe`.
* La extensión los escucha en `window` (los *content scripts* comparten la ventana
  de la página) y responde con su estado real.
* Cuando el padre pide `active: true`, la extensión trata el reproductor embebido
  como si estuviera en pantalla completa. En `youtube.com` normal ese aviso nunca
  llega, así que el comportamiento original no cambia.

### Protocolo

Mensajes de SerchTube → extensión (`{ source: 'serchtube', type: 'serchtube-autozoom', ... }`):

| `action` | Efecto |
| --- | --- |
| `set` | Aplica `enabled`, `mode`, `strength`, `maxZoom`, `threshold` y el flag `active`. |
| `set-active` | Solo cambia el flag `active` (no toca el modo). |
| `status` | Pide el estado actual. |
| `cycle` | Conmuta `zoom → stretch → fit → off`. |
| `redetect` | Vuelve a analizar las barras negras del vídeo actual. |

Respuesta de la extensión → SerchTube
(`{ source: 'yt-autozoom', type: 'serchtube-autozoom-status', ... }`):
`enabled`, `mode`, `strength`, `maxZoom`, `threshold`, `locked`, `hasVideo`,
`fullscreen`, `blocked`, `bars`, `version`.

---

## 3. El botón "Auto Zoom" de la barra inferior

En la barra de información inferior, **a la izquierda del botón de redimensionar
y posicionar elementos** (icono de rejilla), hay un botón discreto de **solo
icono**. Su icono cambia según el modo activo:

| Icono | Modo |
| --- | --- |
| ⛶ recorte | **Zoom** — rellena la pantalla sin deformar (recorta los bordes sobrantes) |
| ↔ flechas | **Estirar** — rellena todo estirando la imagen (puede deformar) |
| ▭ marco | **Ajustar** — solo elimina las barras negras, sin recortar ni deformar |
| ⏻ apagado | **Desactivado** — el vídeo se ve tal cual llega |

* **Clic izquierdo**: conmuta `Zoom → Estirar → Ajustar → Desactivado → Zoom…`
* **Clic derecho**: vuelve a analizar las barras negras del vídeo actual.
* **Punto ámbar** en la esquina: la extensión no responde (ver punto 6).

El estado se guarda en `localStorage` (`serchtube_autozoom_state`) y también en
`chrome.storage.sync` de la extensión, de modo que SerchTube y `youtube.com`
comparten la misma configuración.

Pasa el ratón por encima: el tooltip se **autodiagnostica**, no hay que adivinar.

| Lo que dice el tooltip | Significado |
| --- | --- |
| `Estado: conectada (v1.8.0)` | El puente funciona; el vídeo ya se está transformando. |
| `Estado: SIN RESPUESTA` | La extensión no contesta. **Causa habitual: Edge sigue con la 1.7.0 cargada** (ver punto 4). |
| `Deteccion: barras ↑0% ↓0% ←13% →13%` | Barras negras medidas en el fotograma actual. |

---

## 4. La extensión ya viene con el proyecto

La extensión está versionada en el repositorio, en `extensions/yt-blackbars/`, y
**el lanzador la carga automáticamente** si el navegador no la tiene instalada:

```
Iniciar SerchTube.bat
  -> si la extensión no está instalada:  --load-extension=<repo>\extensions\yt-blackbars
  -> si ya está instalada:               no se toca (evita duplicarla)
```

Es decir, en un PC nuevo **no hay que instalar nada a mano**: basta con ejecutar
`Iniciar SerchTube.bat`. Si quieres desactivar esa carga automática, usa
`Iniciar SerchTube.bat -SinExtensionPropia`.

### Instalarla de forma permanente (opcional)

Si prefieres tenerla instalada de verdad en tu perfil:

1. Abre Edge y ve a `edge://extensions`.
2. Activa **Modo de desarrollador** (abajo a la izquierda).
3. Pulsa **Cargar descomprimida** y elige la carpeta
   `extensions\yt-blackbars` de tu copia de SerchTube.
4. Si ya la tenías cargada desde otra carpeta, pulsa **Recargar** en su tarjeta
   para que Edge lea el `content.js` nuevo.

> La versión con el puente es la **1.8.0**. Puedes comprobarla en la tarjeta de
> la extensión dentro de `edge://extensions`.

> **Edge NO relee una extensión descomprimida** cuando cambian sus archivos en el
> disco: solo lo hace al pulsar **Recargar** en `edge://extensions`, o al cerrar
> Edge por completo y volver a abrirlo. Si el botón muestra el punto ámbar, es
> casi siempre esto.

---

## 6. Diagnóstico rápido

| Síntoma | Qué hacer |
| --- | --- |
| Punto ámbar en el botón Auto Zoom | `edge://extensions` → **Recargar** en YouTube Auto Zoom. Si no aparece ahí, cierra Edge por completo y vuelve a lanzar `Iniciar SerchTube.bat` (carga la del proyecto sola). |
| El tooltip dice **«conectada (v1.8.0)»** pero el vídeo no cambia | El vídeo ya llena su reproductor: esta extensión solo quita barras negras. Prueba con un vídeo con barras (4:3 o scope), o cambia a **Estirar**/**Zoom**. |
| No pasa nada y el vídeo está dentro de SerchTube | Pasa el ratón por el botón y mira la línea *Estado:*. Si está conectada, el puente funciona. |
| El QR del mando remoto desaparece | Corregido: era una regla CSS de cursor inactivo. Si lo sigues viendo, recarga sin caché (`Ctrl` + `Shift` + `R`). |

---

## 7. El resto de tus extensiones

Cualquier extensión cuyo *content script* apunte a `<all_urls>` o a `localhost`
funciona en SerchTube sin hacer nada más (por ejemplo un bloqueador de anuncios o
un corrector de imágenes). Las que apuntan a `youtube.com` se ejecutan dentro del
iframe del reproductor, que es justo donde está el vídeo.

Lo único que sigue faltando en la ventana tipo app es la **barra de iconos**. Si
necesitas abrir el popup de alguna extensión concreta:

* Ejecuta `Iniciar SerchTube.bat -Modo pestana` para abrir SerchTube en una
  pestaña normal de Edge, con la barra de extensiones visible.
* O abre esa extensión desde cualquier otra ventana de Edge.

Si quieres que una extensión concreta tenga su propio botón en la barra inferior
de SerchTube (como se hizo con Auto Zoom), hay que añadir su acción al puente:
pide el cambio indicando la extensión y qué debe hacer el botón.
