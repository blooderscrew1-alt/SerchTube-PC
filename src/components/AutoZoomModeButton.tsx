import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, MoveHorizontal, Frame, PowerOff, Puzzle, AlertTriangle, RefreshCw, Check } from 'lucide-react';

/**
 * Boton de accion rapida "Auto Zoom" de la barra de informacion inferior.
 *
 * Puente entre SerchTube y la extension de Edge "YouTube Auto Zoom - Barras
 * negras" (carpeta extensions/yt-blackbars de este repositorio).
 *
 * Por que hace falta un puente:
 *  - SerchTube reproduce YouTube dentro de un <iframe> de youtube.com.
 *  - La extension solo actua cuando `document.fullscreenElement` existe DENTRO
 *    del iframe, pero SerchTube pone en pantalla completa el documento padre
 *    (localhost), asi que dentro del iframe nunca hay pantalla completa y la
 *    extension se quedaba inactiva.
 *  - Ademas, en la ventana tipo app de Edge no hay barra de extensiones, por lo
 *    que el popup de la extension no se puede abrir.
 *
 * Solucion: SerchTube envia mensajes `postMessage` al iframe (el content script
 * de la extension los escucha) para encender/apagar y conmutar sus tres modos,
 * y la extension responde con su estado real.
 *
 * IMPORTANTE: si la extension instalada en Edge es la 1.7.0 (sin puente), no
 * responde a nada. El boton lo detecta y muestra "Sin respuesta" con el aviso
 * de recargarla en edge://extensions. Este es el fallo mas habitual.
 */

export type AutoZoomMode = 'zoom' | 'stretch' | 'fit';
export type AutoZoomState = AutoZoomMode | 'off';

const STORAGE_KEY = 'serchtube_autozoom_state';

/** Mensajes SerchTube -> content script de la extension */
export const BRIDGE_IN = 'serchtube-autozoom';
/** Mensajes content script de la extension -> SerchTube */
export const BRIDGE_OUT = 'serchtube-autozoom-status';
const SOURCE_IN = 'serchtube';
const SOURCE_OUT = 'yt-autozoom';
const IFRAME_ID = 'yt-player-iframe';

/** Version minima de la extension que entiende el puente. */
const BRIDGE_MIN_VERSION = '1.8.0';
/** Tiempo sin respuesta tras el cual se avisa de que no hay extension. */
const SIN_RESPUESTA_MS = 6000;
/** Margen tras una accion del usuario en el que se ignoran los sondeos. */
const IGNORAR_SONDEO_MS = 2500;

export const AUTOZOOM_STATE_INFO: Record<
  AutoZoomState,
  { label: string; badge: string; hint: string; accent: string; border: string }
> = {
  zoom: {
    label: 'Zoom',
    badge: 'ZOOM',
    hint: 'Rellena la pantalla sin deformar (recorta bordes sobrantes)',
    accent: 'text-red-400',
    border: 'border-red-500/60'
  },
  stretch: {
    label: 'Estirar',
    badge: 'ESTIRA',
    hint: 'Rellena todo estirando la imagen (puede deformar)',
    accent: 'text-amber-400',
    border: 'border-amber-500/60'
  },
  fit: {
    label: 'Ajustar',
    badge: 'AJUSTA',
    hint: 'Solo quita las barras negras, sin recortar ni deformar',
    accent: 'text-emerald-400',
    border: 'border-emerald-500/60'
  },
  off: {
    label: 'Desactivado',
    badge: 'OFF',
    hint: 'Auto Zoom apagado: se ve el video tal cual llega',
    accent: 'text-gray-400',
    border: 'border-white/15'
  }
};

const ORDER: AutoZoomState[] = ['zoom', 'stretch', 'fit', 'off'];

function readStoredState(): AutoZoomState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (ORDER as string[]).includes(raw)) return raw as AutoZoomState;
  } catch {
    /* localStorage no disponible */
  }
  return 'zoom';
}

function persistState(state: AutoZoomState) {
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* ignorar */
  }
}

/** Compara versiones tipo "1.8.0" >= "1.8.0". */
function versionSuficiente(version: string | null): boolean {
  if (!version) return false;
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = BRIDGE_MIN_VERSION.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

interface AutoZoomModeButtonProps {
  /** Indica si el reproductor esta en pantalla completa dentro de SerchTube. */
  isFullscreen?: boolean;
  /** Permite desactivar el puente (p. ej. en el nodo satelite, que no reproduce). */
  enabled?: boolean;
  className?: string;
}

export const AutoZoomModeButton: React.FC<AutoZoomModeButtonProps> = ({
  isFullscreen = false,
  enabled = true,
  className = ''
}) => {
  const [state, setState] = useState<AutoZoomState>(readStoredState);
  // 'desconocido' hasta que responda (o deje de responder) la extension
  const [estado, setEstado] = useState<'desconocido' | 'conectada' | 'sin_respuesta'>('desconocido');
  const [version, setVersion] = useState<string | null>(null);
  const [barras, setBarras] = useState<{ t: number; b: number; l: number; r: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fullscreenRef = useRef<boolean>(isFullscreen);
  fullscreenRef.current = isFullscreen;
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const ultimaAccionRef = useRef<number>(0);
  const ultimaRespuestaRef = useRef<number>(0);

  /** Envia un mensaje al content script que vive dentro del iframe de YouTube. */
  const postToPlayer = useCallback((payload: Record<string, unknown>): boolean => {
    if (typeof document === 'undefined') return false;
    const frame = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
    const target = frame?.contentWindow;
    if (!target) return false;
    try {
      target.postMessage({ source: SOURCE_IN, type: BRIDGE_IN, ...payload }, '*');
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Aplica un estado completo (enabled + modo) en la extension. */
  const pushState = useCallback(
    (next: AutoZoomState) => {
      ultimaAccionRef.current = Date.now();
      postToPlayer({
        action: 'set',
        enabled: next !== 'off',
        mode: next === 'off' ? 'zoom' : next,
        // En SerchTube el reproductor siempre es "la pantalla" del video, asi que
        // se le pide a la extension que actue como si estuviera en pantalla completa.
        active: true
      });
    },
    [postToPlayer]
  );

  // Al conmutar el modo, se lo comunicamos a la extension.
  useEffect(() => {
    if (!enabled) return;
    pushState(state);
    persistState(state);
  }, [state, enabled, pushState]);

  // Sondeo: mantiene el puente vivo cuando el iframe se recrea al cambiar de
  // video y sincroniza el boton si el usuario cambio el modo con Bloq Mayus o
  // desde el popup de la extension. Nunca pisa una accion recien hecha aqui.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      postToPlayer({ action: 'set-active', active: true, fullscreen: fullscreenRef.current });
      postToPlayer({ action: 'status' });
    };
    const timer = window.setInterval(tick, 4000);
    const first = window.setTimeout(tick, 600);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [enabled, postToPlayer]);

  // Vigilancia: si la extension no responde en unos segundos, se avisa.
  useEffect(() => {
    if (!enabled) return;
    const comprobar = window.setInterval(() => {
      const desde = Date.now() - ultimaRespuestaRef.current;
      if (ultimaRespuestaRef.current === 0 || desde > SIN_RESPUESTA_MS) {
        setEstado('sin_respuesta');
      }
    }, 1500);
    return () => window.clearInterval(comprobar);
  }, [enabled]);

  // Respuestas de la extension: sincroniza el estado real y confirma presencia.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== SOURCE_OUT || data.type !== BRIDGE_OUT) return;

      ultimaRespuestaRef.current = Date.now();
      setEstado('conectada');
      if (data.version) setVersion(String(data.version));
      if (data.bars && typeof data.bars === 'object') {
        setBarras({ t: data.bars.t || 0, b: data.bars.b || 0, l: data.bars.l || 0, r: data.bars.r || 0 });
      } else {
        setBarras(null);
      }

      // No pisar una orden recien dada por el usuario: las respuestas de sondeo
      // que iban en camino llegarian con el estado anterior y desharian el cambio.
      if (Date.now() - ultimaAccionRef.current < IGNORAR_SONDEO_MS) return;

      const next: AutoZoomState =
        data.enabled === false ? 'off' : ((data.mode as AutoZoomMode) || 'zoom');
      setState(prev => (prev === next ? prev : next));
      persistState(next);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const cycle = useCallback(() => {
    setState(prev => ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]);
    setAviso(null);
  }, []);

  const redetectar = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    ultimaAccionRef.current = Date.now();
    postToPlayer({ action: 'redetect', active: true });
    setAviso('Redetectando…');
    window.setTimeout(() => setAviso(null), 1800);
  }, [postToPlayer]);

  const info = AUTOZOOM_STATE_INFO[state];
  const isOff = state === 'off';
  const sinRespuesta = estado === 'sin_respuesta';
  const versionVieja = estado === 'conectada' && !versionSuficiente(version);

  const subtitulo = (() => {
    if (sinRespuesta) return 'Extensión sin respuesta';
    if (versionVieja) return `Actualiza: v${version}`;
    if (estado === 'conectada') return `Extensión v${version || '?'} lista`;
    return 'Toca para cambiar';
  })();

  const detalleBarras = barras
    ? `barras ↑${Math.round(barras.t * 100)}% ↓${Math.round(barras.b * 100)}% ←${Math.round(barras.l * 100)}% →${Math.round(barras.r * 100)}%`
    : 'aún sin medir';

  const tooltip = [
    info.hint,
    '',
    'Extensión: YouTube Auto Zoom - Barras negras',
    `Estado: ${estado === 'conectada' ? `conectada (v${version})` : sinRespuesta ? 'sin respuesta' : 'comprobando…'}`,
    `Detección: ${detalleBarras}`,
    '',
    sinRespuesta
      ? 'La extensión no responde. Lo más probable: Edge sigue con la versión 1.7.0 cargada.\nAbre edge://extensions y pulsa "Recargar" en YouTube Auto Zoom (debe quedar en 1.8.0).'
      : 'Clic: conmuta Zoom -> Estirar -> Ajustar -> Desactivado'
  ].join('\n');

  return (
    <div
      id="quick-autozoom-card"
      data-keep-visible-when-idle
      className={`relative flex items-center gap-2.5 p-2 rounded-2xl bg-black/70 border shadow-lg transition-colors duration-300 select-none flex-shrink-0 ${
        isOff ? 'border-white/15' : info.border
      } ${className}`}
      title={tooltip}
    >
      <button
        type="button"
        id="btn-autozoom-cycle"
        onClick={cycle}
        className="flex items-center gap-2.5 px-1 py-0.5 rounded-xl transition-all cursor-pointer hover:bg-white/10"
        title={tooltip}
      >
        {/* Icono del modo actual */}
        <span
          className={`relative w-11 h-11 rounded-xl flex items-center justify-center border flex-shrink-0 ${
            isOff
              ? 'bg-white/5 border-white/10 text-gray-400'
              : 'bg-red-600/15 border-red-500/40 text-red-400'
          }`}
        >
          {state === 'zoom' && <Crop size={20} />}
          {state === 'stretch' && <MoveHorizontal size={20} />}
          {state === 'fit' && <Frame size={20} />}
          {isOff && <PowerOff size={20} />}
        </span>

        {/* Texto de estado */}
        <span className="flex flex-col justify-center min-w-0 pr-1 text-left">
          <span className="flex items-center gap-1 mb-0.5">
            <Puzzle size={11} className="text-red-400 shrink-0" />
            <span className="text-[9.5px] font-black text-red-400 uppercase tracking-wider truncate">
              Auto Zoom
            </span>
            {sinRespuesta && <AlertTriangle size={11} className="text-amber-400 shrink-0" />}
            {!sinRespuesta && estado === 'conectada' && (
              <Check size={11} className="text-emerald-400 shrink-0" />
            )}
          </span>

          <span className={`text-xs font-bold tracking-tight leading-tight ${info.accent}`}>
            {info.label}
          </span>
          <span
            className={`text-[10px] leading-tight mt-0.5 truncate ${
              aviso ? 'text-cyan-300' : sinRespuesta || versionVieja ? 'text-amber-400' : 'text-gray-400'
            }`}
          >
            {aviso || subtitulo}
          </span>
        </span>
      </button>

      {/* Accion secundaria: volver a analizar las barras del video actual */}
      <button
        type="button"
        id="btn-autozoom-redetect"
        onClick={redetectar}
        className="self-start p-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer flex-shrink-0"
        title="Volver a detectar las barras negras de este vídeo"
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
};

export default AutoZoomModeButton;
