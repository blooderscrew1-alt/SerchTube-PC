import { VoicePersonality } from '../types';
import { AudioEngine } from './audioEngine';
import {
  synthesizeNeuralSpeech,
  isNeuralTtsSupported,
  DEFAULT_NEURAL_VOICE,
  NEURAL_VOICES,
  PERSONALITY_TTS_STYLES
} from './neuralTts';

export interface SpeechConfig {
  personality: VoicePersonality;
  voiceURI?: string;
  useEdgeReadAloudVoice?: boolean;
  /** Motor de voz: 'neural' = voces neuronales ultra-realistas de Microsoft (recomendado) */
  ttsEngine?: 'neural' | 'browser';
  /** Voz neuronal seleccionada, ej: 'es-MX-JorgeNeural' */
  neuralVoice?: string;
  /** Voice ID de ElevenLabs seleccionado (prioridad sobre Gemini) */
  elevenVoice?: string;
  /**
   * Orden de prioridad de motores de voz: el asistente intenta hablar con el
   * primero y, si falla o no hay cuota, baja al siguiente. Ej:
   * ['elevenlabs', 'gemini', 'edge'].
   */
  voicePriority?: ('elevenlabs' | 'gemini' | 'edge')[];
  speechRate: number;
  speechPitch: number;
  speechVolume?: number;
  duckingEnabled: boolean;
  /**
   * Voz neuronal EN LINEA de Microsoft Edge (gratis y sin clave), ej:
   * 'es-MX-JorgeNeural'. Se usa cuando el motor elegido es 'edge'.
   */
  edgeVoice?: string;
  /**
   * Volumen de la musica durante la atenuacion, en % (0-100, pasos de 10).
   * 0 = silencio total (predeterminado); 100 = sin atenuacion.
   */
  duckingVolume?: number;
  continuousListening: boolean;
  wakeWordEnabled?: boolean;
  wakeWord?: string;
  satelliteMicOnly?: boolean;
  micFocusBoost?: boolean;
  audioInputDeviceId?: string; // ID del dispositivo de micrófono de entrada seleccionado
  wakeSound?: string;
  postPlaybackCooldownMs?: number;
  /** Activar apertura retrasada del micrófono con cuenta regresiva en el orbe */
  delayedMicActivationEnabled?: boolean;
  /** Segundos personalizados de cuenta regresiva (ej: 1, 2, 3, 4, 5). Predeterminado: 3s */
  delayedMicSeconds?: number;
}

/**
 * Actitud de voz (prosodia) segun la personalidad del asistente, para el motor de
 * Edge: 'excited' acelera y sube el tono, 'calm' lo relaja, 'soft' baja el volumen…
 * (Valores aceptados por el servidor: emphasis, soft, whispering, breathy, excited,
 * angry, sad, embarrassed, calm.)
 */
export const EXPRESION_POR_PERSONALIDAD: Record<string, string> = {
  directa: '',
  animada: 'excited',
  formal: '',
  zen: 'calm',
  conductor: 'excited',
  jarvis: 'calm',
  copiloto_rally: 'excited',
  locutor_fm: 'excited',
  calida: 'soft',
  cyberpunk: 'calm'
};

export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents (música -> musica)
    .replace(/[^\w\s]/gi, "")       // Remove punctuation
    .trim();
}

/**
 * Distancia de Levenshtein simple para tolerancia fonética y typos en palabras clave
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export interface WakeWordParseResult {
  hasWakeWord: boolean;
  commandText: string;
  isWakeWordOnly: boolean;
  matchedKeyword?: string;
}

/**
 * Locales de español que el motor de voz de Microsoft Edge (Azure Speech) reconoce.
 * La lista es la de Azure Speech-to-Text; si se envía un locale que no está aquí,
 * Edge responde "language-not-supported" y el micrófono queda sordo.
 */
export const SUPPORTED_SPANISH_SPEECH_LOCALES = new Set([
  'es-ar', 'es-bo', 'es-cl', 'es-co', 'es-cr', 'es-cu', 'es-do', 'es-ec',
  'es-es', 'es-gq', 'es-gt', 'es-hn', 'es-mx', 'es-ni', 'es-pa', 'es-pe',
  'es-pr', 'es-py', 'es-sv', 'es-us', 'es-uy', 'es-ve'
]);

/**
 * Convierte el idioma del navegador a un locale que el reconocimiento de voz
 * realmente acepte. En Windows en español es habitual que `navigator.language`
 * valga sólo "es" o "es-419"; Edge/Azure no acepta esos valores y falla con
 * "language-not-supported" aunque el micrófono funcione perfectamente.
 */
export function resolveSpeechLanguage(rawLanguage?: string | null): string {
  const raw = String(rawLanguage || '').trim().replace(/_/g, '-');
  if (!raw) return 'es-MX';

  const lower = raw.toLowerCase();
  if (lower === 'es' || lower === 'es-419' || lower === 'es-la' || lower === 'es-005') {
    return 'es-MX';
  }
  if (SUPPORTED_SPANISH_SPEECH_LOCALES.has(lower)) {
    return raw;
  }
  if (lower.startsWith('es-')) {
    // Variante regional no soportada por Edge/Azure: usar la variante mexicana.
    return 'es-MX';
  }
  return raw;
}

/** Elige el mejor locale disponible, priorizando un español con región soportada. */
export function pickSpeechLanguage(): string {
  if (typeof navigator === 'undefined') return 'es-MX';

  const candidates: string[] = [];
  if (navigator.language) candidates.push(navigator.language);
  if (Array.isArray(navigator.languages)) {
    for (const language of navigator.languages) {
      if (language && !candidates.includes(language)) candidates.push(language);
    }
  }

  for (const candidate of candidates) {
    const resolved = resolveSpeechLanguage(candidate);
    if (resolved.toLowerCase().startsWith('es-')) {
      return resolved;
    }
  }

  return candidates.length > 0 ? resolveSpeechLanguage(candidates[0]) : 'es-MX';
}

/** Mensaje entendible para el usuario a partir del código de error de Web Speech. */
export function describeRecognitionError(error: string): string {
  switch (String(error || '').toLowerCase()) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'El navegador bloqueó el micrófono. Revisá el permiso del sitio y que Windows permita acceder al micrófono.';
    case 'audio-capture':
      return 'No hay un micrófono activo. Conectá uno, encendelo y ponelo como dispositivo predeterminado en Windows (Sonido → Entrada).';
    case 'network':
      return 'El servicio de reconocimiento de voz no respondió. Revisá Internet, el firewall/proxy o probá en Chrome/Brave.';
    case 'language-not-supported':
      return 'El idioma de reconocimiento no está disponible en este navegador. Se reintentará con otro dialecto compatible.';
    case 'no-speech':
      return 'No se detectó voz.';
    case 'aborted':
      return 'El reconocimiento se reinició.';
    default:
      return `El reconocimiento de voz falló (${error || 'error desconocido'}).`;
  }
}

/**
 * Variantes fonéticas legítimas de la palabra "música" reportadas por motores de voz
 */
const MUSICA_VARIANTS = new Set([
  'musica', 'música', 'music', 'músic', 'musik', 'musicas', 'músicas',
  'musika', 'muzika', 'mussica', 'muusica', 'musiica', 'musicaa'
]);

/**
 * Palabras comunes del español que suenan vagamente parecido pero NO son la palabra clave.
 * Se bloquean explícitamente para evitar falsos positivos y activación accidental del micrófono.
 */
const NON_WAKEWORD_WORDS = new Set([
  'museo', 'muslo', 'multa', 'mural', 'mundo', 'mudo', 'muda', 'mula',
  'musa', 'musas', 'musgo', 'musico', 'músico', 'músicos', 'musicos',
  'mucho', 'mucha', 'muchos', 'muchas', 'mujer', 'mujeres', 'muestra',
  'muerte', 'muerto', 'mueva', 'mutua', 'mueca', 'fisica', 'basica',
  'clasica', 'mus', 'musi', 'músi', 'misica', 'nusica', 'mujica'
]);

/**
 * ¿La palabra se parece con certeza a "musica" como palabra de activación?
 * Exige longitud adecuada, distancia máxima de 1 cambio y descarta palabras del idioma comunes.
 */
function fuzzyMatchMusica(w: string): boolean {
  if (!w || w.length < 5 || w.length > 8) return false;
  if (NON_WAKEWORD_WORDS.has(w)) return false;
  const dist = levenshteinDistance(w, 'musica');
  return dist <= 1;
}

export function parseWakeWord(transcript: string, wakeWord: string = "música"): WakeWordParseResult {
  const normTranscript = normalizeText(transcript);
  const normWakeWord = normalizeText(wakeWord) || "musica";

  if (!normTranscript) {
    return { hasWakeWord: false, commandText: '', isWakeWordOnly: false };
  }

  // 1. Verificación directa con límites de palabra para la palabra clave configurada
  const boundaryRegex = new RegExp(`(?:^|\\s)${normWakeWord}(?=\\s|$)`);
  const boundaryMatch = normTranscript.match(boundaryRegex);
  let wakeWordIndex = boundaryMatch ? boundaryMatch.index + boundaryMatch[0].indexOf(normWakeWord) : -1;
  let matchedLength = normWakeWord.length;
  let matchedKeyword = normWakeWord;

  // 2. Si la palabra configurada es "música" o similar, cotejar con las variantes fonéticas estrictas
  if (wakeWordIndex === -1 && (normWakeWord === 'musica' || normWakeWord === 'musicas')) {
    const words = normTranscript.split(/\s+/);
    let cumulativeOffset = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wordIdx = normTranscript.indexOf(w, cumulativeOffset);
      cumulativeOffset = wordIdx + w.length;

      // Coincidencia con lista de variantes legítimas (no palabras comunes)
      if (MUSICA_VARIANTS.has(w)) {
        wakeWordIndex = wordIdx;
        matchedLength = w.length;
        matchedKeyword = w;
        break;
      }

      // Tolerancia fonética estricta (distancia <= 1 y nunca palabras en blacklist)
      if (fuzzyMatchMusica(w)) {
        wakeWordIndex = wordIdx;
        matchedLength = w.length;
        matchedKeyword = w;
        break;
      }
    }
  }

  // 3. Soporte para prefijos de invocación habituales y órdenes directas de abrir micrófono
  if (wakeWordIndex === -1) {
    const conversationalPrefixes = [
      'oye musica', 'hey musica', 'hola musica', 'ok musica', 'oye serch', 'serchtube', 'serch',
      'ye musica', 'lle musica', 'oe musica', 'oie musica', 'ey musica', 'ay musica', 'eh musica',
      'ye serch', 'ey serch',
      'abrir microfono', 'abre el microfono', 'abre microfono', 'abrir el microfono',
      'activar microfono', 'activa el microfono', 'activa microfono',
      'abrir micro', 'abre el micro', 'abre micro', 'activa el micro', 'activar micro',
      'encender microfono', 'enciende el microfono', 'enciende microfono',
      'iniciar microfono', 'inicia el microfono', 'inicia microfono',
      'conectar microfono', 'conecta el microfono', 'conecta microfono',
      'escuchar orden', 'escuchar comando', 'escucha orden', 'escucha comando'
    ];
    for (const prefix of conversationalPrefixes) {
      const prefixRegex = new RegExp(`(?:^|\\s)${prefix}(?=\\s|$)`);
      const pMatch = normTranscript.match(prefixRegex);
      if (pMatch) {
        wakeWordIndex = pMatch.index + pMatch[0].indexOf(prefix);
        matchedLength = prefix.length;
        matchedKeyword = prefix;
        break;
      }
    }
  }

  // 4. Órdenes breves directas para abrir micrófono ("microfono", "micro", "escucha", "escuchame", "abrir microfono")
  if (wakeWordIndex === -1) {
    const directMicOrders = [
      /^(?:el\s+)?microfono$/i,
      /^(?:el\s+)?micro$/i,
      /^(?:escucha|escuchame|escuchame\s+serch|escucha\s+serch)$/i,
      /^(?:abre|abrir|activa|activar)$/i
    ];
    for (const regex of directMicOrders) {
      if (regex.test(normTranscript)) {
        return {
          hasWakeWord: true,
          commandText: '',
          isWakeWordOnly: true,
          matchedKeyword: normTranscript
        };
      }
    }
  }

  // NOTA: Cuando la palabra clave está activa, NUNCA activar por verbos sueltos ("pon", "toca", "reproduce")
  // para evitar falsos positivos de conversaciones ambientales ("pon la mesa", "toca la puerta", etc.)
  if (wakeWordIndex === -1) {
    return { hasWakeWord: false, commandText: '', isWakeWordOnly: false };
  }

  // Extraer el texto posterior a la palabra clave
  const afterWakeWord = normTranscript.slice(wakeWordIndex + matchedLength).trim();

  // Limpiar palabras conectoras habituales al dictar una orden ("de", "que", "por favor", etc.)
  let cleanCommand = afterWakeWord
    .replace(/^(de|que|por favor|a ver|y|me|nos)\s+/, '')
    .trim();

  // Si tras la palabra clave el usuario dijo "abre el micrófono", "escuchar", etc., limpiarlo
  if (/^(?:abre|abrir|activa|activar|pon|enciende|conecta|conectar)?\s*(?:el\s+)?(?:microfono|micro)\b/i.test(cleanCommand) || /^(?:escucha|escuchame|atento)$/i.test(cleanCommand)) {
    cleanCommand = cleanCommand.replace(/^(?:abre|abrir|activa|activar|pon|enciende|conecta|conectar)?\s*(?:el\s+)?(?:microfono|micro)\s*/i, '').trim();
  }

  const isWakeWordOnly = cleanCommand.length === 0;

  return {
    hasWakeWord: true,
    commandText: isWakeWordOnly ? '' : cleanCommand,
    isWakeWordOnly,
    matchedKeyword
  };
}

export class SpeechService {
  private static instance: SpeechService | null = null;
  private recognition: any = null;
  private isListening = false;
  private isRecognitionSupported = false;
  private isSynthesizing = false;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private onVoicesChangedCallbacks: Array<(voices: SpeechSynthesisVoice[]) => void> = [];

  // Hardware Audio Stream for AEC (Acoustic Echo Cancellation) & AGC (Auto Gain Control)
  private micStream: MediaStream | null = null;
  private commandCooldownUntil = 0;
  private ttsGuardUntil = 0;
  // ¿Hay una locución del navegador en curso? Se rastrea a mano porque el flag global
  // speechSynthesis.speaking puede quedar atascado (ver isInCooldown).
  private browserUtteranceActive = false;
  private lastSpokenText = '';
  private lastSpokenTimestamp = 0;
  private lastSpeakRequestAt = 0;

  private config: SpeechConfig = {
    personality: 'directa',
    speechRate: 1.0,
    speechPitch: 1.0,
    speechVolume: 1.0,
    duckingEnabled: true,
    duckingVolume: 0,
    edgeVoice: 'es-MX-JorgeNeural',
    continuousListening: true,
    useEdgeReadAloudVoice: true,
    ttsEngine: 'neural',
    neuralVoice: DEFAULT_NEURAL_VOICE,
    voicePriority: ['elevenlabs', 'gemini', 'edge'],
    wakeWordEnabled: true,
    wakeWord: 'música',
    micFocusBoost: true,
    postPlaybackCooldownMs: 4500
  };

  // Reproductor de audio neuronal (MP3) y secuencia para cancelar órdenes obsoletas
  private neuralAudioEl: HTMLAudioElement | null = null;
  private ttsSeq = 0;

  private onTranscriptCallback?: (transcript: string, isFinal: boolean) => void;
  private onStatusChangeCallback?: (status: 'listening' | 'idle' | 'speaking' | 'processing' | 'error') => void;
  private isProcessingCommand = false;
  /** Cola final pendiente dentro de la misma sesión de reconocimiento (une frases cortadas) */
  private finalTail = '';
  /**
   * Micrófono caliente: cuando el asistente acaba de detectar la palabra de activación
   * y espera el comando del usuario, la escucha NO se bloquea aunque el TTS esté hablando
   * (el saludo de bienvenida ya no se come la orden que viene detrás).
   */
  private awaitingCommand = false;
  /**
   * Watchdog de arranque: al encender la PC, Windows/Edge aún no tienen listos los
   * micrófonos cuando la app arranca (el reconocimiento falla con 'audio-capture' en
   * silencio). Se reintenta cada 3 s hasta 100 veces y además se reacciona al evento
   * 'devicechange' cuando los micrófonos por fin aparecen.
   */
  private micRetryTimer: any = null;
  private micRetryAttempts = 0;
  private deviceChangeListenerAttached = false;

  /** Último error real de reconocimiento, para mostrarlo en la interfaz. */
  private lastRecognitionError = '';
  /** Locale con el que se está intentando reconocer. */
  private recognitionLanguage = 'es-MX';
  /** Fallbacks de idioma ya probados (evita bucles infinitos). */
  private languageFallbacksTried = new Set<string>();
  /** Evita varios reinicios simultáneos cuando el navegador corta la sesión. */
  private recognitionRestartTimer: any = null;
  private recognitionErrorStreak = 0;
  /** Errores de permiso/servicio: reintentar solo empeora y tapa el mensaje. */
  private autoRestartBlocked = false;
  /** Evita abrir dos veces getUserMedia mientras se comprueba el micrófono. */
  private micPreflightPromise: Promise<boolean> | null = null;
  /** Entre start() y onstart/onerror/onend no se puede volver a llamar start(). */
  private recognitionStarting = false;
  /** Perfiles alternativos para cuando Edge devuelve "network" con la configuración normal. */
  private compatibilityProfileIndex = -1;
  private compatibilityMode = false;

  private constructor() {
    this.initRecognition();
    this.initVoices();
  }

  private initVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        this.cachedVoices = window.speechSynthesis.getVoices();
        for (const cb of this.onVoicesChangedCallbacks) {
          try {
            cb(this.cachedVoices);
          } catch (_) {}
        }
      };

      this.cachedVoices = window.speechSynthesis.getVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = updateVoices;
      }
    }
  }

  public static getInstance(): SpeechService {
    if (!SpeechService.instance) {
      SpeechService.instance = new SpeechService();
    }
    return SpeechService.instance;
  }

  /**
   * "default" y "communications" son alias del dispositivo predeterminado de
   * Chromium, no IDs físicos. Usar `exact` con ellos falla en muchos equipos.
   */
  private getPhysicalDeviceId(deviceId?: string): string | null {
    const chosen = String(deviceId || this.config.audioInputDeviceId || '').trim();
    if (!chosen || chosen === 'default' || chosen === 'communications') return null;
    return chosen;
  }

  /**
   * Solicita explícitamente permisos de micrófono mediante getUserMedia y libera el track
   * de inmediato para que Web Speech API pueda capturar audio sin colisiones de hardware.
   */
  public async enableMicHardwareFocus(deviceId?: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      const chosenDevice = this.getPhysicalDeviceId(deviceId);
      const audioConstraint = chosenDevice
        ? { deviceId: { exact: chosenDevice } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) {
      console.warn("[SpeechService] Aviso de micrófono:", e);
      return false;
    }
  }

  /**
   * Obtiene la lista completa de dispositivos de captura de audio (micrófonos) conectados.
   */
  public async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (err) {
      console.warn("[SpeechService] Error al enumerar micrófonos:", err);
      return [];
    }
  }

  public releaseMicHardwareFocus() {
    if (this.micStream) {
      try {
        this.micStream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      this.micStream = null;
    }
  }

  /**
   * Establece un periodo de inmunidad/cooldown tras ejecutar una orden (ej: iniciar canción).
   * Durante este periodo se ignoran los audios capturados para evitar que los altavoces disparen órdenes falsas.
   */
  public setCommandCooldown(ms: number = 2500) {
    this.commandCooldownUntil = Date.now() + ms;
    this.resetSession();
  }

  public isInCooldown(): boolean {
    const now = Date.now();
    // OJO: aquí NO se consulta window.speechSynthesis.speaking. Ese flag se queda
    // ATASCADO en true en Chromium (tras un cancel() o una locución que nunca arranca),
    // y como App descartaba el audio antes de buscar la palabra clave, el micrófono
    // quedaba sordo para siempre aunque el vúmetro siguiera moviéndose.
    // Ahora solo se cree en nuestro propio seguimiento.
    const hablando = this.isSynthesizing || this.browserUtteranceActive || now < this.ttsGuardUntil;
    return (now < this.commandCooldownUntil || hablando) && !this.isProcessingCommand;
  }

  /** Motivo por el que ahora mismo se ignorarían los audios (vacío = escuchando) */
  public getBlockReason(): string {
    const now = Date.now();
    if (this.isProcessingCommand) return '';
    if (this.isSynthesizing) return 'sintetizando voz';
    if (this.browserUtteranceActive) return 'voz del navegador sonando';
    if (now < this.ttsGuardUntil) return `inmunidad de eco (${Math.ceil((this.ttsGuardUntil - now) / 1000)}s)`;
    if (now < this.commandCooldownUntil) return `espera post-orden (${((this.commandCooldownUntil - now) / 1000).toFixed(1)}s)`;
    return '';
  }

  private initRecognition() {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      this.isRecognitionSupported = true;
      try {
        this.recognition = new SpeechRecognitionClass();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        // Varias interpretaciones por frase: clave para rescatar la palabra de activación
        // cuando el motor la transcribe mal ("musika", "mujica", "mu sica"...)
        this.recognition.maxAlternatives = 5;

        // Edge usa Azure Speech para Web Speech API. Azure no acepta "es" ni
        // "es-419": hay que enviar siempre una variante regional (es-MX, es-ES...).
        // Si no se normaliza, el motor responde "language-not-supported" y el
        // micrófono queda sordo aunque el permiso y el hardware estén bien.
        this.recognitionLanguage = pickSpeechLanguage();
        this.recognition.lang = this.recognitionLanguage;
        this.languageFallbacksTried.clear();
        this.languageFallbacksTried.add(this.recognitionLanguage.toLowerCase());

        this.recognition.onstart = () => {
          this.recognitionStarting = false;
          this.isListening = true;
          this.finalTail = '';
          this.micRetryAttempts = 0;
          this.recognitionErrorStreak = 0;
          this.lastRecognitionError = '';
          if (this.recognitionRestartTimer) {
            clearTimeout(this.recognitionRestartTimer);
            this.recognitionRestartTimer = null;
          }
          if (this.micRetryTimer) { clearTimeout(this.micRetryTimer); this.micRetryTimer = null; }
          console.log(`[SpeechService] 🎙️ Reconocimiento activo (idioma: ${this.recognitionLanguage})`);
          if (this.config.wakeWordEnabled === false) {
            this.onStatusChangeCallback?.('listening');
          }
        };

        this.recognition.onspeechend = () => {
          // User paused speaking
        };

        this.recognition.onresult = (event: any) => {
          const now = Date.now();

          let interimTranscript = '';
          let finalTranscript = '';
          // Alternativas del motor de reconocimiento (rescatan la palabra clave mal transcrita)
          const alternatives: string[] = [];

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscript += result[0].transcript;
            } else {
              interimTranscript += result[0].transcript;
            }
            // Recoger alternativas en TODO momento (tanto en interim como en final) para rescatar en milisegundos
            for (let j = 1; j < result.length; ++j) {
              if (result[j] && result[j].transcript) alternatives.push(result[j].transcript);
            }
          }

          // Acumular la cola de frases finales dentro de la misma sesión:
          // así "música" (final) + "eminem" (final, tras una pausa) se procesan JUNTOS
          const accumulatedFinal = (this.finalTail + ' ' + finalTranscript).trim();
          if (finalTranscript.trim()) {
            this.finalTail = accumulatedFinal;
          }

          const rawCandidate = (accumulatedFinal || interimTranscript).trim();
          if (!rawCandidate) return;

          let candidate = rawCandidate;

          // ⚡ Rescate ultra-rápido por alternativas en milisegundos:
          // Se evalúa de inmediato tanto en resultados provisionales (interim) como en finales.
          // Si el motor escuchó "música" o la orden de abrir micro en cualquier alternativa secundaria,
          // se adopta en <1ms sin esperar a que la frase se dé por terminada.
          if (this.config.wakeWordEnabled !== false && alternatives.length > 0) {
            const currentWake = this.config.wakeWord || 'música';
            const mainHit = parseWakeWord(candidate, currentWake).hasWakeWord;
            if (!mainHit) {
              for (const alt of alternatives) {
                if (parseWakeWord(alt, currentWake).hasWakeWord) {
                  console.log(`[SpeechService] ⚡ Alternativa instantánea rescatada (<5ms): "${alt}" (principal: "${candidate}")`);
                  candidate = alt.trim();
                  break;
                }
              }
            }
          }

          // ⚡ Evaluación prioritaria de la palabra clave u orden de abrir micrófono:
          const currentWake = this.config.wakeWord || 'música';
          const traePalabraClave = this.config.wakeWordEnabled !== false && parseWakeWord(candidate, currentWake).hasWakeWord;

          // Si el audio trae la palabra clave o la orden de abrir micrófono, NUNCA se bloquea por enfriamiento ni TTS:
          // se interrumpe cualquier locución previa y se responde de inmediato en milisegundos.
          if (traePalabraClave) {
            this.cancelOngoingSpeech();
            this.commandCooldownUntil = 0;
            this.ttsGuardUntil = 0;
          } else {
            // Inmunidad acústica estándar para sonido ambiental sin palabra clave
            const isTtsActive =
              this.isSynthesizing ||
              this.browserUtteranceActive ||
              (this.neuralAudioEl && !this.neuralAudioEl.paused && !this.neuralAudioEl.ended) ||
              (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) ||
              now < this.ttsGuardUntil;

            if (this.isProcessingCommand || (!this.awaitingCommand && (now < this.commandCooldownUntil || isTtsActive))) {
              return;
            }

            // 🛡️ Filtro Semántico Antirruido de Eco:
            const normCandidate = normalizeText(candidate);
            const normLastSpoken = normalizeText(this.lastSpokenText || '');
            const esComandoUsuario = /^(reproduce|pon|toca|escuchar|musica|cancion|siguiente|anterior|pausa|deten|para|reanuda|sube|baja|volumen|busca|abre|abrir|activa|activar)/i.test(normCandidate);

            if (
              !this.awaitingCommand &&
              !esComandoUsuario &&
              this.lastSpokenText &&
              now - this.lastSpokenTimestamp < 4000 &&
              normCandidate.length >= 8 &&
              normLastSpoken &&
              (normCandidate === normLastSpoken || (normLastSpoken.length > 15 && normLastSpoken === normCandidate))
            ) {
              console.log(`[SpeechService] 🔇 Eco exacto de voz del asistente suprimido en micrófono: "${candidate}"`);
              return;
            }
          }

          if (accumulatedFinal.trim()) {
            console.log("[SpeechService] 🎙️ Final:", candidate);
            this.onTranscriptCallback?.(candidate, true);
            this.finalTail = '';
          } else if (interimTranscript.trim()) {
            this.onTranscriptCallback?.(candidate, false);
          }
        };

        this.recognition.onerror = (event: any) => {
          this.recognitionStarting = false;
          const code = String(event?.error || 'unknown');
          this.lastRecognitionError = describeRecognitionError(code);
          console.warn(`[SpeechService] ❌ Error de reconocimiento (${code}): ${this.lastRecognitionError}`);

          // Edge/Azure rechaza locales sin región ("es", "es-419"). Probar
          // automáticamente es-MX y es-ES antes de darse por vencido.
          if (code === 'language-not-supported') {
            if (this.tryLanguageFallback()) {
              return;
            }
          }

          // "network" también puede deberse a una combinación de opciones que
          // esa versión de Edge no acepta (continuous/maxAlternatives/locale).
          // Probar perfiles conservadores antes de mostrar el error final.
          if (code === 'network') {
            if (this.applyCompatibilityFallback()) {
              return;
            }
            this.autoRestartBlocked = true;
            this.isListening = false;
            this.lastRecognitionError =
              'El servicio de voz de este navegador no respondió con ninguna configuración. Probá abrir SerchTube en Chrome o Brave, o actualizá Edge.';
            this.onStatusChangeCallback?.('error');
            return;
          }

          const fatal = code === 'not-allowed' || code === 'service-not-allowed';
          const recoverable = code === 'audio-capture' || code === 'network' || code === 'language-not-supported';

          if (fatal) {
            this.autoRestartBlocked = true;
          }

          if (fatal || recoverable) {
            this.isListening = false;
            this.onStatusChangeCallback?.('error');
          }

          if (recoverable) {
            this.scheduleMicRetry();
          }
        };

        this.recognition.onend = () => {
          this.recognitionStarting = false;
          this.isListening = false;

          // Si el navegador corta la sesión, reabrir con un pequeño retraso.
          // No reiniciar en bucle a 30 ms: eso martilla el servicio de voz y
          // oculta el error real (audio-capture / network / idioma).
          if (this.autoRestartBlocked) {
            this.onStatusChangeCallback?.('error');
            return;
          }
          if (
            (this.config.continuousListening || this.config.wakeWordEnabled === true) &&
            !this.isProcessingCommand &&
            !this.config.satelliteMicOnly
          ) {
            this.scheduleRecognitionRestart();
          } else if (!this.isProcessingCommand) {
            this.onStatusChangeCallback?.('idle');
          }
        };
      } catch (e) {
        console.warn("[SpeechService] Recognition init exception:", e);
      }
    }
  }

  private micPermissionGranted = false;

  public cancelOngoingSpeech() {
    this.isSynthesizing = false;
    this.browserUtteranceActive = false;
    this.ttsGuardUntil = 0;
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}
    if (this.neuralAudioEl) {
      try {
        this.neuralAudioEl.pause();
        this.neuralAudioEl.currentTime = 0;
      } catch (_) {}
    }
  }

  /**
   * Comprueba el micrófono PREDETERMINADO del sistema, que es el único que
   * Web Speech API puede usar. No sirve probar el dispositivo elegido en
   * Ajustes: si el predeterminado de Windows está mal, el reconocimiento falla
   * aunque el vúmetro de la prueba se mueva.
   */
  private async probeDefaultMicrophone(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = stream.getAudioTracks()[0]?.label || 'micrófono predeterminado';
      stream.getTracks().forEach(track => track.stop());
      this.micPermissionGranted = true;
      console.log(`[SpeechService] 🎙️ Micrófono predeterminado disponible: ${label}`);
      return true;
    } catch (err: any) {
      console.warn('[SpeechService] No se pudo abrir el micrófono predeterminado:', err?.name || err, err?.message || '');
      return false;
    }
  }

  /**
   * Explicitly requests microphone hardware permission via getUserMedia.
   * Crucial for browsers which require a user gesture before allowing audio capture.
   */
  public async requestMicPermission(deviceId?: string): Promise<{ granted: boolean; error?: string }> {
    if (this.micPermissionGranted && (!deviceId || deviceId === this.config.audioInputDeviceId)) {
      return { granted: true };
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'API de micrófono no disponible' };
    }
    if (this.micPreflightPromise) {
      const granted = await this.micPreflightPromise;
      return granted
        ? { granted: true }
        : { granted: false, error: 'No se pudo abrir el micrófono' };
    }
    try {
      const chosenDevice = this.getPhysicalDeviceId(deviceId);
      const audioConstraint = chosenDevice
        ? { deviceId: { exact: chosenDevice } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      this.micPermissionGranted = true;
      // Release tracks right away so Web Speech API can acquire the hardware
      stream.getTracks().forEach(t => t.stop());
      return { granted: true };
    } catch (err: any) {
      console.warn("Microphone permission prompt error:", err);
      return { granted: false, error: err?.message || 'Permiso denegado por el usuario o navegador' };
    }
  }

  public getIsSupported(): boolean {
    return this.isRecognitionSupported;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  public setProcessingCommand(processing: boolean) {
    this.isProcessingCommand = processing;
    if (processing) {
      this.resetSession();
    } else {
      if (
        (this.config.continuousListening || this.config.wakeWordEnabled === true) &&
        !this.isListening &&
        !this.config.satelliteMicOnly
      ) {
        setTimeout(() => {
          if (!this.isListening && !this.isProcessingCommand) {
            this.startListening(true);
          }
        }, 200);
      }
    }
  }

  public getIsProcessingCommand(): boolean {
    return this.isProcessingCommand;
  }

  /**
   * Marca que la palabra de activación fue detectada y se espera un comando.
   * Mientras esté activa, el micrófono permanece abierto aunque el saludo del
   * asistente (TTS) siga sonando, de modo que "música ... eminem" con pausa no se pierda.
   */
  public setAwaitingCommand(awaiting: boolean) {
    this.awaitingCommand = awaiting;
  }

  public resetSession() {
    this.finalTail = '';
    this.awaitingCommand = false;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {
        try {
          this.recognition.stop();
        } catch (_) {}
      }
    }
  }

  public updateConfig(newConfig: Partial<SpeechConfig>) {
    this.config = { ...this.config, ...newConfig };
    AudioEngine.getInstance().setDuckingEnabled(this.config.duckingEnabled);
    AudioEngine.getInstance().setDuckingVolume(this.config.duckingVolume ?? 0);

    // La palabra clave también necesita el micrófono abierto. Antes, activar
    // "palabra clave" no arrancaba nada si "escucha continua" estaba apagada,
    // así que decir "música" no hacía absolutamente nada.
    const shouldListen =
      !this.config.satelliteMicOnly &&
      (this.config.continuousListening === true || this.config.wakeWordEnabled === true);

    if (
      newConfig.satelliteMicOnly !== undefined ||
      newConfig.continuousListening !== undefined ||
      newConfig.wakeWordEnabled !== undefined
    ) {
      if (shouldListen) {
        this.startListening();
      } else {
        this.stopListening();
      }
    }
  }

  public getConfig(): SpeechConfig {
    return { ...this.config };
  }

  public setCallbacks(
    onTranscript: (transcript: string, isFinal: boolean) => void,
    onStatusChange: (status: 'listening' | 'idle' | 'speaking' | 'processing' | 'error') => void
  ) {
    this.onTranscriptCallback = onTranscript;
    this.onStatusChangeCallback = onStatusChange;
  }

  public getLastRecognitionError(): string {
    return this.lastRecognitionError;
  }

  public getRecognitionLanguage(): string {
    return this.recognitionLanguage;
  }

  public getRecognitionDiagnostics() {
    return {
      supported: this.isRecognitionSupported,
      browserAvailable: typeof window !== 'undefined' &&
        !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
      listening: this.isListening,
      language: this.recognitionLanguage,
      lastError: this.lastRecognitionError,
      continuousListening: this.config.continuousListening === true,
      wakeWordEnabled: this.config.wakeWordEnabled === true,
      satelliteMicOnly: this.config.satelliteMicOnly === true,
      compatibilityMode: this.compatibilityMode
    };
  }

  /**
   * Algunas versiones de Edge devuelven "network" con la configuración normal
   * (continuous + varias alternativas) aunque el servicio de voz funcione en
   * otras páginas. Probamos perfiles más conservadores antes de rendirnos.
   */
  private applyCompatibilityFallback(): boolean {
    const profiles = [
      { lang: 'es-MX', continuous: false, interimResults: false, maxAlternatives: 1 },
      { lang: 'es-MX', continuous: false, interimResults: true, maxAlternatives: 1 },
      { lang: 'es-ES', continuous: false, interimResults: false, maxAlternatives: 1 },
      { lang: 'en-US', continuous: false, interimResults: false, maxAlternatives: 1 }
    ];

    const next = this.compatibilityProfileIndex + 1;
    if (next >= profiles.length) return false;

    const profile = profiles[next];
    this.compatibilityProfileIndex = next;
    this.compatibilityMode = true;
    this.recognitionLanguage = profile.lang;

    this.recreateRecognition();
    if (!this.recognition) return false;
    this.recognition.lang = profile.lang;
    this.recognition.continuous = profile.continuous;
    this.recognition.interimResults = profile.interimResults;
    this.recognition.maxAlternatives = profile.maxAlternatives;

    this.lastRecognitionError =
      `Reintentando en modo compatible (${profile.lang}, continuo: ${profile.continuous ? 'sí' : 'no'}, alternativas: ${profile.maxAlternatives})...`;
    console.warn(`[SpeechService] 🧪 ${this.lastRecognitionError}`);
    this.scheduleRecognitionRestart(600);
    return true;
  }

  /** Prueba es-MX / es-ES cuando Edge rechaza el locale del navegador. */
  private tryLanguageFallback(): boolean {
    const candidates = this.recognitionLanguage.toLowerCase().startsWith('es')
      ? ['es-MX', 'es-ES']
      : ['en-US'];

    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (this.languageFallbacksTried.has(key)) continue;
      this.languageFallbacksTried.add(key);
      this.recognitionLanguage = candidate;
      if (this.recognition) this.recognition.lang = candidate;
      this.lastRecognitionError = `El idioma no está disponible; reintentando con ${candidate}.`;
      console.warn(`[SpeechService] 🔁 Fallback de idioma: ${candidate}`);
      this.scheduleRecognitionRestart(250);
      return true;
    }
    return false;
  }

  /**
   * Reinicia el reconocimiento con retroceso exponencial. El código anterior
   * lo reiniciaba cada 30 ms, lo que podía dejar el micrófono en un bucle
   * "escuchando" sin capturar nada y ocultar el error real.
   */
  private scheduleRecognitionRestart(customDelayMs?: number) {
    if (this.recognitionRestartTimer || this.autoRestartBlocked) return;
    if (!this.config.continuousListening && this.config.wakeWordEnabled !== true) return;
    if (this.isProcessingCommand || this.config.satelliteMicOnly) return;

    const base = customDelayMs ?? (this.awaitingCommand ? 80 : 300);
    const backoff = Math.min(5000, base * Math.pow(2, Math.min(3, this.recognitionErrorStreak)));
    this.recognitionRestartTimer = setTimeout(() => {
      this.recognitionRestartTimer = null;
      if (!this.config.continuousListening && this.config.wakeWordEnabled !== true) return;
      if (this.isListening || this.isProcessingCommand || this.config.satelliteMicOnly) return;
      this.startListening(true);
    }, backoff);
  }

  /** Recrea el objeto de reconocimiento cuando Chromium lo deja en un estado inválido. */
  private recreateRecognition() {
    try {
      this.recognition?.abort();
    } catch (_) {}
    this.recognition = null;
    this.isListening = false;
    this.initRecognition();
    if (this.recognition) {
      this.recognition.lang = this.recognitionLanguage;
    }
  }

  /**
   * Reintento periódico de arranque del micrófono (para el inicio de Windows,
   * cuando los dispositivos de audio tardan en aparecer).
   */
  private scheduleMicRetry() {
    if (this.micRetryTimer || this.autoRestartBlocked) return;
    this.micRetryAttempts++;
    if (this.micRetryAttempts > 100) {
      console.warn('[SpeechService] ⚠️ Watchdog de micrófono agotado (5 min). Usa devicechange o reinicia la escucha.');
      return;
    }
    this.micRetryTimer = setTimeout(() => {
      this.micRetryTimer = null;
      if (
        (!this.config.continuousListening && this.config.wakeWordEnabled !== true) ||
        this.isListening || this.isProcessingCommand || this.config.satelliteMicOnly
      ) return;
      console.log(`[SpeechService] 🔄 Reintento de micrófono #${this.micRetryAttempts}... (${this.lastRecognitionError || 'sin detalle'})`);
      this.startListening(true);
    }, 3000);
  }

  /**
   * Escucha conexiones/desconexiones de micrófonos: si los dispositivos aparecen
   * tarde (inicio de la PC), la escucha se reactiva sola sin tocar nada.
   */
  private ensureDeviceChangeListener() {
    if (this.deviceChangeListenerAttached) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    this.deviceChangeListenerAttached = true;
    navigator.mediaDevices.addEventListener('devicechange', () => {
      console.log('[SpeechService] 🔌 Cambio en dispositivos de audio detectado');
      this.micPermissionGranted = false;
      if (
        (this.config.continuousListening || this.config.wakeWordEnabled === true) &&
        !this.isListening && !this.isProcessingCommand && !this.config.satelliteMicOnly
      ) {
        this.micRetryAttempts = 0;
        this.startListening();
      }
    });
  }

  public startListening(internal = false) {
    if (this.config.satelliteMicOnly) return;
    if (!internal) {
      this.autoRestartBlocked = false;
      this.micRetryAttempts = 0;
      // Un intento manual vuelve a probar la configuración normal.
      if (this.compatibilityMode) {
        this.compatibilityMode = false;
        this.compatibilityProfileIndex = -1;
        this.recognitionLanguage = pickSpeechLanguage();
        if (this.recognition) {
          this.recognition.lang = this.recognitionLanguage;
          this.recognition.continuous = true;
          this.recognition.interimResults = true;
          this.recognition.maxAlternatives = 5;
        }
      }
    }
    if (this.recognitionRestartTimer) {
      clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = null;
    }
    if (!this.recognition) {
      this.initRecognition();
    }
    if (!this.recognition) {
      this.lastRecognitionError = 'Este navegador no tiene reconocimiento de voz (Web Speech API).';
      this.onStatusChangeCallback?.('error');
      return;
    }
    this.ensureDeviceChangeListener();

    // Antes de arrancar Web Speech, abrir y cerrar el micrófono con
    // getUserMedia. Esto hace dos cosas: concede el permiso (o lo confirma) y
    // comprueba que exista un dispositivo de entrada real. Sin esta comprobación,
    // Edge puede responder "audio-capture" y la app quedaba reintentando en vano.
    if (!this.micPermissionGranted) {
      if (this.micPreflightPromise) return;
      this.micPreflightPromise = this.probeDefaultMicrophone()
        .catch(() => false)
        .finally(() => { this.micPreflightPromise = null; });

      this.micPreflightPromise.then(granted => {
        if (!granted) {
          this.lastRecognitionError = 'No se pudo abrir el micrófono predeterminado de Windows. Elegí un dispositivo de entrada activo como predeterminado en Sonido → Entrada y concedé el permiso al navegador.';
          this.onStatusChangeCallback?.('error');
          this.scheduleMicRetry();
          return;
        }
        this.beginRecognition(internal);
      });
      return;
    }

    this.beginRecognition(internal);
  }

  /** Arranca Web Speech una vez que el micrófono y el permiso están listos. */
  private beginRecognition(internal: boolean) {
    if (!this.recognition) return;

    // No llamar start() dos veces: mientras el navegador está abriendo la
    // sesión, un segundo start() lanza InvalidStateError y la app parecía
    // "trabada" aunque el problema real fuera otro (por ejemplo, network).
    if (this.recognitionStarting || this.isListening) return;

    // Aplicar el locale normalizado también en cada arranque. Si quedó un
    // fallback pendiente, se conserva.
    this.recognition.lang = this.recognitionLanguage;

    try {
      this.config.continuousListening = true;
      this.recognitionStarting = true;
      this.recognition.start();
      if (!internal) this.recognitionErrorStreak = 0;
    } catch (e: any) {
      this.recognitionStarting = false;
      const name = String(e?.name || '');
      console.warn('[SpeechService] No se pudo iniciar el reconocimiento:', name, e?.message || e);
      if (name === 'InvalidStateError' && this.isListening) {
        // Ya estaba escuchando: no hay nada que hacer.
        return;
      }

      this.recognitionErrorStreak++;
      this.lastRecognitionError = name === 'InvalidStateError'
        ? 'El reconocimiento quedó trabado; se está reiniciando.'
        : (e?.message || 'No se pudo iniciar el reconocimiento de voz.');

      if (name === 'InvalidStateError' || this.recognitionErrorStreak >= 2) {
        this.recreateRecognition();
      }
      this.onStatusChangeCallback?.('error');
      this.scheduleRecognitionRestart(500);
      return;
    }

    // Verificación post-arranque: si en 4 s no hay sesión activa, programar reintento
    // (cubre el caso de arranque de la PC donde start() no dispara error visible).
    // También recrea el objeto si Chromium quedó en un estado inválido.
    if (!this.micRetryTimer && this.micRetryAttempts === 0) {
      setTimeout(() => {
        if (this.config.satelliteMicOnly || this.isProcessingCommand) return;
        if (!this.isListening && (this.config.continuousListening || this.config.wakeWordEnabled === true)) {
          console.warn('[SpeechService] ⚠️ El reconocimiento no arrancó en 4 s; recreando el motor.');
          this.recognitionStarting = false;
          this.recognitionErrorStreak++;
          this.lastRecognitionError = this.lastRecognitionError ||
            'El micrófono no arrancó. Revisá que haya un dispositivo de entrada predeterminado en Windows.';
          if (this.recognitionErrorStreak >= 2) {
            this.recreateRecognition();
          }
          this.onStatusChangeCallback?.('error');
          this.scheduleMicRetry();
        }
      }, 4000);
    }
  }

  public stopListening() {
    this.config.continuousListening = false;
    if (this.micRetryTimer) { clearTimeout(this.micRetryTimer); this.micRetryTimer = null; }
    if (this.recognitionRestartTimer) { clearTimeout(this.recognitionRestartTimer); this.recognitionRestartTimer = null; }
    this.releaseMicHardwareFocus();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignored
      }
    }
    this.isListening = false;
    this.recognitionErrorStreak = 0;
    this.onStatusChangeCallback?.('idle');
  }

  /**
   * Sanitiza cualquier texto antes de ser pronunciado por el sintetizador de voz (TTS).
   * REGLA ESTRICTA: NUNCA pronunciar la palabra clave de activación ("música", "musica" o wakeWord configurada)
   * para evitar que el micrófono de la PC escuche la propia voz de los altavoces y reabra la escucha accidentalmente.
   */
  public sanitizeTextForTTS(rawText: string): string {
    if (!rawText) return '';
    const wakeWord = this.config.wakeWord || 'música';
    const normWake = normalizeText(wakeWord);

    let sanitized = rawText;

    // Sustitución estricta e infalible de "música" y todas sus variantes por alternativas naturales y sonoras
    // para asegurar que los altavoces de la PC NUNCA pronuncien la palabra clave y no se abra el micrófono
    sanitized = sanitized.replace(/\b(?:reproduciendo|poniendo)\s+m[uú]sica\b/gi, 'reproduciendo tus canciones');
    sanitized = sanitized.replace(/\b(?:escuchar|oir|o[ií]r)\s+m[uú]sica\b/gi, 'escuchar tus temas');
    sanitized = sanitized.replace(/\bla\s+m[uú]sica\b/gi, 'las canciones');
    sanitized = sanitized.replace(/\bde\s+m[uú]sica\b/gi, 'de canciones');
    sanitized = sanitized.replace(/\btu\s+m[uú]sica\b/gi, 'tus temas');
    sanitized = sanitized.replace(/\bm[uú]sica\s+de\b/gi, 'canciones de');
    sanitized = sanitized.replace(/\bm[uú]sica\b/gi, 'canción');
    sanitized = sanitized.replace(/\bm[uú]sicas\b/gi, 'canciones');
    sanitized = sanitized.replace(/\bm[uú]siquita\b/gi, 'temita');
    sanitized = sanitized.replace(/\bm[uú]sic[oó]n\b/gi, 'temazo');
    sanitized = sanitized.replace(/\bmusic\b/gi, 'audio');
    sanitized = sanitized.replace(/\bmusical(?:es)?\b/gi, 'sonoro');

    // Si la palabra clave configurada es otra distinta (ej: "computadora", "serchtube"), evitar que la pronuncie también
    if (normWake && normWake !== 'musica' && normWake !== 'musicas' && normWake !== 'cancion') {
      const customRegex = new RegExp(`\\b${normWake}\\b`, 'gi');
      sanitized = sanitized.replace(customRegex, 'asistente');
    }

    return sanitized.replace(/\s+/g, ' ').trim();
  }

  /**
   * Multiplicadores de personalidad para velocidad y tono (afectan a ambos motores).
   */
  private getPersonalityMultipliers(): { rate: number; pitch: number } {
    switch (this.config.personality) {
      case 'animada': return { rate: 1.14, pitch: 1.12 };
      case 'formal': return { rate: 0.96, pitch: 0.95 };
      case 'zen': return { rate: 0.82, pitch: 0.88 };
      case 'conductor': return { rate: 1.16, pitch: 1.04 };
      case 'jarvis': return { rate: 1.08, pitch: 0.90 };
      case 'copiloto_rally': return { rate: 1.25, pitch: 1.15 };
      case 'locutor_fm': return { rate: 1.10, pitch: 1.05 };
      case 'calida': return { rate: 0.98, pitch: 1.08 };
      case 'cyberpunk': return { rate: 1.04, pitch: 0.82 };
      case 'directa':
      default: return { rate: 1.12, pitch: 1.0 };
    }
  }

  /** Detiene la reproducción de audio neuronal en curso (nueva orden o cancelación) */
  private stopNeuralPlayback() {
    if (this.neuralAudioEl) {
      try {
        this.neuralAudioEl.pause();
        if (this.neuralAudioEl.src.startsWith('blob:')) {
          URL.revokeObjectURL(this.neuralAudioEl.src);
        }
      } catch (_) {}
      this.neuralAudioEl = null;
    }
  }

  /**
   * Sintetiza y reproduce el texto con una voz neuronal ultra-realista de Microsoft
   * (canal "Leer en voz alta" de Edge). Devuelve false si no se pudo iniciar, para
   * que el llamador haga fallback a las voces del navegador.
   */
  private async speakWithNeural(sanitized: string, engine: 'elevenlabs' | 'gemini' | 'edge', finalRate: number, finalPitch: number, callId: number): Promise<boolean> {
    if (!isNeuralTtsSupported()) return false;
    // ElevenLabs solo si hay voz configurada (con clave guardada); si no, saltar al siguiente motor
    if (engine === 'elevenlabs' && !this.config.elevenVoice) return false;

    const voice = this.config.neuralVoice && NEURAL_VOICES.some(v => v.id === this.config.neuralVoice)
      ? this.config.neuralVoice
      : DEFAULT_NEURAL_VOICE;

    // Estilo de actitud vocal según la personalidad + ajuste fino de velocidad del usuario
    const baseStyle = PERSONALITY_TTS_STYLES[this.config.personality] || PERSONALITY_TTS_STYLES.directa;
    const ratePct = Math.round((finalRate - 1) * 100);
    const style = ratePct !== 0
      ? `${baseStyle} Velocidad de locución: ${ratePct > 0 ? 'un ' + Math.min(45, ratePct) + '% más rápida de lo normal' : 'un ' + Math.min(45, -ratePct) + '% más lenta de lo normal'}.`
      : baseStyle;

    const shouldAbort = () => callId !== this.ttsSeq;

    let blob: Blob;
    try {
      blob = await synthesizeNeuralSpeech(sanitized, engine === 'elevenlabs'
        ? { engine: 'elevenlabs', elvoice: this.config.elevenVoice, speed: finalRate, shouldAbort }
        : engine === 'edge'
          // Voces neuronales EN LINEA de Microsoft Edge: gratis, sin clave ni cuenta.
          // La personalidad del asistente se traduce a una actitud (prosodia).
          ? { engine: 'edge', voice: this.config.edgeVoice || 'es-MX-JorgeNeural', speed: finalRate, expr: EXPRESION_POR_PERSONALIDAD[this.config.personality] || '', shouldAbort }
          : { engine: 'gemini', voice, style, shouldAbort }
      );
    } catch (err) {
      if (!shouldAbort()) {
        console.warn('[SpeechService] Voz neuronal no disponible, usando voz del navegador:', err);
      }
      return false;
    }

    if (shouldAbort()) return true; // Una orden más nueva tomó el control

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        this.isSynthesizing = false;
        this.lastSpokenTimestamp = Date.now();
        this.ttsGuardUntil = Date.now() + 600; // 600ms de margen anti-eco tras locución
        if (this.config.duckingEnabled) {
          AudioEngine.getInstance().stopDucking();
        }
        this.onStatusChangeCallback?.(this.isListening ? 'listening' : 'idle');
        resolve(result);
      };

      // Watchdog generoso: MP3 + onended/onerror de Audio son fiables, esto cubre cuelgues raros
      const watchdog = setTimeout(() => {
        this.stopNeuralPlayback();
        settle(true);
      }, 2000 + sanitized.length * 250);

      try {
        const audio = new Audio(URL.createObjectURL(blob));
        const volumenVoz = Math.max(0.1, Math.min(1.0, this.config.speechVolume ?? 1.0));
        // La voz neuronal se enruta por el ecualizador (es lo unico ecualizable: la
        // musica de YouTube vive en un iframe protegido y no se puede procesar).
        // Si queda enrutada, el volumen se aplica en el grafo y no en el elemento.
        const enrutada = AudioEngine.getInstance().connectMediaElement(audio, volumenVoz);
        audio.volume = enrutada ? 1.0 : volumenVoz;
        this.neuralAudioEl = audio;

        audio.onended = () => {
          if (audio.src) { try { URL.revokeObjectURL(audio.src); } catch (_) {} }
          settle(true);
        };
        audio.onerror = () => {
          console.warn('[SpeechService] Error reproduciendo audio neuronal, cayendo a voz del navegador');
          if (audio.src) { try { URL.revokeObjectURL(audio.src); } catch (_) {} }
          settle(false);
        };

        const played = audio.play();
        if (played && typeof played.catch === 'function') {
          played.catch(() => {
            if (audio.src) { try { URL.revokeObjectURL(audio.src); } catch (_) {} }
            settle(false);
          });
        }
      } catch (err) {
        console.warn('[SpeechService] Excepción al reproducir audio neuronal:', err);
        settle(false);
      }
    });
  }

  /**
   * Text-To-Speech con perfiles de personalidad.
   * Motor por defecto: voces neuronales ultra-realistas de Microsoft (gratuitas),
   * con fallback automático a las voces del navegador (speechSynthesis).
   */
  /**
   * @param engineOverride Si se indica, habla SOLO con ese motor (sin cadena de
   * prioridad ni fallbacks). Útil para el botón "Probar" de cada puesto en Ajustes.
   */
  public async speak(text: string, engineOverride?: 'elevenlabs' | 'gemini' | 'edge'): Promise<void> {
    if (!text) return;

    // Sanitizar texto para que NUNCA mencione la palabra clave (ej: "música")
    const sanitized = this.sanitizeTextForTTS(text);
    if (!sanitized) return;

    // 🛡️ Antirrepetición audible: si el mismo texto se pide dos veces en <4.5s
    // (micro local + nodos satélite que capturan la misma orden), se dice UNA sola vez.
    const nowReq = Date.now();
    if (
      sanitized === this.lastSpokenText &&
      nowReq - this.lastSpeakRequestAt < 4500
    ) {
      console.log(`[SpeechService] 🔇 Respuesta duplicada suprimida (<4.5s): "${sanitized.slice(0, 60)}"`);
      return;
    }
    this.lastSpeakRequestAt = nowReq;

    // Detener cualquier locución anterior (neuronal o del navegador) y tomar el control
    const mySeq = ++this.ttsSeq;
    this.stopNeuralPlayback();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window &&
        (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    // Velocidad y tono finales = ajustes del usuario × personalidad
    const mult = this.getPersonalityMultipliers();
    const finalRate = (this.config.speechRate ?? 1.0) * mult.rate;
    const finalPitch = (this.config.speechPitch ?? 1.0) * mult.pitch;

    // Cadena de motores según el orden de prioridad configurado en Ajustes.
    // Cada motor se intenta en orden; el primero que genere audio habla.
    let chain = engineOverride
      ? [engineOverride]
      : (this.config.voicePriority || []).filter(e => e === 'elevenlabs' || e === 'gemini' || e === 'edge');
    if (chain.length === 0) {
      // Compatibilidad con configuraciones antiguas sin orden de prioridad
      chain = this.config.ttsEngine === 'browser'
        ? ['edge']
        : (this.config.elevenVoice ? ['elevenlabs', 'gemini', 'edge'] : ['gemini', 'edge']);
    }

    // Estado común del ciclo de habla (anti-eco + ducking) antes de sintetizar
    this.isSynthesizing = true;
    this.lastSpokenText = sanitized;
    this.lastSpokenTimestamp = Date.now();
    this.ttsGuardUntil = Date.now() + Math.min(4500, 1200 + sanitized.length * 80); // Mantener inmunidad mientras se sintetiza y habla
    if (this.config.duckingEnabled) {
      AudioEngine.getInstance().startDucking(100);
    }
    this.onStatusChangeCallback?.('speaking');

    try {
      for (const engine of chain) {
        if (mySeq !== this.ttsSeq) return; // Una orden más nueva tomó el control

        if (engine === 'edge') {
          // Primero las voces neuronales EN LINEA de Edge (gratis y sin clave); si el
          // servicio no responde, se cae a las voces locales del navegador.
          const hablo = await this.speakWithNeural(sanitized, 'edge', finalRate, finalPitch, mySeq);
          if (hablo) return;
          return await this.speakWithBrowser(sanitized, finalRate, finalPitch);
        }

        const started = await this.speakWithNeural(sanitized, engine, finalRate, finalPitch, mySeq);
        if (started) return;
      }
    } finally {
      // Si ningún motor de la cadena habló y no hay un intento más nuevo, restaurar ciclo
      if (mySeq === this.ttsSeq && (this.isSynthesizing)) {
        this.isSynthesizing = false;
        if (this.config.duckingEnabled) {
          AudioEngine.getInstance().stopDucking();
        }
      }
    }

    // Última línea de defensa: navegador si la cadena completa falló
    // (salvo en pruebas de un motor concreto, para oír exactamente ese motor)
    if (mySeq === this.ttsSeq && !chain.includes('edge') && !engineOverride) {
      return this.speakWithBrowser(sanitized, finalRate, finalPitch);
    }
  }

  /** TTS clásico con las voces locales del navegador (speechSynthesis) */
  private speakWithBrowser(sanitized: string, finalRate: number, finalPitch: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }

      // Duck audio while speaking
      if (this.config.duckingEnabled) {
        AudioEngine.getInstance().startDucking(100);
      }

      this.isSynthesizing = true;
      this.lastSpokenText = sanitized;
      this.lastSpokenTimestamp = Date.now();
      this.ttsGuardUntil = Date.now() + Math.min(4500, 1200 + sanitized.length * 80); // Keep guard active while speaking
      this.onStatusChangeCallback?.('speaking');

      const utterance = new SpeechSynthesisUtterance(sanitized);

      utterance.rate = Math.max(0.5, Math.min(2.0, finalRate));
      utterance.pitch = Math.max(0.5, Math.min(2.0, finalPitch));
      utterance.volume = Math.max(0.1, Math.min(1.0, this.config.speechVolume ?? 1.0));

      // Choose preferred voice or Edge Natural / Neural voice if available
      // Fetch fresh voices directly from window.speechSynthesis to ensure active object references in Chromium/Edge
      const freshVoices = (typeof window !== 'undefined' && 'speechSynthesis' in window)
        ? window.speechSynthesis.getVoices()
        : [];
      const voices = (freshVoices && freshVoices.length > 0) ? freshVoices : this.getAvailableVoices();
      let matchedVoice: SpeechSynthesisVoice | undefined;

      if (this.config.voiceURI && this.config.voiceURI !== 'auto') {
        const target = this.config.voiceURI.trim().toLowerCase();
        matchedVoice = voices.find(v => v.name === this.config.voiceURI) ||
                       voices.find(v => v.voiceURI === this.config.voiceURI) ||
                       voices.find(v => v.name.toLowerCase() === target) ||
                       voices.find(v => v.voiceURI.toLowerCase() === target);
      }

      if (!matchedVoice) {
        // 1. Highest priority: Microsoft Edge "Leer en voz alta" / Online Natural Spanish voices
        const edgeNaturalSpanish = voices.filter(v =>
          (v.lang.startsWith('es') || /spanish/i.test(v.name)) &&
          (/online.*natural/i.test(v.name) || /microsoft.*natural/i.test(v.name) || /natural/i.test(v.name))
        );

        if (edgeNaturalSpanish.length > 0) {
          // Prefer Raul or Jorge or Alvaro or first
          matchedVoice = edgeNaturalSpanish.find(v => /raul|jorge|alvaro|elvira|paloma|dalia/i.test(v.name)) || edgeNaturalSpanish[0];
        } else {
          // 2. Secondary: Google or neural Spanish voices
          const neuralSpanish = voices.filter(v =>
            (v.lang.startsWith('es') || /spanish/i.test(v.name)) &&
            /neural|natural|google|premium|multilingual/i.test(v.name)
          );
          if (neuralSpanish.length > 0) {
            matchedVoice = neuralSpanish[0];
          } else {
            // 3. Any Spanish voice
            const spanishVoices = voices.filter(v => v.lang.startsWith('es') || /spanish/i.test(v.name));
            if (spanishVoices.length > 0) {
              matchedVoice = spanishVoices[0];
            }
          }
        }
      }

      if (matchedVoice) {
        utterance.voice = matchedVoice;
        utterance.lang = matchedVoice.lang || 'es-ES';
      } else {
        utterance.lang = 'es-ES';
      }

      let hasCompleted = false;
      const finishSpeaking = () => {
        if (hasCompleted) return;
        hasCompleted = true;
        this.isSynthesizing = false;
        this.browserUtteranceActive = false;
        this.lastSpokenTimestamp = Date.now();
        this.ttsGuardUntil = Date.now() + 600; // 600ms acoustic echo decay buffer post-speech
        // Se cancela para CURAR el estado del navegador si se quedó colgado
        try {
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            window.speechSynthesis.cancel();
          }
        } catch (_) {}
        if (this.config.duckingEnabled) {
          AudioEngine.getInstance().stopDucking();
        }
        this.onStatusChangeCallback?.(this.isListening ? 'listening' : 'idle');
        resolve();
      };

      utterance.onend = finishSpeaking;
      utterance.onerror = finishSpeaking;

      // Safety timeout: in case speechSynthesis hangs in browser without firing onend
      setTimeout(finishSpeaking, 4000);

      // Slight delay allows Chromium/Edge's internal audio dispatcher to stabilize after cancel()
      this.browserUtteranceActive = true;
      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn("speechSynthesis.speak error:", err);
          finishSpeaking();
        }
      }, 20);
    });
  }

  public getAvailableVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    const directVoices = window.speechSynthesis.getVoices();
    if (directVoices && directVoices.length > 0) {
      this.cachedVoices = directVoices;
      return directVoices;
    }
    return this.cachedVoices;
  }

  public subscribeVoicesChanged(callback: (voices: SpeechSynthesisVoice[]) => void): () => void {
    this.onVoicesChangedCallbacks.push(callback);
    if (this.cachedVoices.length > 0) {
      try {
        callback(this.cachedVoices);
      } catch (_) {}
    }
    return () => {
      this.onVoicesChangedCallbacks = this.onVoicesChangedCallbacks.filter(cb => cb !== callback);
    };
  }
}
