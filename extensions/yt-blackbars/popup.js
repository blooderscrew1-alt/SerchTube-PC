const DEFAULTS = { enabled: true, mode: 'zoom', strength: 100, threshold: 26, maxZoom: 2.5 };
const $ = id => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS, cfg => {
  $('enabled').checked = cfg.enabled;
  document.querySelector(`input[name=mode][value=${cfg.mode}]`).checked = true;
  $('strength').value = cfg.strength; $('sv').textContent = cfg.strength + '%';
  $('maxZoom').value = cfg.maxZoom; $('mv').textContent = cfg.maxZoom + 'x';
  $('threshold').value = cfg.threshold; $('tv').textContent = cfg.threshold;
});

$('enabled').onchange = e => chrome.storage.sync.set({ enabled: e.target.checked });
document.querySelectorAll('input[name=mode]').forEach(r =>
  r.onchange = () => chrome.storage.sync.set({ mode: r.value }));
$('strength').oninput = e => { $('sv').textContent = e.target.value + '%'; chrome.storage.sync.set({ strength: +e.target.value }); };
$('maxZoom').oninput = e => { $('mv').textContent = e.target.value + 'x'; chrome.storage.sync.set({ maxZoom: +e.target.value }); };
$('threshold').oninput = e => { $('tv').textContent = e.target.value; chrome.storage.sync.set({ threshold: +e.target.value }); };

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
