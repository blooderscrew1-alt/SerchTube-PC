import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, MoveHorizontal, Frame, PowerOff } from 'lucide-react';

/**
 * Boton discreto "Auto Zoom" (solo icono) de la barra de informacion inferior,
 * colocado junto al boton de redimensionar/posicionar elementos.
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
 *    que su popup no se puede abrir.
 *
 * Controles:
 *  - Clic izquierdo: conmuta Zoom -> Estirar -> Ajustar -> Desactivado.
 *  - Clic derecho: vuelve a analizar las barras negras del video actual.
 *  - El punto ambar avisa de que la extension no responde (hay que recargarla
 *    en edge://extensions): es el fallo mas habitual.
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

const INFO: Record<AutoZoomState, { label: string; hint: string }> = {
  zoom: { label: 'Zoom', hint: 'Rellena la pantalla sin deformar (recorta bordes sobrantes)' },
  stretch: { label: 'Estirar', hint: 'Rellena todo estirando la imagen (puede deformar)' },
  fit: { label: 'Ajustar', hint: 'Solo quita las barras negras, sin recortar ni deformar' },
  off: { label: 'Desactivado', hint: 'Auto Zoom apagado: se ve el video tal cual llega' }
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
  const [estado, setEstado] = useState<'desconocido' | 'conectada' | 'sin_respuesta'>('desconocido');
  const [version, setVersion] = useState<string | null>(null);
  const [barras, setBarras] = useState<{ t: number; b: number; l: number; r: number } | null>(null);

  const fullscreenRef = useRef<boolean>(isFullscreen);
  fullscreenRef.current = isFullscreen;
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
  }, []);

  const redetectar = useCallback(() => {
    ultimaAccionRef.current = Date.now();
    postToPlayer({ action: 'redetect', active: true });
  }, [postToPlayer]);

  if (!enabled) return null;

  const info = INFO[state];
  const sinRespuesta = estado === 'sin_respuesta';
  const versionVieja = estado === 'conectada' && !versionSuficiente(version);

  const detalleBarras = barras
    ? `barras ↑${Math.round(barras.t * 100)}% ↓${Math.round(barras.b * 100)}% ←${Math.round(barras.l * 100)}% →${Math.round(barras.r * 100)}%`
    : 'aun sin medir';

  const tooltip = [
    `Auto Zoom: ${info.label}`,
    info.hint,
    '',
    'Extension: YouTube Auto Zoom - Barras negras',
    `Estado: ${estado === 'conectada' ? `conectada (v${version})` : sinRespuesta ? 'SIN RESPUESTA' : 'comprobando...'}`,
    `Deteccion: ${detalleBarras}`,
    '',
    'Clic: Zoom -> Estirar -> Ajustar -> Desactivado',
    'Clic derecho: redetectar las barras de este video',
    sinRespuesta
      ? '\nLa extension no responde. Lo mas probable: Edge sigue con la 1.7.0 cargada.\nAbre edge://extensions y pulsa "Recargar" (debe quedar en 1.8.0).'
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <button
      id="btn-autozoom-quick"
      type="button"
      data-keep-visible-when-idle
      onClick={cycle}
      onContextMenu={(e) => {
        e.preventDefault();
        redetectar();
      }}
      title={tooltip}
      aria-label={`Auto Zoom: ${info.label}`}
      className={`relative p-1.5 rounded-lg border transition-all flex-shrink-0 cursor-pointer ${
        state === 'off'
          ? 'bg-white/5 hover:bg-white/15 border-white/10 text-gray-400 hover:text-white'
          : 'bg-red-600/15 hover:bg-red-600/25 border-red-500/40 text-red-400 hover:text-red-300'
      } ${sinRespuesta ? 'border-amber-500/60' : ''} ${className}`}
    >
      {state === 'zoom' && <Crop size={14} />}
      {state === 'stretch' && <MoveHorizontal size={14} />}
      {state === 'fit' && <Frame size={14} />}
      {state === 'off' && <PowerOff size={14} />}

      {/* Aviso discreto: la extension no responde */}
      {sinRespuesta && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}
      {/* Aviso: responde pero es una version sin puente completo */}
      {versionVieja && !sinRespuesta && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" />
      )}
    </button>
  );
};

export default AutoZoomModeButton;
