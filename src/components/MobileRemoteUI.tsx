import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Cast,
  ChevronLeft,
  Disc3,
  Home,
  Infinity as InfinityIcon,
  ListMusic,
  Mic,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
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
import { getTrackDisplayArtist, getTrackDisplayTitle } from '../utils/queueTracks';
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
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleRepeat: () => void;
  onToggleNonStop: () => void;
  onToggleListening: () => void;
  onDirectSearch: (query: string) => void;
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
  onVolumeChange,
  onToggleMute,
  onToggleRepeat,
  onToggleNonStop,
  onToggleListening,
  onDirectSearch
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  const submitSearch = (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    onDirectSearch(query);
    setSearchText('');
    setScreen('player');
  };

  const commitSeek = () => {
    if (scrub === null) return;
    onSeek(scrub);
    setScrub(null);
  };

  return (
    <div className="mr-app" data-theme={theme}>
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
                  </div>
                )}
              </div>
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
              const isFar = distance >= 4;
              const trackTitle = getTrackDisplayTitle(track);
              const trackArtist = getTrackDisplayArtist(track);
              const trackCover = track.thumbnail || (track.id ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg` : '');
              return (
                <div
                  key={`${track.id}-${index}`}
                  role="listitem"
                  className={`mr-track ${isCurrent ? 'is-current' : ''} ${isFar ? 'is-far' : ''}`}
                  style={{
                    ['--delay' as string]: `${Math.min(index, 10) * 55}ms`,
                    ['--tilt' as string]: `${index % 2 === 0 ? -1.6 : 1.6}deg`,
                    ['--shift' as string]: `${isCurrent ? 0 : (index % 3) * 9}px`,
                    ['--cover-scale' as string]: isCurrent ? '1.16' : `${Math.max(0.78, 1 - distance * 0.055)}`
                  }}
                  onClick={() => onSelectTrack(track, index)}
                >
                  <div className="mr-track-cover">
                    {trackCover ? <img src={trackCover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Music2 size={20} />}
                    {isCurrent && <span className="mr-onair">ON AIR</span>}
                  </div>
                  <div className="mr-track-copy">
                    <strong>{trackTitle}</strong>
                    <span>{trackArtist}</span>
                  </div>
                  {isCurrent && (
                    <div className="mr-track-actions">
                      <button
                        type="button"
                        className="mr-mini-btn"
                        aria-label={`Añadir ${trackTitle} a la cola`}
                        onClick={(event) => { event.stopPropagation(); onEnqueueTrack(track); }}
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        type="button"
                        className="mr-mini-btn is-primary"
                        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
                        onClick={(event) => { event.stopPropagation(); onTogglePlay(); }}
                      >
                        {isPlaying ? <Pause size={17} /> : <Play size={17} className="mr-fill" />}
                      </button>
                    </div>
                  )}
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
                aria-label="Pausar"
                onClick={() => { if (isPlaying) onTogglePlay(); }}
              >
                <Pause size={19} className="mr-fill" />
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

          <div className="mr-search-hints">
            <p>Prueba con:</p>
            <button type="button" onClick={() => { setSearchText('reproduce eminem slim shady album completo'); searchInputRef.current?.focus(); }}>
              “eminem slim shady album completo”
            </button>
            <button type="button" onClick={() => { setSearchText('reproduce arjona Déjame decir que te amo album completo'); searchInputRef.current?.focus(); }}>
              “arjona Déjame decir que te amo album completo”
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default MobileRemoteUI;
