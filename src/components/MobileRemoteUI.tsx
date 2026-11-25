import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Cast,
  ChevronLeft,
  Disc3,
  Download,
  Home,
  Infinity as InfinityIcon,
  Keyboard,
  ListMusic,
  Maximize2,
  Mic,
  Minimize2,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  SkipBack,
  SkipForward,
  Sun,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { PlayerState, SystemStatus, Track } from '../types';
import { cleanQueueTrack, getTrackDisplayArtist, getTrackDisplayTitle } from '../utils/queueTracks';
import { usePWAInstall } from '../hooks/usePWAInstall';
import './mobileRemote.css';

interface MobileRemoteUIProps {
  playerState: PlayerState;
  playlistQueue: Track[];
  playlistIndex: number;
  isConnected: boolean;
  isListening: boolean;
  systemStatus: SystemStatus;
  onTogglePlay: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onSeek: (time: number) => void;
  onSelectTrack: (track: Track, index: number) => void;
  onEnqueueTrack: (track: Track) => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleRepeat: () => void;
  onToggleNonStop: () => void;
  onToggleListening: () => void;
  onPlayNow: (track: Track) => void;
}

type Screen = 'queue' | 'player' | 'search';

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getInitialTheme(): 'light' | 'dark' {
  try {
    const requested = new URLSearchParams(window.location.search).get('theme');
    if (requested === 'dark' || requested === 'light') return requested;
    const saved = localStorage.getItem('serchtube_remote_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  // El diseño base es claro; el modo oscuro se activa a mano desde el botón.
  return 'light';
}

const WAVE_BARS = [18, 30, 24, 44, 34, 22, 40, 52, 28, 18, 38, 46, 24, 32, 20, 42, 30, 16];

const ANDROID_APK_URL =
  'https://raw.githubusercontent.com/blooderscrew1-alt/SerchTube-PC/main/public/SerchTubeRemote.apk?v=4';

export const MobileRemoteUI: React.FC<MobileRemoteUIProps> = ({
  playerState,
  playlistQueue,
  playlistIndex,
  isConnected,
  isListening,
  systemStatus,
  onTogglePlay,
  onNextTrack,
  onPreviousTrack,
  onSeek,
  onSelectTrack,
  onEnqueueTrack,
  onReorderQueue,
  onVolumeChange,
  onToggleMute,
  onToggleRepeat,
  onToggleNonStop,
  onToggleListening,
  onPlayNow
}) => {
  const [screen, setScreen] = useState<Screen>(() => {
    try {
      const requested = new URLSearchParams(window.location.search).get('screen');
      if (requested === 'queue' || requested === 'search' || requested === 'player') return requested;
    } catch {}
    return 'player';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedResult, setSelectedResult] = useState<Track | null>(null);
  const [feedback, setFeedback] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => !!document.fullscreenElement);
  const [dragState, setDragState] = useState<{ from: number; over: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fullscreenHistoryRef = useRef(false);
  const longPressRef = useRef<number | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; index: number; pointerId: number; element: HTMLElement } | null>(null);
  const suppressClickRef = useRef(false);
  const dragStateRef = useRef<{ from: number; over: number } | null>(null);
  dragStateRef.current = dragState;
  const { isInstalled, install, browserName } = usePWAInstall();
  const isApkWrapper = (() => {
    try {
      return new URLSearchParams(window.location.search).get('source') === 'apk';
    } catch {
      return false;
    }
  })();

  const queue = useMemo<Track[]>(() => {
    if (Array.isArray(playlistQueue) && playlistQueue.length > 0) return playlistQueue;
    return playerState.currentTrack ? [playerState.currentTrack] : [];
  }, [playlistQueue, playerState.currentTrack]);

  const currentIndex = useMemo(() => {
    const id = playerState.currentTrack?.id;
    if (id) {
      const found = queue.findIndex(track => track.id === id);
      if (found >= 0) return found;
    }
    return Math.min(Math.max(0, playlistIndex || 0), Math.max(0, queue.length - 1));
  }, [queue, playlistIndex, playerState.currentTrack?.id]);

  const current = playerState.currentTrack || queue[currentIndex] || null;
  const cover = current?.thumbnail || (current?.id ? `https://i.ytimg.com/vi/${current.id}/hqdefault.jpg` : '');
  const title = current ? getTrackDisplayTitle(current) : 'Sin reproducción';
  const artist = current ? getTrackDisplayArtist(current) : 'Abre la cola o busca una canción';

  const duration = Math.max(0, playerState.duration || 0);
  const visibleTime = scrub !== null ? scrub : Math.min(playerState.currentTime || 0, duration || 0);
  const progress = duration > 0 ? Math.min(100, (visibleTime / duration) * 100) : 0;
  const volume = Math.min(15, Math.max(0, playerState.volume || 0));
  const volumePercent = Math.round((volume / 15) * 100);
  const isPlaying = !!playerState.isPlaying;
  const repeatOn = playerState.repeatMode !== 'none';
  const nonStop = playerState.nonStop !== false;

  useEffect(() => {
    try {
      localStorage.setItem('serchtube_remote_theme', theme);
    } catch {}
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const requestFullscreen = () => {
    try {
      if (document.fullscreenElement) return;
      const target = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const result = target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {});
      }
    } catch {}
  };

  const exitFullscreen = () => {
    try {
      const result = document.exitFullscreen?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  };

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) {
        exitFullscreen();
      } else {
        requestFullscreen();
      }
    } catch {}
  };

  const handleInstall = async () => {
    // En Android se descarga el APK nativo directamente desde GitHub.
    // El APK busca el host en la red y abre el mando a pantalla completa.
    if (/android/i.test(navigator.userAgent)) {
      setInstallOpen(false);
      window.location.href = ANDROID_APK_URL;
      return;
    }

    const result = await install();
    if (result === 'manual') setInstallOpen(true);
  };

  const callApkHost = (method: 'searchAnotherHost' | 'enterHostManually') => {
    try {
      const bridge = (window as any).SerchTubeHost;
      if (bridge && typeof bridge[method] === 'function') bridge[method]();
    } catch {}
  };

  useEffect(() => {
    const pushFullscreenGuard = () => {
      if (fullscreenHistoryRef.current) return;
      try {
        history.pushState({ ...(history.state || {}), __serchtubeFullscreen: true }, '', location.href);
        fullscreenHistoryRef.current = true;
      } catch {}
    };

    const dropFullscreenGuard = () => {
      if (!fullscreenHistoryRef.current) return;
      fullscreenHistoryRef.current = false;
      try {
        if (history.state?.__serchtubeFullscreen) history.back();
      } catch {}
    };

    const onChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (active) pushFullscreenGuard();
      else dropFullscreenGuard();
    };

    // El botón Atrás del teléfono primero abandona pantalla completa y recién
    // después permite salir de la página. El estado extra de historial hace que
    // ese primer "Atrás" no navegue fuera del mando.
    const onPopState = () => {
      if (document.fullscreenElement) {
        fullscreenHistoryRef.current = false;
        exitFullscreen();
      }
    };

    const tryEnterFullscreen = () => {
      if (!document.fullscreenElement) requestFullscreen();
    };

    const gestureEvents = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'keydown'] as const;
    const onGesture = () => tryEnterFullscreen();

    const stopGestureListeners = () => {
      gestureEvents.forEach(eventName => {
        window.removeEventListener(eventName, onGesture, true);
      });
    };

    // Intentos automáticos al arrancar (el navegador puede rechazarlos hasta
    // que exista un gesto) y en cada gesto hasta lograrlo. Sin límite de tiempo:
    // si el usuario tarda en tocar, el primer toque igual entra en fullscreen.
    const bootTimers = [
      window.setTimeout(tryEnterFullscreen, 350),
      window.setTimeout(tryEnterFullscreen, 1200)
    ];
    gestureEvents.forEach(eventName => {
      window.addEventListener(eventName, onGesture, { capture: true, passive: true });
    });

    const onFullscreenForGestures = () => {
      if (document.fullscreenElement) {
        stopGestureListeners();
      }
    };

    const onVisibleAgain = () => {
      if (document.visibilityState === 'visible') tryEnterFullscreen();
    };

    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('fullscreenchange', onFullscreenForGestures);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('focus', tryEnterFullscreen);
    window.addEventListener('pageshow', tryEnterFullscreen);
    document.addEventListener('visibilitychange', onVisibleAgain);

    return () => {
      bootTimers.forEach(timer => window.clearTimeout(timer));
      stopGestureListeners();
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('fullscreenchange', onFullscreenForGestures);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('focus', tryEnterFullscreen);
      window.removeEventListener('pageshow', tryEnterFullscreen);
      document.removeEventListener('visibilitychange', onVisibleAgain);
    };
  }, []);

  useEffect(() => {
    if (screen === 'search') {
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 120);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [screen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(''), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const submitSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = searchText.trim();
    if (!query) return;

    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&isArtist=false`);
      const data = await response.json();
      const rawItems: Track[] = Array.isArray(data?.items) && data.items.length > 0
        ? data.items
        : (data?.firstTrack ? [data.firstTrack] : []);

      const seen = new Set<string>();
      const cleaned = rawItems
        .map(item => cleanQueueTrack(item))
        .filter(item => {
          if (!item?.id || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .slice(0, 30);

      setSearchResults(cleaned);
      if (cleaned.length === 0) {
        setSearchError(data?.motivo || 'No encontré resultados para esa búsqueda.');
      }
    } catch {
      setSearchError('No se pudo buscar. Revisa la conexión con el host.');
    } finally {
      setSearching(false);
    }
  };

  const playSelectedNow = () => {
    if (!selectedResult) return;
    onPlayNow(selectedResult);
    setSelectedResult(null);
    setScreen('player');
  };

  const enqueueSelected = () => {
    if (!selectedResult) return;
    onEnqueueTrack(selectedResult);
    setFeedback(`“${getTrackDisplayTitle(selectedResult)}” añadida a la cola`);
    setSelectedResult(null);
  };

  const commitSeek = () => {
    if (scrub === null) return;
    onSeek(scrub);
    setScrub(null);
  };

  const clearLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const endDrag = (commit: boolean) => {
    clearLongPress();
    const drag = dragStateRef.current;
    if (commit && drag && drag.from !== drag.over) {
      onReorderQueue(drag.from, drag.over);
    }
    if (drag) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 280);
    }
    dragStartRef.current = null;
    setDragState(null);
  };

  const onQueuePointerDown = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;

    clearLongPress();
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      index,
      pointerId: event.pointerId,
      element: event.currentTarget
    };
    const start = dragStartRef.current;
    longPressRef.current = window.setTimeout(() => {
      setDragState({ from: index, over: index });
      suppressClickRef.current = true;
      try { start.element.setPointerCapture(start.pointerId); } catch {}
      try { navigator.vibrate?.(12); } catch {}
    }, 380);
  };

  const onQueuePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    if (!dragStateRef.current) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
        clearLongPress();
      }
      return;
    }
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const row = element?.closest('[data-queue-index]') as HTMLElement | null;
    const over = Number(row?.dataset.queueIndex);
    if (Number.isInteger(over)) {
      setDragState(prev => (prev && prev.over !== over ? { ...prev, over } : prev));
    }
  };

  const onQueuePointerUp = () => endDrag(true);
  const onQueuePointerCancel = () => endDrag(false);

  useEffect(() => () => clearLongPress(), []);

  useEffect(() => {
    if (!dragState) return undefined;
    const preventScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener('touchmove', preventScroll, { passive: false });
    return () => document.removeEventListener('touchmove', preventScroll);
  }, [dragState]);

  return (
    <div className={`mr-app ${dragState ? 'is-dragging-queue' : ''}`} data-theme={theme}>
      <div className="mr-ambient" aria-hidden="true">
        <span className="mr-blob mr-blob-a" />
        <span className="mr-blob mr-blob-b" />
        <span className="mr-blob mr-blob-c" />
      </div>

      <div className="mr-stage">
        {/* ───────────────────────── COLA ───────────────────────── */}
        <section className={`mr-panel mr-queue-panel ${screen === 'queue' ? 'is-active' : ''}`} aria-hidden={screen !== 'queue' && screen !== 'player' ? true : undefined}>
          <header className="mr-queue-head">
            <div>
              <p className="mr-eyebrow">COLA DE REPRODUCCIÓN</p>
            </div>
            <div className="mr-head-actions">
              {!isInstalled && !isApkWrapper && (
                <button type="button" className="mr-icon-btn" aria-label="Instalar aplicación" title="Instalar aplicación" onClick={handleInstall}>
                  <Download size={18} />
                </button>
              )}
              <button type="button" className="mr-icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema">
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <div className="mr-menu-wrap">
                <button
                  type="button"
                  className="mr-icon-btn"
                  aria-label="Más opciones"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(open => !open);
                  }}
                >
                  <MoreHorizontal size={20} />
                </button>
                {menuOpen && (
                  <div className="mr-menu" onPointerDown={event => event.stopPropagation()}>
                    <button type="button" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setMenuOpen(false); }}>
                      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                      {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                    </button>
                    <button type="button" onClick={() => { setScreen('search'); setMenuOpen(false); }}>
                      <Search size={15} /> Buscar música
                    </button>
                    <button type="button" onClick={() => { toggleFullscreen(); setMenuOpen(false); }}>
                      {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                      {isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                    </button>
                    {!isInstalled && !isApkWrapper && (
                      <button type="button" onClick={() => { handleInstall(); setMenuOpen(false); }}>
                        <Download size={15} /> Instalar aplicación
                      </button>
                    )}
                    {isApkWrapper && (
                      <>
                        <div className="mr-menu-divider" />
                        <button type="button" onClick={() => { callApkHost('searchAnotherHost'); setMenuOpen(false); }}>
                          <RefreshCw size={15} /> Buscar otro host
                        </button>
                        <button type="button" onClick={() => { callApkHost('enterHostManually'); setMenuOpen(false); }}>
                          <Keyboard size={15} /> Ingresar host manual
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="mr-icon-btn" aria-label="Cerrar cola" title="Cerrar cola" onClick={() => setScreen('player')}>
                <X size={19} />
              </button>
            </div>
          </header>

          <div className="mr-queue-list" role="list">
            {queue.length === 0 && (
              <div className="mr-empty">
                <Music2 size={26} />
                <strong>La cola está vacía</strong>
                <span>Busca una canción para empezar.</span>
                <button type="button" onClick={() => setScreen('search')}>Buscar ahora</button>
              </div>
            )}

            {queue.map((track, index) => {
              const isCurrent = track.id === current?.id;
              const distance = Math.abs(index - currentIndex);
              const trackTitle = getTrackDisplayTitle(track);
              const trackArtist = getTrackDisplayArtist(track);
              const trackCover = track.thumbnail || (track.id ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` : '');
              return (
                <div
                  key={`${track.id}-${index}`}
                  role="listitem"
                  data-queue-index={index}
                  className={`mr-track ${isCurrent ? 'is-current' : ''} ${dragState?.from === index ? 'is-dragging' : ''} ${dragState?.over === index && dragState.from !== index ? 'is-drop-target' : ''}`}
                  style={{
                    ['--delay' as string]: `${Math.min(index, 10) * 55}ms`,
                    ['--tilt' as string]: `${index % 2 === 0 ? -1.6 : 1.6}deg`,
                    ['--shift' as string]: `${isCurrent ? 0 : (index % 3) * 9}px`,
                    ['--cover-scale' as string]: isCurrent ? '1.16' : `${Math.max(0.78, 1 - distance * 0.055)}`
                  }}
                  onPointerDown={(event) => onQueuePointerDown(event, index)}
                  onPointerMove={onQueuePointerMove}
                  onPointerUp={onQueuePointerUp}
                  onPointerCancel={onQueuePointerCancel}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    onSelectTrack(track, index);
                  }}
                >
                  <div className="mr-track-cover">
                    {trackCover ? <img src={trackCover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={20} />}
                    {isCurrent && <span className="mr-onair">ON AIR</span>}
                  </div>
                  <div className="mr-track-copy">
                    <strong>{trackTitle}</strong>
                    <span>{trackArtist}</span>
                  </div>
                  <div className="mr-track-actions">
                    <button
                      type="button"
                      className="mr-mini-btn"
                      title="Añadir a la cola"
                      aria-label={`Añadir ${trackTitle} a la cola`}
                      onClick={(event) => { event.stopPropagation(); onEnqueueTrack(track); }}
                    >
                      <Plus size={17} />
                    </button>
                    <button
                      type="button"
                      className={`mr-mini-btn ${isCurrent ? 'is-primary' : ''}`}
                      title="Reproducir ahora"
                      aria-label={isCurrent && isPlaying ? 'Pausar' : `Reproducir ${trackTitle} ahora`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isCurrent) onTogglePlay();
                        else onSelectTrack(track, index);
                      }}
                    >
                      {isCurrent && isPlaying ? <Pause size={16} /> : <Play size={16} className="mr-fill" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <nav className="mr-dock" aria-label="Navegación del mando">
            <button type="button" className={screen === 'queue' ? 'is-active' : ''} onClick={() => setScreen('queue')} aria-label="Cola">
              <Home size={19} />
            </button>
            <button type="button" className={screen === 'search' ? 'is-active' : ''} onClick={() => setScreen('search')} aria-label="Buscar">
              <Search size={20} />
            </button>
            <button type="button" className={screen === 'player' ? 'is-active' : ''} onClick={() => setScreen('player')} aria-label="Reproductor">
              <Bookmark size={19} />
            </button>
          </nav>
        </section>

        {/* ─────────────────────── REPRODUCTOR ─────────────────────── */}
        <section className={`mr-panel mr-player-panel ${screen === 'player' ? 'is-active' : ''}`}>
          <header className="mr-player-top">
            <button type="button" className="mr-icon-btn" aria-label="Ver cola" onClick={() => setScreen('queue')}>
              <ChevronLeft size={21} />
            </button>
            <div className={`mr-connection ${isConnected ? 'is-online' : ''}`}>
              {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span>{isConnected ? 'En línea' : 'Sin conexión'}</span>
            </div>
            <div className="mr-head-actions">
              {!isInstalled && !isApkWrapper && (
                <button type="button" className="mr-icon-btn" aria-label="Instalar aplicación" title="Instalar aplicación" onClick={handleInstall}>
                  <Download size={18} />
                </button>
              )}
              <button type="button" className="mr-icon-btn" aria-label="Ver cola" onClick={() => setScreen('queue')}>
                <Cast size={19} />
              </button>
              <div className="mr-menu-wrap">
                <button
                  type="button"
                  className="mr-icon-btn"
                  aria-label="Más opciones"
                  onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open); }}
                >
                  <MoreHorizontal size={20} />
                </button>
                {menuOpen && (
                  <div className="mr-menu" onPointerDown={event => event.stopPropagation()}>
                    <button type="button" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setMenuOpen(false); }}>
                      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                      {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                    </button>
                    <button type="button" onClick={() => { setScreen('search'); setMenuOpen(false); }}>
                      <Search size={15} /> Buscar música
                    </button>
                    <button type="button" onClick={() => { toggleFullscreen(); setMenuOpen(false); }}>
                      {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                      {isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                    </button>
                    {!isInstalled && !isApkWrapper && (
                      <button type="button" onClick={() => { handleInstall(); setMenuOpen(false); }}>
                        <Download size={15} /> Instalar aplicación
                      </button>
                    )}
                    {isApkWrapper && (
                      <>
                        <div className="mr-menu-divider" />
                        <button type="button" onClick={() => { callApkHost('searchAnotherHost'); setMenuOpen(false); }}>
                          <RefreshCw size={15} /> Buscar otro host
                        </button>
                        <button type="button" onClick={() => { callApkHost('enterHostManually'); setMenuOpen(false); }}>
                          <Keyboard size={15} /> Ingresar host manual
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className={`mr-deck ${isPlaying ? 'is-playing' : ''}`}>
            <div className="mr-deck-card">
              <div className="mr-platter">
                <div className="mr-vinyl-wrap">
                  <div
                    className="mr-vinyl"
                    style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
                  >
                    <span className="mr-grooves" />
                    <span className="mr-label">
                      {cover ? <img src={cover} alt="" referrerPolicy="no-referrer" /> : <Disc3 size={22} />}
                    </span>
                    <span className="mr-spindle" />
                  </div>
                </div>
                <div className="mr-tonearm" aria-hidden="true">
                  <span className="mr-tonearm-base" />
                  <span className="mr-tonearm-bar" />
                  <span className="mr-tonearm-head" />
                </div>
              </div>

              <button type="button" className="mr-deck-orb mr-deck-orb-left" aria-label={isPlaying ? 'Pausar' : 'Reproducir'} onClick={onTogglePlay}>
                {isPlaying ? <Pause size={19} className="mr-fill" /> : <Play size={19} className="mr-fill" />}
              </button>
              <button
                type="button"
                className="mr-deck-orb mr-deck-orb-right"
                aria-label="Buscar música"
                title="Buscar música"
                onClick={() => setScreen('search')}
              >
                <Search size={19} />
              </button>
            </div>
          </div>

          <div className="mr-now" key={`${current?.id || 'none'}-${title}`}>
            <h1>{title}</h1>
            <p>{artist}</p>
          </div>

          <div className={`mr-wave ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true">
            {WAVE_BARS.map((height, index) => (
              <span key={index} style={{ ['--h' as string]: `${height}px`, ['--d' as string]: `${index * 55}ms` }} />
            ))}
          </div>

          <div className="mr-progress">
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={1}
              value={visibleTime}
              className="mr-range"
              style={{ ['--p' as string]: `${progress}%` }}
              aria-label="Posición de la canción"
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={commitSeek}
              onTouchEnd={commitSeek}
              onKeyUp={commitSeek}
            />
            <div className="mr-time-single">
              <span>{formatTime(visibleTime)}</span>
              <span className="mr-time-sep">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="mr-tools">
            <button type="button" className="mr-tool" aria-label="Ver cola" onClick={() => setScreen('queue')}>
              <ListMusic size={17} />
            </button>
            <button
              type="button"
              className={`mr-tool ${repeatOn ? 'is-on' : ''}`}
              aria-label="Repetir"
              onClick={onToggleRepeat}
            >
              <Repeat size={17} />
              {playerState.repeatMode === 'one' && <span className="mr-tool-dot" />}
            </button>
            <button
              type="button"
              className={`mr-tool ${nonStop ? 'is-on' : ''}`}
              aria-label="Reproducción continua"
              onClick={onToggleNonStop}
            >
              <InfinityIcon size={18} />
            </button>
            <div className="mr-volume-wrap">
              <button
                type="button"
                className={`mr-tool ${playerState.isMuted ? 'is-muted' : ''}`}
                aria-label={playerState.isMuted ? 'Activar sonido' : 'Ajustar volumen'}
                onClick={() => setVolumeOpen(open => !open)}
              >
                {playerState.isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              {volumeOpen && (
                <div className="mr-volume-pop">
                  <input
                    type="range"
                    min={0}
                    max={15}
                    step={1}
                    value={volume}
                    className="mr-range mr-range-volume"
                    style={{ ['--p' as string]: `${volumePercent}%` }}
                    aria-label="Volumen"
                    onChange={(event) => onVolumeChange(Number(event.target.value))}
                  />
                  <span>{volume}/15</span>
                  <button type="button" className="mr-volume-mute" onClick={onToggleMute}>
                    {playerState.isMuted ? 'Activar sonido' : 'Silenciar'}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className={`mr-tool ${isListening ? 'is-live' : ''}`}
              aria-label="Micrófono"
              onClick={onToggleListening}
            >
              <Mic size={17} />
              {isListening && <span className="mr-live-ring" />}
            </button>
          </div>

          <div className="mr-transport">
            <button type="button" className="mr-skip-pill" aria-label="Anterior" onClick={onPreviousTrack}>
              <SkipBack size={19} />
            </button>
            <button type="button" className="mr-main-play" aria-label={isPlaying ? 'Pausar' : 'Reproducir'} onClick={onTogglePlay}>
              {isPlaying ? <Pause size={25} className="mr-fill" /> : <Play size={25} className="mr-fill" />}
            </button>
            <button type="button" className="mr-skip-pill" aria-label="Siguiente" onClick={onNextTrack}>
              <SkipForward size={19} />
            </button>
          </div>

          <p className={`mr-status-text ${systemStatus === 'processing' ? 'is-busy' : ''}`}>
            {systemStatus === 'processing' ? 'Procesando orden…' : isListening ? 'Escuchando…' : ''}
          </p>
        </section>

        {/* ─────────────────────── BUSCAR ─────────────────────── */}
        <section className={`mr-panel mr-search-panel ${screen === 'search' ? 'is-active' : ''}`}>
          <header className="mr-player-top">
            <button type="button" className="mr-icon-btn" aria-label="Volver" onClick={() => setScreen('player')}>
              <ChevronLeft size={21} />
            </button>
            <p className="mr-eyebrow">BUSCAR</p>
            <button type="button" className="mr-icon-btn" aria-label="Cerrar búsqueda" onClick={() => setScreen('player')}>
              <X size={19} />
            </button>
          </header>

          <form className="mr-search-form" onSubmit={submitSearch}>
            <Search size={20} />
            <input
              ref={searchInputRef}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Canción, artista o álbum completo…"
              autoComplete="off"
              enterKeyHint="search"
            />
            <button type="submit" disabled={!searchText.trim()}>Ir</button>
          </form>

          <div className="mr-search-results">
            {searching && (
              <div className="mr-search-state">
                <span className="mr-search-spinner" />
                Buscando en el host…
              </div>
            )}

            {!searching && searchError && (
              <div className="mr-search-state is-error">{searchError}</div>
            )}

            {!searching && !searchError && searchResults.map(track => {
              const trackTitle = getTrackDisplayTitle(track);
              const trackArtist = getTrackDisplayArtist(track);
              const trackCover = track.thumbnail || (track.id ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` : '');
              return (
                <button
                  type="button"
                  key={track.id}
                  className="mr-result"
                  onClick={() => setSelectedResult(track)}
                >
                  <span className="mr-result-cover">
                    {trackCover ? <img src={trackCover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={18} />}
                  </span>
                  <span className="mr-result-copy">
                    <strong>{trackTitle}</strong>
                    <span>{trackArtist}</span>
                  </span>
                  <span className="mr-result-menu"><MoreHorizontal size={18} /></span>
                </button>
              );
            })}

            {!searching && !searchError && searchResults.length === 0 && (
              <div className="mr-search-hints">
                <p>Busca y elige qué hacer:</p>
                <button type="button" onClick={() => { setSearchText('eminem slim shady album completo'); searchInputRef.current?.focus(); }}>
                  “eminem slim shady album completo”
                </button>
                <button type="button" onClick={() => { setSearchText('arjona Déjame decir que te amo album completo'); searchInputRef.current?.focus(); }}>
                  “arjona Déjame decir que te amo album completo”
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {feedback && <div className="mr-toast">{feedback}</div>}

      {selectedResult && (
        <div className="mr-sheet-backdrop" onClick={() => setSelectedResult(null)}>
          <div className="mr-action-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="mr-sheet-track">
              <span className="mr-sheet-cover">
                {selectedResult.thumbnail
                  ? <img src={selectedResult.thumbnail} alt="" referrerPolicy="no-referrer" />
                  : <Music2 size={20} />}
              </span>
              <span className="mr-sheet-copy">
                <strong>{getTrackDisplayTitle(selectedResult)}</strong>
                <span>{getTrackDisplayArtist(selectedResult)}</span>
              </span>
              <button type="button" className="mr-sheet-close" aria-label="Cerrar" onClick={() => setSelectedResult(null)}>
                <X size={17} />
              </button>
            </div>
            <button type="button" className="mr-sheet-action is-primary" onClick={playSelectedNow}>
              <Play size={18} className="mr-fill" />
              <span>Reproducir ahora mismo</span>
            </button>
            <button type="button" className="mr-sheet-action" onClick={enqueueSelected}>
              <Plus size={19} />
              <span>Agregar a la cola</span>
            </button>
            <button type="button" className="mr-sheet-cancel" onClick={() => setSelectedResult(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {installOpen && (
        <div className="mr-modal-backdrop" onClick={() => setInstallOpen(false)}>
          <div className="mr-install-modal" onClick={(event) => event.stopPropagation()}>
            <div className="mr-install-icon"><Download size={22} /></div>
            <h3>Instalar SerchTube</h3>
            {browserName === 'safari' ? (
              <p>Pulsa <strong>Compartir</strong> y elige <strong>Añadir a pantalla de inicio</strong>.</p>
            ) : (
              <p>Abre el menú del navegador y elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</p>
            )}
            <p className="mr-install-note">Se abrirá sin barra de direcciones, como una app nativa.</p>
            <button type="button" onClick={() => setInstallOpen(false)}>Entendido</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileRemoteUI;
