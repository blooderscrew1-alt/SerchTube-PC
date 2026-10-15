import { EqualizerSettings } from '../types';

export class AudioEngine {
  private static instance: AudioEngine | null = null;
  private audioCtx: AudioContext | null = null;
  private bassFilter: BiquadFilterNode | null = null;
  // Ultima fuente de audio externa enrutada por el ecualizador (voz neuronal)
  private mediaElementSource: MediaElementAudioSourceNode | null = null;
  private midFilter: BiquadFilterNode | null = null;
  private presenceFilter: BiquadFilterNode | null = null;
  private trebleFilter: BiquadFilterNode | null = null;
  private bassBoostFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;

  // Bluetooth keep-alive
  private keepAliveInterval: any = null;
  private isKeepAliveActive = false;

  // Analizador para VU-meter / visualizador espectral
  private analyser: AnalyserNode | null = null;

  // Captura de audio de pestaña (getDisplayMedia) para enrutar la música de YouTube al ecualizador
  private captureStream: MediaStream | null = null;
  private tabStreamSource: MediaStreamAudioSourceNode | null = null;
  private isTabAudioActive = false;
  private tabAudioListeners: Set<(active: boolean) => void> = new Set();

  // Generador de pista/ritmo sintetizado de prueba en tiempo real
  private testGrooveTimer: any = null;
  private isTestGrooveRunning = false;
  private testGrooveStep = 0;
  private testGrooveListeners: Set<(running: boolean) => void> = new Set();

  // Audio Ducking state and watchdog
  private isDucked = false;
  private duckingWatchdogTimer: any = null;
  private originalVolumeBeforeDucking = 100;
  private duckingEnabled = true;
  // Volumen al que baja la musica durante el ducking, en % (0 = silencio total)
  private duckingVolume = 0;
  private onDuckingChangeCallback?: (isDucked: boolean, duckedVolume: number) => void;

  private constructor() {
    // Initialized on first user interaction
  }

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  public init() {
    if (this.audioCtx) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      this.audioCtx = new AudioContextClass();

      // Create Multiband Filters
      // 1. Bass: Lowshelf around 100Hz
      this.bassFilter = this.audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 100;

      // 2. Mid: Peaking around 1000Hz
      this.midFilter = this.audioCtx.createBiquadFilter();
      this.midFilter.type = 'peaking';
      this.midFilter.frequency.value = 1000;
      this.midFilter.Q.value = 1.0;

      // 3. Presence: Peaking around 3500Hz
      this.presenceFilter = this.audioCtx.createBiquadFilter();
      this.presenceFilter.type = 'peaking';
      this.presenceFilter.frequency.value = 3500;
      this.presenceFilter.Q.value = 1.2;

      // 4. Treble: Highshelf around 9000Hz
      this.trebleFilter = this.audioCtx.createBiquadFilter();
      this.trebleFilter.type = 'highshelf';
      this.trebleFilter.frequency.value = 9000;

      // 5. Bass Boost filter (low-frequency punch at 60Hz)
      this.bassBoostFilter = this.audioCtx.createBiquadFilter();
      this.bassBoostFilter.type = 'peaking';
      this.bassBoostFilter.frequency.value = 60;
      this.bassBoostFilter.Q.value = 1.4;
      this.bassBoostFilter.gain.value = 0;

      // 6. Loudness Enhancer Dynamics Compressor
      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-18, this.audioCtx.currentTime);
      this.compressor.knee.setValueAtTime(10, this.audioCtx.currentTime);
      this.compressor.ratio.setValueAtTime(4, this.audioCtx.currentTime);
      this.compressor.attack.setValueAtTime(0.005, this.audioCtx.currentTime);
      this.compressor.release.setValueAtTime(0.08, this.audioCtx.currentTime);

      // 7. Master Gain
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

      // 8. Analyser Node for visual VU-meter / frequency inspection
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      // Chain connections
      this.bassFilter
        .connect(this.midFilter)
        .connect(this.presenceFilter)
        .connect(this.trebleFilter)
        .connect(this.bassBoostFilter)
        .connect(this.compressor)
        .connect(this.masterGain)
        .connect(this.analyser)
        .connect(this.audioCtx.destination);
    } catch (e) {
      console.warn("Web Audio API init error:", e);
    }
  }

  public resume() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  // Update EQ bands and DSP
  public applySettings(settings: EqualizerSettings) {
    this.init();
    if (!this.audioCtx) return;
    this.resume();

    const isEqEnabled = settings.enabled !== false;

    if (!isEqEnabled) {
      // MODO BYPASS: Ecualizador desactivado (curva plana a 0 dB y sin compresión)
      if (this.bassFilter) this.bassFilter.gain.value = 0;
      if (this.midFilter) this.midFilter.gain.value = 0;
      if (this.presenceFilter) this.presenceFilter.gain.value = 0;
      if (this.trebleFilter) this.trebleFilter.gain.value = 0;
      if (this.bassBoostFilter) this.bassBoostFilter.gain.value = 0;

      if (this.compressor) {
        this.compressor.threshold.setValueAtTime(0, this.audioCtx.currentTime);
        this.compressor.ratio.setValueAtTime(1, this.audioCtx.currentTime);
      }
    } else {
      // MODO ACTIVO: Aplicar bandas y mejoras DSP
      if (this.bassFilter) this.bassFilter.gain.value = settings.bass;
      if (this.midFilter) this.midFilter.gain.value = settings.mid;
      if (this.presenceFilter) this.presenceFilter.gain.value = settings.presence;
      if (this.trebleFilter) this.trebleFilter.gain.value = settings.treble;

      if (this.bassBoostFilter) {
        this.bassBoostFilter.gain.value = settings.bassBoost ? (settings.bassBoostLevel / 100) * 9 : 0;
      }

      if (this.compressor) {
        // Toggle compression / loudness
        if (settings.loudnessEnhancer) {
          this.compressor.threshold.setValueAtTime(-24, this.audioCtx.currentTime);
          this.compressor.ratio.setValueAtTime(6, this.audioCtx.currentTime);
        } else {
          this.compressor.threshold.setValueAtTime(0, this.audioCtx.currentTime);
          this.compressor.ratio.setValueAtTime(1, this.audioCtx.currentTime);
        }
      }
    }

    // Bluetooth Keep-Alive
    if (settings.bluetoothKeepAlive) {
      this.startBluetoothKeepAlive(settings.keepAliveIntervalSeconds || 20);
    } else {
      this.stopBluetoothKeepAlive();
    }
  }

  // Bluetooth Keep-Alive: inaudible ultrasonic/infrasonic pulse to keep Bluetooth DACs awake
  public startBluetoothKeepAlive(intervalSeconds: number = 20) {
    if (this.isKeepAliveActive) return;
    this.isKeepAliveActive = true;

    this.keepAliveInterval = setInterval(() => {
      this.playInaudibleTone();
    }, intervalSeconds * 1000);
  }

  public stopBluetoothKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.isKeepAliveActive = false;
  }

  private playInaudibleTone() {
    try {
      this.init();
      if (!this.audioCtx) return;
      this.resume();

      // 19Hz tone at -60dB (imperceptible to human ear, but provides digital audio buffer stream)
      const osc = this.audioCtx.createOscillator();
      const toneGain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(19, this.audioCtx.currentTime); // Infrasonic

      toneGain.gain.setValueAtTime(0.001, this.audioCtx.currentTime); // Very low gain (-60dB)
      toneGain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.3);

      osc.connect(toneGain);
      toneGain.connect(this.audioCtx.destination);

      osc.start(this.audioCtx.currentTime);
      osc.stop(this.audioCtx.currentTime + 0.35);
    } catch (e) {
      // Ignored
    }
  }

  // Audio Ducking with Anti-Lock Watchdog
  public setDuckingCallback(callback: (isDucked: boolean, duckedVolume: number) => void) {
    this.onDuckingChangeCallback = callback;
  }

  public setDuckingEnabled(enabled: boolean) {
    this.duckingEnabled = enabled;
  }

  /**
   * Volumen de la musica durante el ducking, en % (0-100 en pasos de 10).
   * 0 = silencio total (predeterminado); 100 = sin atenuacion.
   */
  public setDuckingVolume(volume: number) {
    const numero = Number(volume);
    const paso = isNaN(numero) ? 0 : Math.round(numero / 10) * 10;
    this.duckingVolume = Math.min(100, Math.max(0, paso));
  }

  public getDuckingVolume(): number {
    return this.duckingVolume;
  }

  public startDucking(currentVolume: number) {
    if (!this.duckingEnabled) return;
    if (this.isDucked) return;

    this.isDucked = true;
    this.originalVolumeBeforeDucking = currentVolume;

    // El volumen lo elige el usuario en Ajustes > Atenuacion Inteligente (por
    // defecto 0% = silencio total: el microfono de la PC llega a confundir palabras
    // de la musica con comandos). Se restaura al terminar de hablar.
    const duckedVol = this.duckingVolume;
    this.onDuckingChangeCallback?.(true, duckedVol);

    // Watchdog: Clear ducking after 7 seconds unconditionally in case speech recognition hangs
    if (this.duckingWatchdogTimer) clearTimeout(this.duckingWatchdogTimer);
    this.duckingWatchdogTimer = setTimeout(() => {
      this.stopDucking();
    }, 7000);
  }

  public stopDucking() {
    if (!this.isDucked) return;
    this.isDucked = false;

    if (this.duckingWatchdogTimer) {
      clearTimeout(this.duckingWatchdogTimer);
      this.duckingWatchdogTimer = null;
    }

    this.onDuckingChangeCallback?.(false, this.originalVolumeBeforeDucking);
  }

  /**
   * Enruta un elemento de audio externo (la voz neuronal del asistente) por el
   * ecualizador. Devuelve true si quedo enrutado; false = reproducirlo normal.
   */
  public connectMediaElement(el: HTMLMediaElement, volume = 1): boolean {
    try {
      this.init();
      if (!this.audioCtx || !this.bassFilter) return false;
      // Con el contexto suspendido el grafo no suena: mejor dejarlo directo.
      if (this.audioCtx.state !== 'running') {
        this.resume();
        return false;
      }

      if (this.mediaElementSource) {
        try { this.mediaElementSource.disconnect(); } catch (_) {}
        this.mediaElementSource = null;
      }

      const source = this.audioCtx.createMediaElementSource(el);
      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), this.audioCtx.currentTime);
      source.connect(gain).connect(this.bassFilter);
      this.mediaElementSource = source;
      return true;
    } catch (e) {
      console.warn('AudioEngine connectMediaElement:', e);
      return false;
    }
  }

  // ============================================================================
  // ENRUTAMIENTO DE AUDIO DE PESTAÑA (YOUTUBE A ECUALIZADOR WEB AUDIO)
  // ============================================================================

  public isTabAudioConnected(): boolean {
    return this.isTabAudioActive && this.captureStream !== null && this.captureStream.active;
  }

  public onTabAudioStateChange(callback: (active: boolean) => void): () => void {
    this.tabAudioListeners.add(callback);
    return () => {
      this.tabAudioListeners.delete(callback);
    };
  }

  private notifyTabAudioChange(active: boolean) {
    this.tabAudioListeners.forEach(cb => {
      try { cb(active); } catch (_) {}
    });
  }

  /**
   * Conecta el audio de la pestaña de SerchTube (incluyendo el reproductor de YouTube)
   * directamente al ecualizador Web Audio utilizando la API de captura de pantalla/pestaña
   * de Chromium con suppressLocalAudioPlayback: true.
   */
  public async startTabAudioCapture(): Promise<{ success: boolean; error?: string }> {
    try {
      this.init();
      if (!this.audioCtx || !this.bassFilter) {
        return { success: false, error: 'El subsistema Web Audio no está disponible en este navegador.' };
      }
      this.resume();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        return { success: false, error: 'Este navegador no soporta la función de captura de pestaña/pantalla.' };
      }

      // Detener captura previa si estuviera en marcha
      this.stopTabAudioCapture();

      // Solicitar captura con silenciamiento de la reproducción local de Chromium
      // para que el iframe de YouTube no duplique audio y pase 100% por el ecualizador
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          suppressLocalAudioPlayback: true,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as any,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        systemAudio: 'include',
      } as any);

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        return {
          success: false,
          error: 'No se detectó la señal de audio. Al seleccionar la pestaña, recuerda activar la casilla "Compartir audio".'
        };
      }

      // Pausar y desactivar pistas de vídeo para no consumir memoria ni CPU gráfica
      stream.getVideoTracks().forEach(track => {
        track.enabled = false;
      });

      this.captureStream = stream;
      this.tabStreamSource = this.audioCtx.createMediaStreamSource(stream);
      this.tabStreamSource.connect(this.bassFilter);
      this.isTabAudioActive = true;

      const handleEnded = () => {
        this.stopTabAudioCapture();
      };

      audioTracks[0].onended = handleEnded;
      if (stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].onended = handleEnded;
      }

      this.notifyTabAudioChange(true);
      return { success: true };
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        return { success: false, error: 'Permiso cancelado. Para conectar el audio debes seleccionar la pestaña y marcar "Compartir audio".' };
      }
      return { success: false, error: e?.message || 'No se pudo conectar el audio de la pestaña.' };
    }
  }

  public stopTabAudioCapture() {
    if (this.tabStreamSource) {
      try { this.tabStreamSource.disconnect(); } catch (_) {}
      this.tabStreamSource = null;
    }
    if (this.captureStream) {
      try {
        this.captureStream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      this.captureStream = null;
    }
    const wasActive = this.isTabAudioActive;
    this.isTabAudioActive = false;
    if (wasActive) {
      this.notifyTabAudioChange(false);
    }
  }

  // ============================================================================
  // PISTA / RITMO SINTETIZADO DE PRUEBA EN TIEMPO REAL
  // Permite escuchar y verificar instantáneamente el efecto de cada banda y preset
  // ============================================================================

  public isTestGrooveActive(): boolean {
    return this.isTestGrooveRunning;
  }

  public onTestGrooveStateChange(callback: (running: boolean) => void): () => void {
    this.testGrooveListeners.add(callback);
    return () => {
      this.testGrooveListeners.delete(callback);
    };
  }

  private notifyTestGrooveChange(running: boolean) {
    this.testGrooveListeners.forEach(cb => {
      try { cb(running); } catch (_) {}
    });
  }

  public startTestGroove() {
    this.init();
    if (!this.audioCtx || !this.bassFilter) return;
    this.resume();

    if (this.isTestGrooveRunning) return;
    this.isTestGrooveRunning = true;
    this.testGrooveStep = 0;
    this.notifyTestGrooveChange(true);

    const stepIntervalMs = 230; // ~130 BPM semicorcheas/corcheas
    const tick = () => {
      if (!this.isTestGrooveRunning || !this.audioCtx) return;
      this.playGrooveStep(this.testGrooveStep);
      this.testGrooveStep = (this.testGrooveStep + 1) % 16;
      this.testGrooveTimer = setTimeout(tick, stepIntervalMs);
    };
    tick();
  }

  public stopTestGroove() {
    if (this.testGrooveTimer) {
      clearTimeout(this.testGrooveTimer);
      this.testGrooveTimer = null;
    }
    this.isTestGrooveRunning = false;
    this.notifyTestGrooveChange(false);
  }

  public toggleTestGroove(): boolean {
    if (this.isTestGrooveRunning) {
      this.stopTestGroove();
      return false;
    } else {
      this.startTestGroove();
      return true;
    }
  }

  private playGrooveStep(step: number) {
    if (!this.audioCtx || !this.bassFilter) return;
    const now = this.audioCtx.currentTime;

    // 1. Kick con sub-graves profundos (golpea en pasos 0, 4, 8, 12 y síncopa en 14)
    // Permite comprobar inmediatamente el impacto del deslizador de Graves (100Hz) y Bass Boost (60Hz)
    if (step === 0 || step === 4 || step === 8 || step === 12 || step === 14) {
      const kickOsc = this.audioCtx.createOscillator();
      const kickGain = this.audioCtx.createGain();

      kickOsc.type = 'sine';
      kickOsc.frequency.setValueAtTime(120, now);
      kickOsc.frequency.exponentialRampToValueAtTime(45, now + 0.15);

      kickGain.gain.setValueAtTime(0.45, now);
      kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      kickOsc.connect(kickGain);
      kickGain.connect(this.bassFilter);

      kickOsc.start(now);
      kickOsc.stop(now + 0.24);
    }

    // 2. Caja / Clap en medios (golpea en pasos 4 y 12)
    // Permite comprobar los deslizadores de Medios (1kHz) y Presencia (3.5kHz)
    if (step === 4 || step === 12) {
      const snareOsc = this.audioCtx.createOscillator();
      const snareGain = this.audioCtx.createGain();

      snareOsc.type = 'triangle';
      snareOsc.frequency.setValueAtTime(240, now);
      snareOsc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

      snareGain.gain.setValueAtTime(0.25, now);
      snareGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      snareOsc.connect(snareGain);
      snareGain.connect(this.bassFilter);

      snareOsc.start(now);
      snareOsc.stop(now + 0.13);
    }

    // 3. Hi-Hat brillante en agudos (golpea en pasos pares)
    // Permite comprobar de inmediato el deslizador de Agudos (9kHz)
    if (step % 2 === 0) {
      const hatOsc = this.audioCtx.createOscillator();
      const hatGain = this.audioCtx.createGain();

      hatOsc.type = 'sawtooth';
      hatOsc.frequency.setValueAtTime(step % 4 === 2 ? 9500 : 8500, now);

      hatGain.gain.setValueAtTime(0.09, now);
      hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      hatOsc.connect(hatGain);
      hatGain.connect(this.bassFilter);

      hatOsc.start(now);
      hatOsc.stop(now + 0.05);
    }

    // 4. Nota armónica melódica (acorde suave en pasos 0, 3, 6, 8, 11)
    // Demuestra claridad tonal y efectos de presencia vocal
    if (step === 0 || step === 3 || step === 6 || step === 8 || step === 11) {
      const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
      const noteFreq = notes[step % notes.length];
      const melOsc = this.audioCtx.createOscillator();
      const melGain = this.audioCtx.createGain();

      melOsc.type = 'sine';
      melOsc.frequency.setValueAtTime(noteFreq, now);

      melGain.gain.setValueAtTime(0.12, now);
      melGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      melOsc.connect(melGain);
      melGain.connect(this.bassFilter);

      melOsc.start(now);
      melOsc.stop(now + 0.19);
    }
  }

  /**
   * Emits a crisp, pleasant audio beep (e.g. for volume confirmation without interrupting TTS voice)
   */
  public playBeep(type: 'up' | 'down' | 'neutral' = 'neutral') {
    try {
      this.init();
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      let startFreq = 700;
      let endFreq = 700;

      if (type === 'up') {
        startFreq = 560;
        endFreq = 840;
      } else if (type === 'down') {
        startFreq = 760;
        endFreq = 480;
      }

      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, now);
      if (startFreq !== endFreq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.08);
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

      osc.connect(gain);
      // Los avisos pasan por el ecualizador (antes iban directo a la salida y por eso
      // el ecualizador no tenia ningun efecto audible).
      gain.connect(this.bassFilter ? this.bassFilter : this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.11);
    } catch (e) {
      console.warn("AudioEngine playBeep error:", e);
    }
  }

  // 🔔 Sonidos de notificación al activar el micrófono con la palabra clave
  // (sustituyen a los saludos hablados por TTS). MP3 ubicados en /public (carpeta main del proyecto).
  private wakeSoundElements: HTMLAudioElement[] | null = null;

  private getWakeSounds(): HTMLAudioElement[] {
    if (!this.wakeSoundElements) {
      const sources = ['/wake-sub-bass.mp3', '/wake-notification.mp3'];
      this.wakeSoundElements = sources.map(src => {
        const el = new Audio(src);
        el.preload = 'auto';
        return el;
      });
    }
    return this.wakeSoundElements;
  }

  /**
   * Reproduce un sonido corto estilo notificación (sub bass o ringtone SMS)
   * en lugar de decir una frase de saludo al detectar la palabra clave.
   */
  public playWakeSound(preference: string = 'random') {
    try {
      if (preference === 'none') return;
      if (preference === 'sub_bass') {
        const sounds = this.getWakeSounds();
        if (sounds[0]) {
          sounds[0].currentTime = 0;
          sounds[0].play().catch(() => this.resume());
        }
        return;
      }
      if (preference === 'notification') {
        const sounds = this.getWakeSounds();
        if (sounds[1]) {
          sounds[1].currentTime = 0;
          sounds[1].play().catch(() => this.resume());
        }
        return;
      }
      if (preference === 'cyberpunk' || preference === 'sonar' || preference === 'chime' || preference === 'futuristic') {
        this.playSynthesizedWakeSound(preference);
        return;
      }
      // 'random' or default
      const allOptions = ['sub_bass', 'notification', 'cyberpunk', 'sonar', 'chime', 'futuristic'];
      const chosen = allOptions[Math.floor(Math.random() * allOptions.length)];
      if (chosen === 'sub_bass') {
        const sounds = this.getWakeSounds();
        if (sounds[0]) { sounds[0].currentTime = 0; sounds[0].play().catch(() => this.resume()); }
      } else if (chosen === 'notification') {
        const sounds = this.getWakeSounds();
        if (sounds[1]) { sounds[1].currentTime = 0; sounds[1].play().catch(() => this.resume()); }
      } else {
        this.playSynthesizedWakeSound(chosen);
      }
    } catch (e) {
      console.warn("AudioEngine playWakeSound error:", e);
    }
  }

  private playSynthesizedWakeSound(type: string) {
    try {
      this.init();
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      if (type === 'cyberpunk') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'sonar') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.3);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.38);
      } else if (type === 'chime') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.1);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.42);
      } else {
        // futuristic
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.2);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.28);
      }

      osc.connect(gain);
      gain.connect(this.bassFilter ? this.bassFilter : this.audioCtx.destination);
    } catch (e) {
      console.warn("playSynthesizedWakeSound error:", e);
    }
  }
}

export interface EqPresetConfig {
  bass: number;
  mid: number;
  presence: number;
  treble: number;
  bassBoost?: boolean;
  bassBoostLevel?: number;
  loudnessEnhancer?: boolean;
}

export const PRESET_EQUALIZERS: Record<string, EqPresetConfig> = {
  'Hi-Fi': { bass: 0, mid: 0, presence: 0, treble: 0, bassBoost: false, bassBoostLevel: 50, loudnessEnhancer: false },
  'Bass Boost': { bass: 9, mid: 1, presence: -1, treble: 2, bassBoost: true, bassBoostLevel: 85, loudnessEnhancer: true },
  'Rock': { bass: 7, mid: -2, presence: 5, treble: 7, bassBoost: true, bassBoostLevel: 65, loudnessEnhancer: true },
  'Pop': { bass: 5, mid: 3, presence: 4, treble: 6, bassBoost: false, bassBoostLevel: 50, loudnessEnhancer: true },
  'Cine': { bass: 8, mid: 1, presence: 3, treble: 8, bassBoost: true, bassBoostLevel: 80, loudnessEnhancer: true },
  'Vocal': { bass: -3, mid: 7, presence: 6, treble: 2, bassBoost: false, bassBoostLevel: 30, loudnessEnhancer: false },
  'Conducción Nocturna': { bass: 6, mid: 2, presence: 2, treble: 3, bassBoost: true, bassBoostLevel: 60, loudnessEnhancer: true },
  'Zen / Relax': { bass: 4, mid: -1, presence: -2, treble: -1, bassBoost: false, bassBoostLevel: 40, loudnessEnhancer: false }
};
