(() => {
  'use strict';

  const DEFAULTS = { enabled: true, mode: 'zoom', strength: 100, threshold: 26, maxZoom: 2.5 };
  const SAMPLE_MS = 250;     // cada cuánto se analiza un frame
  const HISTORY = 6;         // muestras consecutivas necesarias para fijar (~1.5 s)
  const STABLE_SPREAD = 0.01; // variación máxima entre muestras para considerarlas estables
  const GIVE_UP = 40;        // si nunca se estabiliza, fija igualmente tras ~10 s
  const MAX_BAR = 0.46;      // una barra nunca puede ocupar más de este % del frame
  const MIN_BAR = 0.012;     // barras menores a 1.2% se ignoran
  const SAMPLE_W = 320;      // ancho del canvas de análisis

  let cfg = { ...DEFAULTS };
  let video = null;
  let signature = '';
  let history = [];
  let detected = null;       // {t,b,l,r} en fracciones 0..1
  let failed = false;        // canvas bloqueado (DRM, etc.)
  let locked = false;        // barras fijadas: se detecta UNA sola vez por video
  let samples = 0;           // muestras válidas desde el último reinicio
  let observer = null;
  const diag = { frames: 0, reason: 'esperando', raw: null };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  /* ---------- Solo en pantalla completa ---------- */
  // Puente con SerchTube: alli el video vive dentro de un <iframe> de youtube.com
  // y la pantalla completa la pide la pagina padre (localhost), de modo que dentro
  // del iframe document.fullscreenElement es null y la extension se quedaba
  // inactiva. El padre lo avisa por postMessage y aqui se acepta como equivalente
  // a estar en pantalla completa. En youtube.com normal esto no se activa nunca.
  let forcedActive = false;

  function isFullscreen() {
    if (forcedActive) return true;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    return !!fs && !!video && (fs === video || fs.contains(video));
  }

  /* ---------- Selección del <video> ---------- */
  function pickVideo() {
    const vids = [...document.querySelectorAll('video')].filter(
      v => v.videoWidth > 0 && v.offsetWidth > 0 && v.offsetHeight > 0
    );
    if (!vids.length) return null;
    vids.sort((a, b) => {
      if (a.paused !== b.paused) return a.paused ? 1 : -1;
      return b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight;
    });
    return vids[0];
  }

  /* ---------- Análisis de un frame ---------- */
  function analyze(v) {
    const W = SAMPLE_W;
    const H = Math.max(16, Math.round(W * v.videoHeight / v.videoWidth));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

    let data;
    try {
      ctx.drawImage(v, 0, 0, W, H);
      data = ctx.getImageData(0, 0, W, H).data;
    } catch (e) {
      diag.reason = 'bloqueado: ' + e.message;
      return 'blocked';
    }

    const T = cfg.threshold;
    const rowCount = new Uint16Array(H); // píxeles no negros por fila
    const colCount = new Uint16Array(W); // píxeles no negros por columna
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i += 4) {
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (l > T) { rowCount[y]++; colCount[x]++; }
      }
    }

    // Horizontales (arriba/abajo) y verticales (izquierda/derecha) se miden
    // de forma independiente, así que funcionan solas o combinadas.
    const tolRow = Math.max(1, Math.floor(W * 0.02));
    const tolCol = Math.max(1, Math.floor(H * 0.02));
    const maxRows = Math.floor(H * MAX_BAR);
    const maxCols = Math.floor(W * MAX_BAR);

    let top = 0, bottom = 0, left = 0, right = 0;
    while (top < maxRows && rowCount[top] <= tolRow) top++;
    while (bottom < maxRows && rowCount[H - 1 - bottom] <= tolRow) bottom++;
    while (left < maxCols && colCount[left] <= tolCol) left++;
    while (right < maxCols && colCount[W - 1 - right] <= tolCol) right++;

    if (top >= maxRows || bottom >= maxRows || left >= maxCols || right >= maxCols) {
      diag.reason = 'frame muy oscuro / ambiguo';
      return null;
    }

    // ¿hay contenido visible en la zona central?
    let lit = 0;
    for (let y = top; y < H - bottom; y++) lit += rowCount[y];
    const area = (H - top - bottom) * (W - left - right);
    if (area < W * H * 0.1 || lit < area * 0.005) {
      diag.reason = 'contenido casi negro';
      return null;
    }

    // 1 px de margen hacia dentro para evitar bordes degradados
    const m = n => (n > 0 ? n + 1 : 0);
    diag.reason = 'ok';
    return { t: m(top) / H, b: m(bottom) / H, l: m(left) / W, r: m(right) / W };
  }

  /* ---------- Estabilización: se fija UNA vez por video ---------- */
  function resetDetection() {
    history = []; detected = null; locked = false; samples = 0;
    diag.reason = 'esperando';
  }

  function addSample(s) {
    samples++;
    history.push(s);
    if (history.length > HISTORY) history.shift();
    if (history.length < HISTORY) return;

    const keys = ['t', 'b', 'l', 'r'];
    const min = {}, spread = {};
    for (const k of keys) {
      const vals = history.map(h => h[k]);
      min[k] = Math.min(...vals);
      spread[k] = Math.max(...vals) - min[k];
    }
    const stable = keys.every(k => spread[k] <= STABLE_SPREAD);
    if (!stable && samples < GIVE_UP) return; // seguir midiendo, sin aplicar nada aún

    for (const k of keys) if (min[k] < MIN_BAR) min[k] = 0;
    detected = min;      // valor conservador (mínimo) de la ventana
    locked = true;       // a partir de aquí no se vuelve a analizar este video
    diag.reason = 'fijado';
    console.log('[YT AutoZoom] barras fijadas para este video:', detected);
    render();
  }

  /* ---------- Aplicar transformación ---------- */
  function clearTransform() {
    if (!video) return;
    video.style.removeProperty('transform');
    video.style.removeProperty('transform-origin');
    video.style.removeProperty('transition');
  }

  // Posición y tamaño del video dentro del reproductor, ignorando transform
  function layout() {
    const player = video.closest('.html5-video-player') || video.offsetParent || video.parentElement;
    if (!player) return null;
    let x = 0, y = 0, e = video;
    while (e && e !== player) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    if (e !== player) { x = video.offsetLeft; y = video.offsetTop; }
    return {
      Pw: player.clientWidth, Ph: player.clientHeight,
      vw: video.offsetWidth, vh: video.offsetHeight, x, y,
    };
  }

  function render() {
    if (!video || !cfg.enabled || !isFullscreen() || !detected || failed) { clearTransform(); return; }
    const L = layout();
    if (!L || !L.vw || !L.vh || !L.Pw || !L.Ph) return;
    const { Pw, Ph, vw, vh } = L;
    diag.player = { Pw, Ph, vw, vh };

    // Barras incrustadas en la imagen (detectadas) + barras del propio reproductor
    // (el video es más chico que el reproductor, p. ej. un 4:3 en pantalla 16:9).
    const { t, b, l, r } = detected;
    const cw = (1 - l - r) * vw;
    const ch = (1 - t - b) * vh;
    const fx = Pw / cw, fy = Ph / ch;
    const fit = Math.min(fx, fy);
    const k = cfg.strength / 100;

    let sx, sy;
    if (cfg.mode === 'stretch') {
      sx = fit + (fx - fit) * k;
      sy = fit + (fy - fit) * k;
    } else if (cfg.mode === 'fit') {
      sx = sy = fit;
    } else { // zoom: mantiene proporción y recorta lo que sobre
      sx = sy = fit + (Math.max(fx, fy) - fit) * k;
    }

    sx = Math.min(sx, cfg.maxZoom);
    sy = Math.min(sy, cfg.maxZoom);

    // Centrar el contenido real en el reproductor
    const dx = ((l - r) / 2) * vw;
    const dy = ((t - b) / 2) * vh;
    const tx = Pw / 2 - (L.x + vw / 2) - sx * dx;
    const ty = Ph / 2 - (L.y + vh / 2) - sy * dy;

    if (Math.abs(sx - 1) < 0.003 && Math.abs(sy - 1) < 0.003 && Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5) {
      clearTransform();
      return;
    }

    const st = video.style;
    st.setProperty('transform-origin', 'center center', 'important');
    st.setProperty('transition', 'transform .3s ease', 'important');
    st.setProperty('transform', `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`, 'important');
  }

  /* ---------- Ciclo principal ---------- */
  function attach(v) {
    if (observer) observer.disconnect();
    clearTransform();
    video = v;
    resetDetection();
    failed = false;
    if (v) {
      observer = new ResizeObserver(render);
      observer.observe(v);
      const pl = v.closest('.html5-video-player') || v.offsetParent;
      if (pl) observer.observe(pl);
    }
  }

  function tick() {
    setTimeout(tick, SAMPLE_MS);
    ensureButton();
    if (!cfg.enabled || document.hidden) return;

    const v = pickVideo();
    if (v !== video) attach(v);
    if (!video) return;

    const dur = isFinite(video.duration) ? Math.round(video.duration) : 'live';
    const ratio = (video.videoWidth / video.videoHeight).toFixed(2);
    const vid = new URLSearchParams(location.search).get('v') || location.pathname;
    // La resolución puede cambiar a mitad del video (calidad adaptativa); la proporción no.
    const sig = `${video.currentSrc}|${vid}|${dur}|${ratio}`;
    if (sig !== signature) { signature = sig; attach(video); }
    if (!isFullscreen()) { clearTransform(); return; }
    if (locked) { render(); return; }
    if (failed || video.readyState < 2) return;

    const res = analyze(video);
    diag.frames++;
    if (res && res !== 'blocked') diag.raw = res;
    render(); // reaplica por si YouTube reescribió el estilo del video
    if (res === 'blocked') { failed = true; clearTransform(); return; }
    if (res) addSample(res);
  }

  /* ---------- Configuración ---------- */
  console.log('[YT AutoZoom] cargado en', location.href);
  chrome.storage.sync.get(DEFAULTS, stored => {
    cfg = { ...DEFAULTS, ...stored };
    tick();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) cfg[k] = changes[k].newValue;
    updateButton();
    if (!cfg.enabled) { clearTransform(); return; }
    if (changes.threshold) resetDetection();
    render();
  });

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg && msg.type === 'redetect') { resetDetection(); clearTransform(); send({ ok: true }); return; }
    if (msg && msg.type === 'status') send({ locked, hasVideo: !!video, bars: detected, blocked: failed, fullscreen: isFullscreen(), diag, mode: cfg.mode });
  });


  /* ---------- Atajo: Bloq Mayús alterna zoom → estirar → ajustar → desactivado ---------- */
  const LABELS = { zoom: 'Zoom', stretch: 'Estirar', fit: 'Ajustar' };
  let osdEl = null, osdTimer = null;

  function osd(text) {
    const host = document.fullscreenElement || document.webkitFullscreenElement ||
      (video && video.closest('.html5-video-player')) || document.body;
    if (!osdEl) {
      osdEl = document.createElement('div');
      osdEl.id = 'yt-autozoom-osd';
      Object.assign(osdEl.style, {
        position: 'absolute', top: '8%', left: '50%', transform: 'translateX(-50%)',
        padding: '8px 18px', background: 'rgba(0,0,0,.75)', color: '#fff',
        font: '600 18px system-ui, sans-serif', borderRadius: '8px', zIndex: '2147483647',
        pointerEvents: 'none', transition: 'opacity .25s', opacity: '0',
      });
    }
    if (osdEl.parentElement !== host) host.appendChild(osdEl);
    osdEl.textContent = text;
    osdEl.style.opacity = '1';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => { osdEl.style.opacity = '0'; }, 1200);
  }

  function cycleMode() {
    let { enabled, mode } = cfg;
    if (!enabled) { enabled = true; mode = 'zoom'; }
    else if (mode === 'zoom') mode = 'stretch';
    else if (mode === 'stretch') mode = 'fit';
    else enabled = false;

    cfg.enabled = enabled; cfg.mode = mode;
    chrome.storage.sync.set({ enabled, mode });
    if (enabled) render(); else clearTransform();
    updateButton();
    osd(enabled ? LABELS[mode] : 'Desactivado');
  }


  /* ---------- Botón en la barra de controles del reproductor ---------- */
  const ICONS = {
    zoom:    '<path d="M9 14v-4h4M23 10h4v4M27 22v4h-4M13 26H9v-4"/><rect x="14.5" y="14.5" width="7" height="7" rx="1"/>',
    stretch: '<path d="M7 18h22M12 13l-5 5 5 5M24 13l5 5-5 5"/>',
    fit:     '<rect x="7.5" y="10.5" width="21" height="15" rx="2"/><rect x="13" y="15" width="10" height="6" rx="1"/>',
    off:     '<path d="M9 14v-4h4M23 10h4v4M27 22v4h-4M13 26H9v-4"/><path d="M8 8l20 20"/>',
  };
  let btnEl = null;

  function updateButton() {
    if (!btnEl) return;
    const key = cfg.enabled ? cfg.mode : 'off';
    btnEl.dataset.mode = key;
    btnEl.firstChild.innerHTML = ICONS[key] || ICONS.zoom;
    btnEl.style.opacity = cfg.enabled ? '1' : '.5';
    const name = cfg.enabled ? LABELS[cfg.mode] : 'Desactivado';
    const tip = `Auto Zoom: ${name} (clic o Bloq Mayús para cambiar)`;
    btnEl.title = tip;
    btnEl.setAttribute('aria-label', tip);
  }

  function ensureButton() {
    const rc = document.querySelector('.ytp-right-controls');
    if (!rc) return;
    if (btnEl && btnEl.isConnected) return;

    btnEl = document.createElement('button');
    btnEl.id = 'ytaz-btn';
    btnEl.className = 'ytp-button';
    btnEl.type = 'button';
    btnEl.style.cssText = 'background:none;border:0;padding:0 2px;width:48px;height:100%;max-height:48px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;vertical-align:top;';
    btnEl.innerHTML = '<svg viewBox="0 0 36 36" style="width:100%;height:100%;max-height:48px" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></svg>';
    const stop = e => e.stopPropagation();
    btnEl.addEventListener('mousedown', stop);
    btnEl.addEventListener('dblclick', stop);
    btnEl.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); cycleMode(); btnEl.blur(); });

    const holder = rc.querySelector('.ytp-right-controls-left') || rc;
    const ref = holder.querySelector('.ytp-settings-button');
    if (ref) ref.before(btnEl); else holder.prepend(btnEl);
    updateButton();
  }

  // En Windows/Linux Bloq Mayús genera keydown+keyup en cada pulsación;
  // en macOS solo keydown al activarlo y solo keyup al desactivarlo.
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  function onKey(e) {
    if (e.code !== 'CapsLock' && e.key !== 'CapsLock') return;
    if (e.type === 'keydown' && e.repeat) return;
    if (e.type === 'keyup' && !isMac) return;
    if (!isFullscreen()) return;
    cycleMode();
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  window.addEventListener('resize', render);
  const onFs = () => { if (!isFullscreen()) clearTransform(); setTimeout(render, 150); };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  window.addEventListener('yt-navigate-finish', () => { signature = ''; });
  document.addEventListener('yt-navigate-finish', () => { signature = ''; });

  /* ---------- Puente bidireccional con SerchTube (postMessage) ----------
     SerchTube reproduce YouTube en un iframe y no puede tocar el <video> ni el
     popup de la extension, pero si puede enviar postMessage al iframe. Aqui se
     atienden esas ordenes y se responde con el estado real, para que el boton
     "Auto Zoom" de la barra inferior de SerchTube conmute los tres modos. */
  const BRIDGE_IN = 'serchtube-autozoom';
  const BRIDGE_OUT = 'serchtube-autozoom-status';
  const SOURCE_IN = 'serchtube';
  const SOURCE_OUT = 'yt-autozoom';

  function bridgeStatus() {
    let version = 'desconocida';
    try { version = chrome.runtime.getManifest().version; } catch (_) {}
    return {
      source: SOURCE_OUT,
      type: BRIDGE_OUT,
      installed: true,
      version,
      enabled: cfg.enabled,
      mode: cfg.mode,
      strength: cfg.strength,
      maxZoom: cfg.maxZoom,
      threshold: cfg.threshold,
      locked,
      hasVideo: !!video,
      fullscreen: isFullscreen(),
      blocked: failed,
      bars: detected,
      diag
    };
  }

  function bridgeReply(target) {
    const win = (target && target !== window) ? target : window.parent;
    try { win.postMessage(bridgeStatus(), '*'); } catch (_) {}
    updateButton();
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object' || d.source !== SOURCE_IN || d.type !== BRIDGE_IN) return;
    const reply = () => bridgeReply(event.source);

    switch (d.action) {
      case 'status':
        reply();
        return;

      case 'set-active':
        // Orden suave: el padre indica que quiere que la extension actue.
        forcedActive = d.active !== false;
        if (cfg.enabled) render(); else clearTransform();
        reply();
        return;

      case 'set':
        forcedActive = d.active !== false;
        if (typeof d.enabled === 'boolean') cfg.enabled = d.enabled;
        if (d.mode && LABELS[d.mode]) cfg.mode = d.mode;
        if (typeof d.strength === 'number') cfg.strength = d.strength;
        if (typeof d.maxZoom === 'number') cfg.maxZoom = d.maxZoom;
        if (typeof d.threshold === 'number') cfg.threshold = d.threshold;
        chrome.storage.sync.set({
          enabled: cfg.enabled,
          mode: cfg.mode,
          strength: cfg.strength,
          maxZoom: cfg.maxZoom,
          threshold: cfg.threshold
        });
        resetDetection();
        if (cfg.enabled) render(); else clearTransform();
        reply();
        return;

      case 'cycle':
        cycleMode();
        reply();
        return;

      case 'redetect':
        resetDetection();
        clearTransform();
        reply();
        return;

      default:
        return;
    }
  });

  // Aviso espontaneo al abrirse, para que SerchTube sepa que la extension esta viva.
  try { window.parent.postMessage(bridgeStatus(), '*'); } catch (_) {}
})();
