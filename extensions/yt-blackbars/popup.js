const DEFAULTS = { enabled: true, mode: 'zoom', strength: 100, threshold: 26, maxZoom: 2.5 };
const $ = id => document.getElementById(id);

/* Misma persistencia que el content script: local (por perfil, sobrevive a
   reinicios) + sync (compartido entre equipos con la misma cuenta).
   Al leer se prefiere local, luego sync, luego DEFAULTS. */
function guardar(datos) {
  try { chrome.storage.local.set(datos); } catch (e) {}
  try { chrome.storage.sync.set(datos); } catch (e) {}
}

function cargar(cb) {
  const normalizar = fuentes => {
    const mezcla = Object.assign({}, DEFAULTS);
    fuentes.forEach(f => { if (f) Object.keys(DEFAULTS).forEach(k => { if (k in f) mezcla[k] = f[k]; }); });
    return mezcla;
  };
  try {
    chrome.storage.local.get(null, local => {
      try {
        chrome.storage.sync.get(null, sync => cb(normalizar([sync, local])));
      } catch (e) {
        cb(normalizar([local]));
      }
    });
  } catch (e) {
    try {
      chrome.storage.sync.get(null, sync => cb(normalizar([sync])));
    } catch (e2) {
      cb(normalizar([]));
    }
  }
}

cargar(cfg => {
  $('enabled').checked = cfg.enabled;
  const radio = document.querySelector(`input[name=mode][value=${cfg.mode}]`);
  if (radio) radio.checked = true;
  $('strength').value = cfg.strength; $('sv').textContent = cfg.strength + '%';
  $('maxZoom').value = cfg.maxZoom; $('mv').textContent = cfg.maxZoom + 'x';
  $('threshold').value = cfg.threshold; $('tv').textContent = cfg.threshold;
});

$('enabled').onchange = e => guardar({ enabled: e.target.checked });
document.querySelectorAll('input[name=mode]').forEach(r =>
  r.onchange = () => guardar({ mode: r.value, enabled: true }));
$('strength').oninput = e => { $('sv').textContent = e.target.value + '%'; guardar({ strength: +e.target.value }); };
$('maxZoom').oninput = e => { $('mv').textContent = e.target.value + 'x'; guardar({ maxZoom: +e.target.value }); };
$('threshold').oninput = e => { $('tv').textContent = e.target.value; guardar({ threshold: +e.target.value }); };

$('redo').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'redetect' }, { frameId: 0 });
  } catch {}
};

async function refresh() {
  const el = $('status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'status' }, { frameId: 0 });
    if (!res || !res.hasVideo) el.textContent = 'No hay video activo.';
    else if (!res.fullscreen) el.textContent = 'Entra en pantalla completa para activarlo.';
    else if (res.blocked) el.textContent = 'Video protegido: no se puede analizar.';
    else {
      const p = v => Math.round(v * 100);
      const bars = res.bars, pl = res.diag.player;
      const baked = bars ? `${res.locked ? '🔒 ' : ''}incrustadas: ↑${p(bars.t)}% ↓${p(bars.b)}% ←${p(bars.l)}% →${p(bars.r)}%` : `incrustadas: analizando… (${res.diag.reason})`;
      const player = pl ? `reproductor: laterales ${p(1 - pl.vw / pl.Pw)}%, arriba/abajo ${p(1 - pl.vh / pl.Ph)}%` : '';
      el.innerHTML = `Barras ${baked}<br>${player}`;
    }
  } catch { el.textContent = 'Recarga la pestaña de YouTube (F5) y abre un video.'; }
}
refresh(); setInterval(refresh, 800);
