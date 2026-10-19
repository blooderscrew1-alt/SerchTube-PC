import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Track, PlayerState, SystemStatus, VideoQuality, AutoVolumeReducerConfig } from '../types';
import {
  getQualityOption,
  ACCEPTABLE_480P_QUALITIES,
  hasAtLeast480pOption,
  getHighestQualityLabel,
  isQualityBelow480p
} from '../utils/quality';
import { Sparkles, Gauge, VolumeX, ArrowDown } from 'lucide-react';
import { youtubeAuthService } from '../services/youtubeAuthService';
import { AudioEngine } from '../services/audioEngine';

/**
 * La API de YouTube usa `suggestedQuality` al recargar/cargar un video.
 * SerchTube exige un estándar mínimo de 480p ('large'), por lo que 'auto' o calidades
 * inferiores sugieren 'large' como piso de resolución.
 */
function ytSuggestedQuality(calidad?: string): string {
  if (!calidad || calidad === 'auto') return 'large';
  if (calidad === 'medium' || calidad === 'small' || calidad === 'tiny') return 'large';
  return calidad;
}

interface YouTubePlayerProps {
  track: Track | null;
  playerState: PlayerState;
  onStateChange: (updates: Partial<PlayerState>) => void;
  onTrackEnded: () => void;
  isDucked: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
  onToggleNonStop?: () => void;
  onToggleListening?: () => void;
  systemStatus?: SystemStatus;
  autoVolumeConfig?: AutoVolumeReducerConfig;
  onAutoVolumeReduced?: (newVolume: number) => void;
  onQueueReferenceUpdated?: (tracks: Track[]) => void;
  onTrackSelectedByPlayer?: (track: Track) => void;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

const YouTubePlayerComponent: React.FC<YouTubePlayerProps> = ({
  track,
  playerState,
  onStateChange,
  onTrackEnded,
  isDucked,
  isFullscreen = false,
  onToggleFullscreen,
  opacity = 0.85,
  onNextTrack,
  onPreviousTrack,
  onToggleNonStop,
  onToggleListening,
  systemStatus = 'idle',
  autoVolumeConfig,
  onAutoVolumeReduced,
  onQueueReferenceUpdated,
  onTrackSelectedByPlayer
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);

  // Keep a stable ref of all latest props to eliminate stale closures without recreating callbacks
  const latestPropsRef = useRef({
    track,
    playerState,
    onStateChange,
    onTrackEnded,
    isDucked,
    opacity,
    onNextTrack,
    isFullscreen,
    onToggleFullscreen,
    onQueueReferenceUpdated,
    onTrackSelectedByPlayer
  });
  latestPropsRef.current = {
    track,
    playerState,
    onStateChange,
    onTrackEnded,
    isDucked,
    opacity,
    onNextTrack,
    isFullscreen,
    onToggleFullscreen,
    onQueueReferenceUpdated,
    onTrackSelectedByPlayer
  };

  // Performance and state tracking refs (pure mutable variables that NEVER trigger React renders)
  const isApiReadyRef = useRef<boolean>(false);
  const isPlayerReadyRef = useRef<boolean>(false);
  const isPlayingIntentRef = useRef<boolean>(playerState.isPlaying);
  const isInitialMountRef = useRef<boolean>(true);
  const lastVideoIdRef = useRef<string | null>(null);
  const trackSwitchTimeRef = useRef<number>(0);
  const pendingVideoIdRef = useRef<string | null>(track?.id || null);
  const currentTimeRef = useRef<number>(playerState.currentTime || 0);
  const durationRef = useRef<number>(playerState.duration || 0);
  const lastSecondRef = useRef<number>(-1);
  const lastAppliedQualityRef = useRef<VideoQuality>(playerState.playbackQuality || 'auto');
  const lastAppliedSpeedRef = useRef<number>(playerState.playbackSpeed || 1.0);
  const timeUpdateInterval = useRef<any>(null);

  // UI Feedback States (only for ephemeral user notifications)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qualityFeedback, setQualityFeedback] = useState<{ label: string; badge?: string; timestamp: number } | null>(null);
  const [speedFeedback, setSpeedFeedback] = useState<{ speed: number; timestamp: number } | null>(null);
  const failedVideoIdsRef = useRef<Set<string>>(new Set());
  const isRecoveringRef = useRef<boolean>(false);
  const stallWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const triggerAlternativeRecoveryRef = useRef<((reason?: string | number) => Promise<void>) | null>(null);

  // Keep playing intent in sync
  useEffect(() => {
    isPlayingIntentRef.current = playerState.isPlaying;
  }, [playerState.isPlaying]);

  // Enforce locked user quality across video events
  const enforceUserQuality = useCallback((playerInstance?: any) => {
    const target = playerInstance || playerRef.current;
    if (!target) return;
    const desired = latestPropsRef.current.playerState.playbackQuality;
    const targetQuality = (desired && desired !== 'auto' && !isQualityBelow480p(desired)) ? desired : 'large';
    try {
      if (typeof target.setPlaybackQuality === 'function') {
        target.setPlaybackQuality(targetQuality);
      }
      if (typeof target.setPlaybackQualityRange === 'function') {
        target.setPlaybackQualityRange(targetQuality, targetQuality);
      }
      lastAppliedQualityRef.current = (desired as VideoQuality) || 'auto';
    } catch (e) {}
  }, []);

  /**
   * Cambia la calidad DE VERDAD. La API ignora setPlaybackQuality, asi que hay que
   * recargar el video indicando suggestedQuality y conservando el segundo actual
   * (puede haber un instante de carga, es inevitable).
   */
  const aplicarCalidadReal = useCallback((calidad: string): boolean => {
    const player: any = playerRef.current;
    const videoId = latestPropsRef.current.track?.id || lastVideoIdRef.current;
    if (!player || !videoId || typeof player.loadVideoById !== 'function') return false;

    let tiempo = 0;
    try {
      tiempo = Math.max(0, Math.floor(player.getCurrentTime?.() ?? currentTimeRef.current ?? 0));
    } catch (e) {}

    try {
      const estabaSonando = latestPropsRef.current.playerState.isPlaying;
      player.loadVideoById(videoId, tiempo);
      if (!estabaSonando) {
        setTimeout(() => {
          try {
            player.pauseVideo?.();
          } catch (e) {}
        }, 80);
      }
      lastAppliedQualityRef.current = calidad as VideoQuality;
      currentTimeRef.current = tiempo;
      console.log(`[YouTube] Calidad cambiada a ${calidad} (recargando desde ${tiempo}s)`);
      return true;
    } catch (err) {
      console.warn('[YouTube] No pude cambiar la calidad:', err);
      return false;
    }
  }, []);

  // Calidad deseada por el usuario (se conserva aunque YouTube informe otra real)
  const desiredQualityRef = useRef<VideoQuality>(playerState.playbackQuality || 'auto');
  // Última calidad REAL informada por YouTube (solo informativa)
  const calidadInicialAplicadaRef = useRef<boolean>(false);

  // 🚀 Arranque Robusto e Inmediato (Supera bloqueos de autoplay de Chromium/Edge)
  const kickstartPlayback = useCallback((playerInstance?: any) => {
    const player = playerInstance || playerRef.current;
    if (!player || !isPlayerReadyRef.current) return;
    if (!isPlayingIntentRef.current && !latestPropsRef.current.playerState.isPlaying) return;

    try {
      player.playVideo?.();
    } catch (e) {}

    // Watchdog de 250ms: si el reproductor sigue en pausa o cued por restricción de autoplay,
    // arrancar silenciado y restaurar el volumen de inmediato
    setTimeout(() => {
      try {
        if (!isPlayingIntentRef.current && !latestPropsRef.current.playerState.isPlaying) return;
        const st = player.getPlayerState?.();
        if (st !== 1 && st !== 3) {
          player.mute?.();
          player.playVideo?.();
          setTimeout(() => {
            try {
              if (!latestPropsRef.current.playerState?.isMuted) {
                player.unMute?.();
                const rawVol = Math.min(100, Math.max(0, Math.round((latestPropsRef.current.playerState.volume / 15) * 100)));
                const duckingVol = AudioEngine.getInstance().getDuckingVolume();
                const effectiveVol = latestPropsRef.current.isDucked ? Math.round(rawVol * (duckingVol / 100)) : rawVol;
                player.setVolume?.(effectiveVol);
              }
            } catch (_) {}
          }, 300);
        }
      } catch (_) {}
    }, 250);
  }, []);

  // Centralized Video Loader - single entry point for all video loading
  const loadVideo = useCallback((videoId: string) => {
    if (!videoId) return;

    // Guard: Si es exactamente el mismo video y ya está cargado
    if (lastVideoIdRef.current === videoId && isPlayerReadyRef.current && playerRef.current) {
      isPlayingIntentRef.current = true;
      kickstartPlayback(playerRef.current);
      return;
    }

    pendingVideoIdRef.current = videoId;
    isPlayingIntentRef.current = true;
    trackSwitchTimeRef.current = Date.now();

    if (!isPlayerReadyRef.current || !playerRef.current) {
      return;
    }

    const player = playerRef.current;
    lastVideoIdRef.current = videoId;

    const desiredQuality = ytSuggestedQuality(latestPropsRef.current.playerState.playbackQuality);

    try {
      if (typeof player.loadVideoById === 'function') {
        try {
          player.loadVideoById({ videoId, startSeconds: 0, suggestedQuality: desiredQuality });
        } catch (_) {
          player.loadVideoById(videoId, 0, desiredQuality);
        }
      }
      enforceUserQuality();
      setLoadError(null);
      currentTimeRef.current = 0;
      lastSecondRef.current = -1;
      latestPropsRef.current.onStateChange({ isPlaying: true, currentTime: 0 });
    } catch (e) {
      try {
        if (typeof player.loadVideoById === 'function') {
          player.loadVideoById(videoId, 0, desiredQuality);
          enforceUserQuality();
          setLoadError(null);
          currentTimeRef.current = 0;
          lastSecondRef.current = -1;
          latestPropsRef.current.onStateChange({ isPlaying: true, currentTime: 0 });
        }
      } catch (err) {
        console.warn('Could not load video:', err);
      }
    }

    kickstartPlayback(player);

    // Watchdog anti-restricción de edad y bloqueo en 0s:
    // Si pasados 3.8s el reproductor no ha arrancado (sigue en 0s y no está sonando),
    // detecta automáticamente que YouTube bloqueó el video por restricción de edad/login y sintoniza la copia limpia.
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
    if (isPlayingIntentRef.current || latestPropsRef.current.playerState.isPlaying) {
      stallWatchdogRef.current = setTimeout(() => {
        const p = playerRef.current;
        if (!p) return;
        try {
          const st = p.getPlayerState?.();
          const curTime = p.getCurrentTime?.() || 0;
          if (st !== 1 && curTime === 0 && (isPlayingIntentRef.current || latestPropsRef.current.playerState.isPlaying)) {
            console.warn('[YouTube Player] 🛡️ Watchdog: Video detenido en 0s (pantalla de restricción de edad de YouTube). Sintonizando alternativa limpia...');
            triggerAlternativeRecoveryRef.current?.('stalled_age_gate');
          }
        } catch (_) {}
      }, 3800);
    }
  }, [enforceUserQuality, kickstartPlayback]);

  // 🛡️ Sintonizador Automático de Versiones en Alta Definición (≥480p) y sin Restricción
  const triggerAlternativeRecovery = useCallback(async (reason: string | number = 'error') => {
    const currentTrack = latestPropsRef.current.track;
    const currentId = currentTrack?.id || lastVideoIdRef.current || '';

    if (currentId) {
      failedVideoIdsRef.current.add(currentId);
    }

    if (isRecoveringRef.current) return;
    isRecoveringRef.current = true;

    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }

    const isLowQuality = reason === 'low_quality';
    const isEmbedOrAgeRestriction =
      reason === 101 || reason === 150 || reason === 153 || reason === 'stalled_age_gate' || reason === 'age_restriction' || reason === 'manual';

    youtubeAuthService.recordPlaybackError(typeof reason === 'number' ? reason : 150, isEmbedOrAgeRestriction);
    const songName = currentTrack?.title ? `"${currentTrack.title}"` : 'la canción';
    const errMsg = isLowQuality
      ? `Calidad menor a 480p detectada. Buscando versión en alta definición (≥480p)...`
      : (isEmbedOrAgeRestriction
        ? `Restricción de edad en YouTube detectada. Sintonizando versión sin restricción...`
        : `Video no disponible. Sintonizando versión alternativa de ${songName}...`);

    setLoadError(errMsg);
    console.warn(`[YouTube Player] 🛡️ Sintonizando alternativa limpia (${reason}) para:`, currentId, songName);

    try {
      if (currentTrack && (currentTrack.title || currentTrack.artist)) {
        // 1. Buscar específicamente una versión alternativa compatible de LA MISMA canción
        const queryParams = new URLSearchParams({
          failedId: currentId,
          title: currentTrack.title || '',
          artist: currentTrack.artist || '',
          excluir: Array.from(failedVideoIdsRef.current).join(','),
          minQuality: '480p'
        });
        const resp = await fetch(`/api/youtube/find-alternative?${queryParams.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.success && data.alternative && data.alternative.id && !failedVideoIdsRef.current.has(data.alternative.id)) {
            const validAlt = data.alternative;
            console.log('[YouTube Player] 🎯 Sintonizando versión en alta resolución (≥480p):', validAlt.id, validAlt.title);
            setLoadError(`Sintonizando versión en alta resolución (≥480p): "${validAlt.title}"`);
            latestPropsRef.current.onStateChange({
              currentTrack: {
                ...validAlt,
                thumbnail: validAlt.thumbnail || `https://i.ytimg.com/vi/${validAlt.id}/hqdefault.jpg`
              },
              isPlaying: true,
              currentTime: 0
            });
            isPlayingIntentRef.current = true;
            loadVideo(validAlt.id);
            setTimeout(() => {
              setLoadError(null);
              isRecoveringRef.current = false;
            }, 3500);
            return;
          }
        }
      }
    } catch (searchErr) {
      console.warn('[YouTube Player] Auto-fallback search failed:', searchErr);
    }

    // Si la causa fue calidad menor a 480p y no se encontró copia de esa resolución para este tema:
    // La directiva estricta es EVITAR reproducir videos inferiores a 480p.
    // Avisar claramente al usuario y saltar de inmediato a la siguiente canción de la lista.
    if (isLowQuality) {
      console.warn('[YouTube Player] ⏭️ No se encontró versión en ≥480p para este tema. Omitiendo y pasando a la siguiente canción.');
      setLoadError(`Esta canción no cuenta con versión de al menos 480p en YouTube. Omitiendo y pasando a la siguiente canción...`);
      setTimeout(() => {
        setLoadError(null);
        isRecoveringRef.current = false;
        if (typeof latestPropsRef.current.onNextTrack === 'function') {
          latestPropsRef.current.onNextTrack();
        }
      }, 1600);
      return;
    }

    // NUNCA saltar a una canción diferente si la canción pedida tiene restricción de edad;
    // mantener la pista seleccionada y mostrar aviso explicativo al usuario sin desviar el tema.
    console.warn('[YouTube Player] No se encontró copia compatible de la misma canción; no se cambia de pista.');
    setLoadError(`Esta canción tiene restricción de edad en YouTube y no cuenta con versión alternativa disponible.`);

    setTimeout(() => {
      setLoadError(null);
      isRecoveringRef.current = false;
    }, 4500);
  }, [loadVideo]);

  triggerAlternativeRecoveryRef.current = triggerAlternativeRecovery;

  // 🎚️ CALIDAD MÍNIMA 480p: se detectan y descartan los videos que no llegan a 480p como mínimo.
  // Se consulta getAvailableQualityLevels(), que devuelve TODAS las calidades codificadas del video.
  // Si ninguna de las opciones disponibles alcanza 480p ('large', 'hd720', 'hd1080', 'highres'),
  // el video tiene resolución máxima de 360p, 240p o 144p -> se descarta inmediatamente,
  // se busca otra versión en alta definición (≥480p), y si no existe, se pasa a la siguiente canción.
  useEffect(() => {
    if (!track?.id) return;
    let cancelado = false;
    let comprobaciones = 0;

    const interval = setInterval(() => {
      if (cancelado) return;
      if (isRecoveringRef.current) return;
      const player = playerRef.current;
      if (!player || !isPlayerReadyRef.current) return;
      if (!isPlayingIntentRef.current && !latestPropsRef.current.playerState.isPlaying) return;

      comprobaciones++;
      let niveles: string[] = [];
      try {
        niveles = player.getAvailableQualityLevels?.() || [];
      } catch (e) {
        return;
      }

      // Si YouTube aún no ha cargado los niveles de calidad del búfer
      if (!niveles || niveles.length === 0) {
        if (comprobaciones >= 10) {
          // Si tras ~3.5s sigue sin lista y está sonando, verificar calidad observada
          try {
            const observada = player.getPlaybackQuality?.();
            if (observada && isQualityBelow480p(observada)) {
              console.warn('[YouTube Player] 📉 Calidad observada < 480p sin opciones HD:', observada);
              cancelado = true;
              clearInterval(interval);
              try { player.pauseVideo?.(); } catch (_) {}
              triggerAlternativeRecovery('low_quality');
            }
          } catch (_) {}
        }
        return;
      }

      // Los niveles ya están disponibles:
      const llegaA480p = hasAtLeast480pOption(niveles);

      if (llegaA480p) {
        // Cumple con el mínimo de 480p. Marcamos completado y detenemos el vigilante.
        cancelado = true;
        clearInterval(interval);
        latestPropsRef.current.onStateChange({
          availableQualities: niveles as VideoQuality[]
        });
        enforceUserQuality(player);
        return;
      }

      // Ninguna calidad disponible alcanza 480p (video exclusivamente de 360p, 240p o 144p)
      // Debe evitarse inmediatamente según la orden del usuario ("evitar videos < 480p como mínimo").
      cancelado = true;
      clearInterval(interval);
      const maxLabel = getHighestQualityLabel(niveles);
      console.warn(`[YouTube Player] 🚫 Descartando video "${track.title}" (${track.id}) por calidad menor a 480p (máx disponible: ${maxLabel}).`);

      try {
        player.pauseVideo?.();
      } catch (_) {}

      triggerAlternativeRecovery('low_quality');
    }, 350);

    return () => {
      cancelado = true;
      clearInterval(interval);
    };
  }, [track?.id, enforceUserQuality, triggerAlternativeRecovery]);

  // Initialize YT.Player once and only once - identity is completely stable (deps: [])
  const initPlayer = useCallback(() => {
    if (!window.YT || !window.YT.Player) return;
    if (playerRef.current && isPlayerReadyRef.current) return;

    const targetElement = document.getElementById('yt-player-iframe');
    if (!targetElement) return;

    // Solo cargar video inicial si hay una canción activa solicitada o restaurada;
    // si no hay canción, el reproductor debe quedar limpio en reposo SIN reproducir nada.
    const initialVideoId = pendingVideoIdRef.current || latestPropsRef.current.track?.id || null;
    lastVideoIdRef.current = initialVideoId;

    // Autoplay solo si el estado actual pide reproducir (por defecto en inicio es false)
    const shouldAutoplay = Boolean(latestPropsRef.current.playerState.isPlaying && initialVideoId);

    const playerConfig: any = {
      ...(initialVideoId ? { videoId: initialVideoId } : {}),
      playerVars: {
        autoplay: shouldAutoplay ? 1 : 0,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        enablejsapi: 1,
        playsinline: 1,
        fs: 1,
        iv_load_policy: 3,
        disablekb: 0,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined
      },
      events: {
        onReady: (event: any) => {
          isPlayerReadyRef.current = true;
          const currentProps = latestPropsRef.current;
          
          // Initial volume setup
          const rawVolume100 = Math.min(100, Math.max(0, Math.round((currentProps.playerState.volume / 15) * 100)));
          const effectiveVol = currentProps.playerState.isMuted
            ? 0
            : currentProps.isDucked
            ? Math.round(rawVolume100 * 0.2)
            : rawVolume100;
          try {
            event.target.setVolume?.(effectiveVol);
          } catch (e) {}

          // Initial playback rate
          if (currentProps.playerState.playbackSpeed && currentProps.playerState.playbackSpeed !== 1.0 && typeof event.target.setPlaybackRate === 'function') {
            try {
              event.target.setPlaybackRate(currentProps.playerState.playbackSpeed);
              lastAppliedSpeedRef.current = currentProps.playerState.playbackSpeed;
            } catch (e) {}
          }

          // Initial quality enforcement
          enforceUserQuality(event.target);

          // Si hay una canción pendiente y el usuario pidió reproducir
          if (pendingVideoIdRef.current) {
            if (currentProps.playerState.isPlaying) {
              loadVideo(pendingVideoIdRef.current);
            } else if (typeof event.target.cueVideoById === 'function') {
              try {
                event.target.cueVideoById(pendingVideoIdRef.current, 0);
              } catch (e) {}
            }
          } else if (!currentProps.playerState.isPlaying) {
            // Sin canción o en reposo: asegurar pausa estricta
            try {
              event.target.pauseVideo?.();
            } catch (e) {}
          }
        },
        onStateChange: (event: any) => {
          // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 video cued
          if (event.data === 1) {
            // Cancelar watchdog de bloqueo/restricción de edad al comenzar a sonar
            if (stallWatchdogRef.current) {
              clearTimeout(stallWatchdogRef.current);
              stallWatchdogRef.current = null;
            }

            // Protección contra reproducción no deseada al iniciar la aplicación:
            // Solo pausar si ni el estado de la app ni la intención del usuario piden reproducir
            if (!isPlayingIntentRef.current && !latestPropsRef.current.playerState.isPlaying) {
              try {
                event.target.pauseVideo?.();
              } catch (e) {}
              latestPropsRef.current.onStateChange({ isPlaying: false });
              return;
            }

            // Actively playing: si se usó kickstart silenciado, restaurar volumen
            if (!latestPropsRef.current.playerState.isMuted) {
              try {
                event.target.unMute?.();
                const rawVol = Math.min(100, Math.max(0, Math.round((latestPropsRef.current.playerState.volume / 15) * 100)));
                event.target.setVolume?.(rawVol);
              } catch (_) {}
            }

            youtubeAuthService.recordPlaybackSuccess();
            isPlayingIntentRef.current = true;
            enforceUserQuality();
            const dur = playerRef.current?.getDuration?.() || 0;
            if (dur > 0) {
              durationRef.current = dur;
            }
            latestPropsRef.current.onStateChange({
              isPlaying: true,
              ...(dur > 0 ? { duration: dur } : {})
            });

            // Sincronizar canción activa si el reproductor nativo cambió de video (ej: clic en "Más vídeos" de YouTube)
            try {
              const vData = event.target.getVideoData?.();
              if (vData && vData.video_id && vData.video_id !== latestPropsRef.current.track?.id) {
                const durVal = playerRef.current?.getDuration?.() || 0;
                const detectedTrack: Track = {
                  id: vData.video_id,
                  title: vData.title || latestPropsRef.current.track?.title || 'Canción',
                  artist: vData.author || latestPropsRef.current.track?.artist || '',
                  thumbnail: `https://i.ytimg.com/vi/${vData.video_id}/hqdefault.jpg`,
                  duration: durVal > 0 ? `${Math.floor(durVal / 60)}:${Math.floor(durVal % 60).toString().padStart(2, '0')}` : '3:45'
                };
                lastVideoIdRef.current = vData.video_id;
                latestPropsRef.current.onTrackSelectedByPlayer?.(detectedTrack);
              }
            } catch (_) {}

            // Sincronizar cola de reproducción desde la playlist/mix nativa del reproductor si está disponible
            try {
              const pl = event.target.getPlaylist?.();
              if (Array.isArray(pl) && pl.length > 1) {
                const curVData = event.target.getVideoData?.();
                const plTracks: Track[] = pl.map((id: string) => ({
                  id,
                  title: id === curVData?.video_id ? (curVData?.title || 'Canción') : 'Canción de la lista',
                  artist: curVData?.author || '',
                  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
                  duration: '3:45'
                }));
                latestPropsRef.current.onQueueReferenceUpdated?.(plTracks);
              }
            } catch (_) {}
          } else if (event.data === 3) {
            // Buffering
            enforceUserQuality();
          } else if (event.data === 5) {
            // Video Cued (cargado en reposo listo para sonar)
            enforceUserQuality();
            // Al cambiar de canción o pedir reproducir, YouTube deja el nuevo video en estado CUED (5).
            // Para que no se quede congelado en pausa, se ordena reproducir de inmediato con kickstart:
            if (isPlayingIntentRef.current || latestPropsRef.current.playerState.isPlaying) {
              kickstartPlayback(event.target);
            }
          } else if (event.data === 2) {
            // Video Paused
            const isSwitching = Date.now() - trackSwitchTimeRef.current < 4500;
            const shouldBePlaying = isPlayingIntentRef.current || latestPropsRef.current.playerState.isPlaying;

            if (isSwitching || shouldBePlaying) {
              // Durante el cambio de canción o al ordenar reproducir:
              // NO notificar pausa a la app ni desactivar la intención: asegurar arranque con kickstart.
              kickstartPlayback(event.target);
            } else {
              // Pausa legítima solicitada por el usuario
              isPlayingIntentRef.current = false;
              latestPropsRef.current.onStateChange({ isPlaying: false });
            }
          } else if (event.data === 0) {
            // Track ended naturally
            latestPropsRef.current.onTrackEnded();
          }
        },
        onPlaybackQualityChange: (event: any) => {
          const observada = String(event.data || '');
          if (observada) {
            latestPropsRef.current.onStateChange({ actualQuality: observada });
            // Si YouTube notifica una calidad inferior a 480p (medium, small, tiny)
            if (isQualityBelow480p(observada)) {
              try {
                const niveles = playerRef.current?.getAvailableQualityLevels?.() || [];
                if (niveles.length > 0 && !hasAtLeast480pOption(niveles)) {
                  console.warn('[YouTube Player] 🚫 Video degradado a resolución < 480p sin niveles HD disponibles:', observada);
                  try { playerRef.current?.pauseVideo?.(); } catch (_) {}
                  triggerAlternativeRecoveryRef.current?.('low_quality');
                }
              } catch (_) {}
            }
          }
        },
        onPlaybackRateChange: (event: any) => {
          const newSpeed = event.data;
          if (typeof newSpeed !== 'number') return;
          lastAppliedSpeedRef.current = newSpeed;
          latestPropsRef.current.onStateChange({ playbackSpeed: newSpeed });
          setSpeedFeedback({
            speed: newSpeed,
            timestamp: Date.now()
          });
          setTimeout(() => {
            setSpeedFeedback(prev => (prev && Date.now() - prev.timestamp >= 2400 ? null : prev));
          }, 2500);
        },
        onError: (e: any) => {
          const errorCode = e.data;
          console.warn('[YouTube Player] Error code encountered:', errorCode);
          triggerAlternativeRecovery(errorCode);
        }
      }
    };

    playerRef.current = new window.YT.Player('yt-player-iframe', playerConfig);
  }, [enforceUserQuality, kickstartPlayback, loadVideo, triggerAlternativeRecovery]);

  // Load YouTube Iframe API once on mount
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      isApiReadyRef.current = true;
      initPlayer();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      isApiReadyRef.current = true;
      initPlayer();
    };

    return () => {
      if (timeUpdateInterval.current) {
        clearInterval(timeUpdateInterval.current);
        timeUpdateInterval.current = null;
      }
    };
  }, [initPlayer]);

  // Controlled, lightweight playback time tracking interval
  // Runs ONLY when playing, pauses automatically on pause, cleans on unmount
  useEffect(() => {
    if (timeUpdateInterval.current) {
      clearInterval(timeUpdateInterval.current);
      timeUpdateInterval.current = null;
    }

    if (!playerState.isPlaying) {
      return;
    }

    timeUpdateInterval.current = setInterval(() => {
      if (playerRef.current && isPlayerReadyRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try {
          const pState = playerRef.current.getPlayerState?.();
          if (pState === 1) { // 1 = playing
            const rawCurrent = playerRef.current.getCurrentTime();
            const sec = Math.floor(rawCurrent);
            if (sec !== lastSecondRef.current) {
              lastSecondRef.current = sec;
              currentTimeRef.current = rawCurrent;
              const dur = playerRef.current.getDuration?.() || durationRef.current;
              durationRef.current = dur;
              latestPropsRef.current.onStateChange({ currentTime: rawCurrent, duration: dur });
            }
          }
        } catch (e) {}
      }
    }, 1000);

    return () => {
      if (timeUpdateInterval.current) {
        clearInterval(timeUpdateInterval.current);
        timeUpdateInterval.current = null;
      }
    };
  }, [playerState.isPlaying]);

  // Single flow for switching tracks when track prop changes
  useEffect(() => {
    if (!track || !track.id) return;

    // AUTOPLAY: la app es la que manda si debe sonar. Si pide reproducir, la intención se
    // activa AQUÍ, antes de cargar nada (antes solo se activaba en el montaje inicial y en
    // algunos caminos, así que al pedir una canción se cargaba pero se quedaba en pausa).
    if (latestPropsRef.current.playerState?.isPlaying) {
      isPlayingIntentRef.current = true;
    }

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      // Al iniciar SerchTube: si playerState.isPlaying es false (restaurado de sesión previa en pausa),
      // NO arrancar la reproducción automáticamente: guardar referencia y no llamar a loadVideo()
      if (!latestPropsRef.current.playerState.isPlaying) {
        pendingVideoIdRef.current = track.id;
        lastVideoIdRef.current = track.id;
        isPlayingIntentRef.current = false;
        return;
      }
    }

    pendingVideoIdRef.current = track.id;
    isPlayingIntentRef.current = true;
    trackSwitchTimeRef.current = Date.now();

    if (isPlayerReadyRef.current && playerRef.current) {
      loadVideo(track.id);
    }
  }, [track?.id, loadVideo]);

  // ── AUTOPLAY REAL (arreglo del "se queda en pausa") ─────────────────────────
  // Chromium/Edge bloquea la reproducción automática CON SONIDO si la página no ha recibido
  // todavía un gesto del usuario: el video queda cargado y en pausa aunque la app pida
  // reproducir (había que darle play a mano). El truco fiable es silenciar, arrancar y
  // devolver el sonido. Se intenta primero el arranque normal y, si sigue en pausa, se usa
  // el truco silenciado.
  useEffect(() => {
    if (!track?.id) return;
    let cancelado = false;

    const intentar = (usarSilencio: boolean) => {
      if (cancelado) return;
      if (!isPlayingIntentRef.current && !latestPropsRef.current.playerState?.isPlaying) return;
      const player = playerRef.current;
      if (!player || !isPlayerReadyRef.current) return;
      let estado = -1;
      try { estado = player.getPlayerState?.() ?? -1; } catch (e) { return; }
      if (estado === 1) return; // ya está sonando
      try {
        if (usarSilencio) {
          player.mute?.();
          player.playVideo?.();
          setTimeout(() => {
            if (cancelado) return;
            try {
              if (!latestPropsRef.current.playerState?.isMuted) {
                player.unMute?.();
              }
            } catch (e2) {}
          }, 600);
        } else {
          player.playVideo?.();
        }
      } catch (e) { }
    };

    const t1 = setTimeout(() => intentar(false), 250);
    const t2 = setTimeout(() => intentar(true), 900);

    return () => { cancelado = true; clearTimeout(t1); clearTimeout(t2); };
  }, [track?.id]);

  // ── Rescate por RESTRICCIÓN DE EDAD o bloqueo SILENCIOSO ────────────────────
  // La tarjeta "Este contenido tiene restricción de edad" que muestra YouTube dentro del
  // marco NO dispara onError: el reproductor simplemente nunca arranca (se queda en
  // "unstarted"/"cued"). Por eso el rescate de onError no se activaba y el marco quedaba
  // bloqueado. Aquí se vigila que el video REALMENTE arranque; si no lo hace, se salta a
  // otra copia del mismo tema (canales "- Topic", subidas de audio, videos con letra),
  // que son las que sí se pueden incrustar. Es general: vale para cualquier canción.
  useEffect(() => {
    if (!track?.id) return;
    let cancelado = false;

    const temporizador = setTimeout(async () => {
      if (cancelado) return;
      if (!isPlayingIntentRef.current) return;
      if (isRecoveringRef.current) return;
      const player = playerRef.current;
      if (!player || !isPlayerReadyRef.current) return;

      let estado = -1;
      try { estado = player.getPlayerState?.() ?? -1; } catch (e) { return; }
      // 1 = reproduciendo, 3 = cargando. Si sigue sin arrancar, está bloqueado por restricción de edad.
      if (estado === 1 || estado === 3) return;

      console.warn('[YouTube Player] 🚫 El video no arrancó (posible restricción de edad). Sintonizando versión limpia...');
      triggerAlternativeRecoveryRef.current?.('stalled_age_gate');
    }, 4500);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [track?.id, loadVideo]);

  // Synchronize Playback Quality ONLY when explicitly changed
  useEffect(() => {
    const targetQuality = playerState.playbackQuality;
    if (!targetQuality) return;

    try {
      localStorage.setItem('serchtube_video_quality', targetQuality);
    } catch (e) {}

    // La preferencia del usuario nunca se sobrescribe con la calidad real observada,
    // asi que aqui solo hay que aplicar de verdad cuando cambia la eleccion.
    const yaEraLaDeseada = desiredQualityRef.current === targetQuality;
    desiredQualityRef.current = targetQuality as VideoQuality;

    if (!playerRef.current || !isPlayerReadyRef.current) return;
    // Misma calidad que ya estaba aplicada: no se recarga el video
    if (yaEraLaDeseada && lastAppliedQualityRef.current === targetQuality) return;

    if (aplicarCalidadReal(targetQuality)) {
      const opt = getQualityOption(targetQuality);
      setQualityFeedback({
        label: opt.label,
        badge: opt.badge || opt.shortLabel,
        timestamp: Date.now()
      });
      setTimeout(() => {
        setQualityFeedback(prev => (prev && Date.now() - prev.timestamp >= 2400 ? null : prev));
      }, 2500);
    }
  }, [playerState.playbackQuality, aplicarCalidadReal]);

  // Synchronize Playback Speed ONLY when explicitly changed
  useEffect(() => {
    const targetSpeed = playerState.playbackSpeed;
    if (typeof targetSpeed !== 'number') return;

    if (targetSpeed !== lastAppliedSpeedRef.current && playerRef.current && isPlayerReadyRef.current) {
      try {
        lastAppliedSpeedRef.current = targetSpeed;
        if (typeof playerRef.current.setPlaybackRate === 'function') {
          playerRef.current.setPlaybackRate(targetSpeed);
        }
      } catch (e) {}
    }
  }, [playerState.playbackSpeed]);

  // Synchronize Play / Pause state without duplicate calls
  useEffect(() => {
    if (!playerRef.current || !isPlayerReadyRef.current) return;
    try {
      const state = playerRef.current.getPlayerState?.();
      if (playerState.isPlaying) {
        isPlayingIntentRef.current = true;
        if (state !== 1 && state !== 3) {
          kickstartPlayback(playerRef.current);
        }
      } else {
        const isSwitching = Date.now() - trackSwitchTimeRef.current < 4500;
        if (!isSwitching) {
          isPlayingIntentRef.current = false;
          if ((state === 1 || state === 3) && typeof playerRef.current.pauseVideo === 'function') {
            playerRef.current.pauseVideo();
          }
        }
      }
    } catch (e) {}
  }, [playerState.isPlaying, kickstartPlayback]);

  // Synchronize Volume and Ducking
  useEffect(() => {
    if (!playerRef.current || !isPlayerReadyRef.current || typeof playerRef.current.setVolume !== 'function') return;
    try {
      if (playerState.isMuted) {
        playerRef.current.mute();
      } else {
        playerRef.current.unMute();
        const rawVolume100 = Math.min(100, Math.max(0, Math.round((playerState.volume / 15) * 100)));
        // El volumen de la atenuacion es configurable (Ajustes > Atenuacion Inteligente):
        // 0% = silencio total mientras habla el asistente, 100% = sin atenuacion.
        const duckingVolume = AudioEngine.getInstance().getDuckingVolume();
        const effectiveVolume = isDucked ? Math.round(rawVolume100 * (duckingVolume / 100)) : rawVolume100;
        playerRef.current.setVolume(effectiveVolume);
      }
    } catch (e) {}
  }, [playerState.volume, playerState.isMuted, isDucked]);

  // Handle seek requests from relative events or direct position
  useEffect(() => {
    const handleSeekRelative = (e: any) => {
      const offset = e.detail?.offset || 0;
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try {
          const curr = playerRef.current.getCurrentTime();
          const target = Math.max(0, curr + offset);
          playerRef.current.seekTo(target, true);
          currentTimeRef.current = target;
          latestPropsRef.current.onStateChange({ currentTime: target });
        } catch (err) {}
      }
    };

    const handleSeekTo = (e: any) => {
      const target = e.detail?.time;
      if (playerRef.current && typeof target === 'number') {
        try {
          playerRef.current.seekTo(target, true);
          currentTimeRef.current = target;
          latestPropsRef.current.onStateChange({ currentTime: target });
        } catch (err) {}
      }
    };

    const handleReloadPlayer = () => {
      const currentId = latestPropsRef.current.track?.id || lastVideoIdRef.current;
      setLoadError(null);
      isRecoveringRef.current = false;
      failedVideoIdsRef.current.clear();
      if (currentId && isPlayerReadyRef.current && playerRef.current) {
        loadVideo(currentId);
      }
    };

    window.addEventListener('serchtube:seek-relative', handleSeekRelative);
    window.addEventListener('serchtube:seek-to', handleSeekTo);
    window.addEventListener('serchtube:reload-player', handleReloadPlayer);
    return () => {
      window.removeEventListener('serchtube:seek-relative', handleSeekRelative);
      window.removeEventListener('serchtube:seek-to', handleSeekTo);
      window.removeEventListener('serchtube:reload-player', handleReloadPlayer);
    };
  }, []);

  // Puente con la extensión de Edge: recibe los videos de "Más vídeos" y cambios de reproducción
  useEffect(() => {
    const handleExtensionMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'yt-autozoom') return;

      // 1. Lista de "Más vídeos" extraída directamente del reproductor nativo
      if (data.type === 'serchtube-more-videos' && Array.isArray(data.items) && data.items.length > 0) {
        latestPropsRef.current.onQueueReferenceUpdated?.(data.items);
      }

      // 2. Notificación de cambio de video dentro de YouTube (ej. clic del usuario en "Más vídeos")
      if (data.type === 'serchtube-video-changed' && data.videoId) {
        if (data.videoId !== latestPropsRef.current.track?.id) {
          const trackFromEvent: Track = {
            id: data.videoId,
            title: data.title || latestPropsRef.current.track?.title || 'Canción',
            artist: data.artist || latestPropsRef.current.track?.artist || '',
            thumbnail: `https://i.ytimg.com/vi/${data.videoId}/hqdefault.jpg`,
            duration: '3:45'
          };
          lastVideoIdRef.current = data.videoId;
          latestPropsRef.current.onTrackSelectedByPlayer?.(trackFromEvent);
        }
      }
    };

    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, []);

  // Keyboard Shortcuts for Media Keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;

      if (e.key === 'AudioVolumeUp' || e.key === 'VolumeUp') {
        e.preventDefault();
        e.stopPropagation();
        const currentVol = latestPropsRef.current.playerState.volume;
        const nextVol = Math.min(15, currentVol + 1);
        latestPropsRef.current.onStateChange({ volume: nextVol, isMuted: false });
      } else if (e.key === 'AudioVolumeDown' || e.key === 'VolumeDown') {
        e.preventDefault();
        e.stopPropagation();
        const currentVol = latestPropsRef.current.playerState.volume;
        const nextVol = Math.max(0, currentVol - 1);
        latestPropsRef.current.onStateChange({ volume: nextVol, isMuted: false });
      } else if (e.key === 'AudioVolumeMute' || e.key === 'VolumeMute') {
        e.preventDefault();
        e.stopPropagation();
        latestPropsRef.current.onStateChange({ isMuted: !latestPropsRef.current.playerState.isMuted });
      } else if (e.key === 'MediaPlayPause') {
        e.preventDefault();
        latestPropsRef.current.onStateChange({ isPlaying: !latestPropsRef.current.playerState.isPlaying });
      } else if (e.key === 'MediaTrackNext') {
        e.preventDefault();
        latestPropsRef.current.onNextTrack?.();
      } else if (e.key === 'MediaTrackPrevious') {
        e.preventDefault();
      } else if (e.key === 'F11') {
        e.preventDefault();
        latestPropsRef.current.onToggleFullscreen?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      id="youtube-player-container"
      className="relative w-full h-full overflow-hidden bg-black flex items-center justify-center select-none pointer-events-auto"
    >
      {/* 1. YouTube Iframe element target - 100% opaque for native GPU hardware acceleration */}
      <div
        id="yt-player-iframe"
        className="w-full h-full pointer-events-auto"
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      {/* 2. Visual Transparency Overlay - replicates exact dark dimming without altering iframe opacity */}
      {opacity < 1.0 && (
        <div
          className="absolute inset-0 z-10 pointer-events-none transition-colors duration-300"
          style={{
            backgroundColor: `rgba(0, 0, 0, ${Math.max(0, 1 - opacity)})`
          }}
        />
      )}

      {/* Floating Quality Change Toast Pill */}
      {qualityFeedback && (
        <div className="absolute top-20 right-6 z-30 flex items-center gap-2 bg-black/90 border border-red-500/50 text-white text-xs px-3.5 py-2 rounded-xl font-mono shadow-2xl animate-fadeIn pointer-events-none">
          <Sparkles size={14} className="text-red-500" />
          <span>Calidad: <strong className="text-red-400">{qualityFeedback.badge || qualityFeedback.label}</strong></span>
        </div>
      )}

      {/* Floating Speed Change Toast Pill */}
      {speedFeedback && (
        <div className="absolute top-28 right-6 z-30 flex items-center gap-2 bg-black/90 border border-blue-500/50 text-white text-xs px-3.5 py-2 rounded-xl font-mono shadow-2xl animate-fadeIn pointer-events-none">
          <Gauge size={14} className="text-blue-400" />
          <span>Velocidad: <strong className="text-blue-300">{speedFeedback.speed}x</strong></span>
        </div>
      )}

      {loadError && (
        <div className="absolute top-4 left-4 z-20 bg-black/90 border border-amber-500/60 text-amber-200 text-xs px-4 py-2.5 rounded-2xl font-mono flex items-center gap-3 shadow-2xl pointer-events-auto animate-fadeIn max-w-[90vw]">
          <span className="truncate">{loadError}</span>
          <button
            type="button"
            onClick={() => triggerAlternativeRecovery('manual')}
            className="px-3 py-1 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-[11px] uppercase transition-all shadow-md active:scale-95 cursor-pointer shrink-0"
            title="Sintonizar de inmediato una versión compatible sin restricción de edad"
          >
            Sintonizar Alternativa
          </button>
        </div>
      )}
    </div>
  );
};

// React.memo with custom comparison: completely skips re-renders on high-frequency currentTime/duration ticks!
export const YouTubePlayer = React.memo<YouTubePlayerProps>(
  YouTubePlayerComponent,
  (prev, next) => {
    return (
      prev.track?.id === next.track?.id &&
      prev.playerState.isPlaying === next.playerState.isPlaying &&
      prev.playerState.volume === next.playerState.volume &&
      prev.playerState.isMuted === next.playerState.isMuted &&
      prev.playerState.playbackQuality === next.playerState.playbackQuality &&
      prev.playerState.playbackSpeed === next.playerState.playbackSpeed &&
      prev.isDucked === next.isDucked &&
      prev.opacity === next.opacity &&
      prev.isFullscreen === next.isFullscreen &&
      prev.systemStatus === next.systemStatus &&
      prev.autoVolumeConfig?.enabled === next.autoVolumeConfig?.enabled &&
      prev.autoVolumeConfig?.targetVolume === next.autoVolumeConfig?.targetVolume &&
      prev.autoVolumeConfig?.delaySeconds === next.autoVolumeConfig?.delaySeconds &&
      prev.autoVolumeConfig?.smoothFade === next.autoVolumeConfig?.smoothFade
    );
  }
);
