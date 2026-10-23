import { resolveMusicalContext, isTrackGenreCoherent, type MusicalContext } from './musicContextEngine.ts';
import {
  analizarPeticionVoz,
  generarVariantesConsulta,
  bonificacionContexto,
  normalizarBase,
  similitudFonetica,
  claveFonetica,
  claveFoneticaFrase,
  type PeticionVoz,
  type ContextoPuntuacion
} from './voiceQueryEngine.ts';

// =========================================================================
// YOUTUBE SEARCH & CONTINUOUS PLAYLIST ENGINE (SERCHTUBE MUSIC)
// Precision search, exact-match ranking, YouTube Mix generation & auto-queue
// =========================================================================

export interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
}

export interface MusicSearchResult {
  source: string;
  firstTrack: CatalogTrack;
  items: CatalogTrack[];
}

export const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Analiza localmente el comando de voz o texto del usuario,
 * optimizando la consulta de búsqueda y detectando si busca un artista completo o una canción específica.
 */
export async function smartAnalyzeQueryWithGemini(rawPrompt: string): Promise<{
  cleanedQuery: string;
  isArtistOnly: boolean;
}> {
  const cleaned = cleanSearchQuery(rawPrompt);
  const norm = normalizeText(rawPrompt);

  const isArtistKeyword =
    /^(?:discografia|discografía|exitos|éxitos|grandes exitos|grandes éxitos|lo mejor|mejores canciones|canciones|musica|música)\s+(?:de\s+)?/i.test(norm) ||
    /^(?:musica|música|escuchar|pon|ponme)\s+de\s+/i.test(norm);

  return {
    cleanedQuery: cleaned,
    isArtistOnly: isArtistKeyword
  };
}

const STOP_WORDS = new Set([
  "de", "el", "la", "los", "las", "un", "una", "unos", "unas", "del", "al", "en", "con", "por", "para", "y", "o", "a",
  "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by",
  "cancion", "canción", "tema", "rola", "video", "audio", "disco", "musica", "música", "letra", "lyrics"
]);

/**
 * Normaliza un texto eliminando tildes, caracteres especiales y puntuación
 */
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Limpia stopwords y prefijos de órdenes de voz
 */
export function cleanSearchQuery(raw: string): string {
  if (!raw || typeof raw !== "string") return "";

  let text = raw.trim();

  // Elimina saludos o palabras de activación
  text = text.replace(/^(?:oye\s+serch|serch|asistente|por\s+favor)\s*,?\s*/i, "");
  text = text.replace(/^(?:música|musica)\s*,?\s*/i, "");

  // Elimina comillas
  text = text.replace(/^["'«“]|["'»”]$/g, "").trim();

  // Elimina verbos de acción
  const verbRegex =
    /^(?:reproduce|reproducir|reprodúceme|reproduceme|reprodúcela|reproducela|pon|ponme|ponte|poner|pón|escuchar|escucha|quiero\s+escuchar|quiero\s+oír|quiero\s+oir|toca|tocar|tócame|tocame|tócate|tocate|busca|buscar|búscame|buscame|encuentra|encontrar|play|search|reanudar|reanuda|continuar|continua|despausar|despausa|seguir|sigue)(?:\s+|$)/i;
  while (verbRegex.test(text)) {
    text = text.replace(verbRegex, "").trim();
  }

  // Elimina conectores de frase
  text = text.replace(
    /^(?:la\s+canción\s+de|la\s+cancion\s+de|el\s+tema\s+de|la\s+rola\s+de|el\s+video\s+de|el\s+disco\s+de|la\s+música\s+de|la\s+musica\s+de|algo\s+de|a\s+|de\s+|la\s+de\s+)/i,
    ""
  ).trim();
  text = text.replace(/^(?:la\s+canción|la\s+cancion|el\s+tema|la\s+música|la\s+musica|música|musica|canción|cancion|audio)(?:\s+|$)/i, "").trim();

  // Elimina puntuación final
  text = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»“”]/g, " ").trim();
  return text;
}

/**
 * Valida exhaustivamente que un título sea un nombre real de canción o video musical,
 * descartando rigurosamente duraciones / timestamps ("3:18", "05:15", "1:02:40"),
 * números aislados, URLs o textos genéricos de marcadores de posición ("Canción", "Video", "Artista").
 */
export function isValidSongTitle(title: string | undefined | null): boolean {
  if (!title || typeof title !== 'string') return false;
  let t = title.trim();
  if (t.length < 2) return false;

  // 1. Limpiar timestamp inicial si va seguido de texto real (ej: "4:04 Dr. Dre - Still D.R.E." -> "Dr. Dre - Still D.R.E.")
  t = t.replace(/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+)\s*[\s\-·|:]*\s*/i, "").trim();

  // 2. Eliminar prefijos de número de pista al inicio para validar
  t = t.replace(/^(?:#?\d+[\s.-]*)+/, "").trim();
  if (t.length < 2) return false;

  // 3. Rechazar si lo que queda es un timestamp, duración o código de tiempo puro: "3:18", "03:18", "1:05:15", "0:45", etc.
  if (/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+|\d+\s*:\s*\d+)\s*(?:\/\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+))?\s*$/i.test(t)) return false;

  // 4. Rechazar duraciones con sufijos: "3:18 min", "4 mins", "120 seg", "5m 15s"
  if (/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+)\s*(?:min|mins|seg|segundos|seconds|sec|s|m)\b/i.test(t)) return false;

  // 5. Rechazar cadenas que sean solo números
  if (/^\d+$/.test(t)) return false;

  // 6. Rechazar URLs o enlaces web
  if (/^https?:\/\/|^www\./i.test(t) || t.includes('youtube.com') || t.includes('youtu.be')) return false;

  // 7. Rechazar palabras genéricas y marcadores de posición
  const lower = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const genericPlaceholders = new Set([
    'cancion', 'video', 'audio', 'youtube', 'artista', 'artist',
    'musica', 'desconocido', 'unknown', 'null', 'undefined', 'reproducir', 'reproduce', 'play', 'track',
    'en vivo', 'live'
  ]);
  if (genericPlaceholders.has(lower)) return false;

  // 8. Rechazar combinaciones de números/timestamps + palabras genéricas ("4:04 artista", "04 artista", "3:18 video", "video 4:04")
  if (/^(?:\d+[\s:]*)*(?:artista|artist|video|audio|youtube|musica|cancion)$/i.test(lower)) return false;
  if (/^(?:artista|artist|video|audio|youtube|musica|cancion)[\s:]*(?:\d+[\s:]*)*$/i.test(lower)) return false;

  return true;
}

export function isGenericArtistWord(word: string): boolean {
  if (!word) return true;
  const lower = word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const genericPlaceholders = new Set([
    'cancion', 'video', 'audio', 'youtube', 'artista', 'artist',
    'musica', 'desconocido', 'unknown', 'null', 'undefined', 'reproducir', 'reproduce', 'play', 'track',
    'en vivo', 'live'
  ]);
  if (genericPlaceholders.has(lower)) return true;
  if (/^\d+$/.test(lower)) return true;
  if (/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(lower)) return true;
  if (/^(?:\d+[\s:]*)*(?:artista|artist|video|audio|youtube|musica|cancion)$/i.test(lower)) return true;
  return false;
}

/**
 * Sanitiza y separa de forma limpia el título y el artista de una pista,
 * eliminando timestamps sobrantes, marcas de agua o textos de relleno ("4:04 artista" -> "Artista", "4:04 Dr. Dre" -> "Dr. Dre").
 */
export function sanitizeSongTitleAndArtist(
  rawTitle: string | undefined | null,
  rawArtist?: string
): { title: string; artist: string; isValid: boolean } {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return { title: '', artist: '', isValid: false };
  }

  let title = rawTitle.trim();

  // 1. Eliminar cualquier timestamp inicial: "4:04", "03:18", "1:02:40", "4:04 -"
  title = title.replace(/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+)\s*[\s\-·|:]*\s*/i, '').trim();

  // 2. Eliminar prefijos de pista o números al inicio: "#1 -", "02.", "1."
  title = title.replace(/^(?:#?\d+[\s.-]+)+/, '').trim();

  // 3. Eliminar sufijos de canal o marcas de YouTube al final: "- YouTube", "| YouTube", "www.youtube.com"
  title = title
    .replace(/\s*[\-·|:]\s*YouTube.*$/i, '')
    .replace(/\s+YouTube$/i, '')
    .replace(/www\.youtube\.com.*$/i, '')
    .trim();

  let artist = (rawArtist || '').trim();

  // Limpiar sufijos típicos del artista
  artist = artist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/\s*official(\s*channel)?$/i, '')
    .trim();

  // 4. Separar "Artista - Canción" si el título contiene guión
  if (title.includes(' - ')) {
    const parts = title.split(/\s*-\s*/);
    if (parts.length >= 2 && parts[0].trim().length >= 2) {
      const possibleArtist = parts[0].trim();
      const possibleTitle = parts.slice(1).join(' - ').trim();

      if (!artist || isGenericArtistWord(artist)) {
        artist = possibleArtist;
        title = possibleTitle;
      } else if (
        possibleArtist.toLowerCase() === artist.toLowerCase() ||
        artist.toLowerCase().includes(possibleArtist.toLowerCase())
      ) {
        title = possibleTitle;
      }
    }
  }

  // Volver a eliminar cualquier timestamp remanente
  title = title.replace(/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+)\s*/i, '').trim();

  const valid = isValidSongTitle(title);

  if (!artist || isGenericArtistWord(artist)) {
    artist = '';
  }

  return {
    title: valid ? title : '',
    artist,
    isValid: valid
  };
}

/**
 * Limpia el título de un video para comparar similitud de canciones
 */
export function cleanTitleForComparison(title: string): string {
  if (!title) return "";
  let clean = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Reemplazar & por and para unificar "'97 Bonnie & Clyde" con "'97 Bonnie and Clyde"
  clean = clean.replace(/&/g, " and ");

  // Eliminar contenido entre paréntesis, corchetes o llaves
  clean = clean.replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, " ");

  // Eliminar descriptores comunes de videos de YouTube (letras, audio, versiones, etc.)
  clean = clean
    .replace(/lyrics?\s+on\s+screen|with\s+lyrics?|con\s+letras?|letra\s+completa|lyrics?|letras?/gi, " ")
    .replace(/official\s+(music\s+)?video|official\s+audio|official\s+visualizer|visualizer/gi, " ")
    .replace(/video\s+oficial|audio\s+oficial|video\s+con\s+letra|videoclip(\s+oficial)?/gi, " ")
    .replace(/explicit(\s+version)?|clean(\s+version)?|album\s+version|original\s+version/gi, " ")
    .replace(/full\s+(song|video|track|audio|album)/gi, " ")
    .replace(/remaster(ed|izado)?(\s+\d{4})?/gi, " ")
    .replace(/en\s+vivo|live(\s+at\s+.*|\s+in\s+.*)?|acoustic|acustico|unplugged/gi, " ")
    .replace(/slowed(\s+\+\s+reverb)?|reverb|sped\s+up|speed\s+up|nightcore|bass\s+boosted|8d\s+audio/gi, " ")
    .replace(/ft\.?.*|feat\.?.*|featuring.*/gi, " ")
    .replace(/hd|4k|1080p|720p|hq/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean;
}

/**
 * Extrae la parte de la canción de títulos en formato "Artista - Canción"
 */
export function extractSongPart(title: string): string {
  if (!title) return "";
  const parts = title.split(/\s*-\s*|\s*\|\s*|\s*:\s*|\s*\/\s*/);
  if (parts.length > 1) {
    const part1 = cleanTitleForComparison(parts[1]);
    const part0 = cleanTitleForComparison(parts[0]);
    return part1 || part0;
  }
  return cleanTitleForComparison(title);
}

/**
 * Verifica si dos títulos corresponden a la misma canción (para evitar duplicados en la cola)
 */
export function areSameSong(titleA: string, titleB: string, requestedQuery?: string): boolean {
  if (!titleA || !titleB) return false;
  const cA = cleanTitleForComparison(titleA);
  const cB = cleanTitleForComparison(titleB);
  if (!cA || !cB) return false;
  if (cA === cB) return true;

  const songA = extractSongPart(titleA);
  const songB = extractSongPart(titleB);
  if (songA && songB && songA === songB) return true;

  // Substring containment (si una versión contiene exactamente a la otra)
  if (songA && songB) {
    if (songA.length >= 4 && songB.length >= 4) {
      if (songA.includes(songB) || songB.includes(songA)) return true;
    }
  }
  if (cA.length >= 5 && cB.length >= 5) {
    if (cA.includes(cB) || cB.includes(cA)) return true;
  }

  // Comparación de palabras significativas (ignorando stopwords comunes pero conservando números)
  const stopWords = new Set([
    "and", "y", "the", "el", "la", "los", "las", "de", "del", "al", "of", "in", "en", "on", "a", "to", "for", "por", "un", "una"
  ]);
  const getWords = (str: string) =>
    str
      .split(" ")
      .filter(w => (w.length >= 2 || /\d/.test(w)) && !stopWords.has(w));

  const wordsA = getWords(songA || cA);
  const wordsB = getWords(songB || cB);

  if (wordsA.length > 0 && wordsB.length > 0) {
    const common = wordsA.filter((w) => wordsB.includes(w));
    const minLen = Math.min(wordsA.length, wordsB.length);
    const maxLen = Math.max(wordsA.length, wordsB.length);
    if (minLen <= 2 && common.length === minLen) {
      return true;
    }
    if (common.length >= 2 && (common.length / minLen >= 0.7 || common.length / maxLen >= 0.55)) {
      return true;
    }
  }

  if (requestedQuery) {
    const qClean = cleanTitleForComparison(requestedQuery);
    const qWords = getWords(qClean).filter((w) => !["tupac", "2pac", "queen", "mana", "shakira", "eminem", "cancion", "musica"].includes(w));
    if (qWords.length >= 2) {
      const aHasAll = qWords.every((w) => cA.includes(w) || (songA && songA.includes(w)));
      const bHasAll = qWords.every((w) => cB.includes(w) || (songB && songB.includes(w)));
      if (aHasAll && bHasAll) return true;
    }
  }

  return false;
}

/**
 * Detecta si un video NO es musical (podcasts, gameplays, reviews, tutoriales, películas, noticias)
 */
export function isNonMusicVideo(title: string, duration?: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();

  const nonMusicPatterns = [
    /\bpodcast\b/i,
    /\bgameplay\b/i,
    /\bwalkthrough\b/i,
    /\bplaythrough\b/i,
    /\blet's play\b/i,
    /\breview\b/i,
    /\bunboxing\b/i,
    /\breacci[oó]n\b/i,
    /\breaction\b/i,
    /\bnoticias\b/i,
    /\btutorial\b/i,
    /\bgu[ií]a\b/i,
    /\bentrevista\b/i,
    /\binterview\b/i,
    /\bcap[ií]tulo\s*\d+/i,
    /\bepisodio\s*\d+/i,
    /\bdocumental\b/i,
    /\bresumen\b/i,
    /\bpel[ií]cula\s+completa\b/i,
    /\bfull\s+movie\b/i,
    /\btrailer\s+oficial\b/i,
    /\bofficial\s+trailer\b/i,
    /\bescena\b/i,
    /\bstream\s+completo\b/i,
    /\bdirecto\s+jugando\b/i,
    /\bvlog\b/i,
    /\bnoticiero\b/i,
    /\ban[aá]lisis\b/i,
    /\bdebate\b/i,
    /\bconferencia\b/i,
    /\bwebinar\b/i,
    /\bclase\s+completa\b/i,
    /\bcurso\s+completo\b/i
  ];

  for (const pattern of nonMusicPatterns) {
    if (pattern.test(lower)) return true;
  }

  if (duration) {
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
      const hours = parts[0];
      const minutes = parts[1];
      if (hours >= 1 || minutes > 30) return true;
    }
  }

  return false;
}

/**
 * Detecta si un video es una compilación de muchas horas o un mix que no debe ser canción individual
 */
export function isCompilationOrMix(title: string): boolean {
  const lower = (title || "").toLowerCase();
  return (
    lower.includes("full album") ||
    lower.includes("album completo") ||
    lower.includes("greatest hits full") ||
    lower.includes("exitos completos") ||
    lower.includes("mix ") ||
    lower.includes("mix de") ||
    lower.includes("playlist completa") ||
    lower.includes("playlist") ||
    lower.includes("1 hour") ||
    lower.includes("1 hora") ||
    lower.includes("2 hours") ||
    lower.includes("2 horas") ||
    lower.includes("10 hours") ||
    lower.includes("non-stop") ||
    lower.includes("megamix")
  );
}

/**
 * Detecta si un canal u titular de contenido bloquea la inserción de video en reproductores de terceros (Error 150/101).
 * Ejemplos notorios: NFL, NBA, FIFA, Olympics, Formula 1, UEFA, UFC, Premier League, etc.
 */
export function isEmbedRestrictedChannel(artist?: string, title?: string): boolean {
  if (!artist && !title) return false;
  const a = (artist || '').toLowerCase().trim();
  const t = (title || '').toLowerCase().trim();

  const restrictedEntities = [
    /\bnfl\b/i,
    /\bnfl\s+(?:highlights|network|stage\s*pass)\b/i,
    /\bnba\b/i,
    /\bfifa\b/i,
    /\bolympics?\b/i,
    /\bformula\s*(?:1|one)\b/i,
    /\bf1\b/i,
    /\bufc\b/i,
    /\buefa\b/i,
    /\bpremier\s*league\b/i,
    /\blaliga\b/i,
    /\bmlb\b/i,
    /\bnhl\b/i
  ];

  for (const pattern of restrictedEntities) {
    if (pattern.test(a)) return true;
  }

  // Títulos con marcas de derechos cerrados de transmisión
  if (/(?:nfl\s+game\s+highlights|super\s*bowl\s*l[ivx]+\s*live\s*stream|nfl\s+halftime\s*show\s*\(nfl\))/i.test(t)) {
    if (a.includes('nfl')) return true;
  }

  return false;
}

/**
 * Detecta marcas explícitas de restricción de edad (18+, explicit, uncensored, etc.)
 */
export function hasAgeRestrictionMarkers(title?: string, artist?: string): boolean {
  if (!title && !artist) return false;
  const combined = `${title || ''} ${artist || ''}`.toLowerCase();
  return /(?:\bexplicit\s*(?:video|version|content|cut)?\b|uncensored|sin\s*censura|\b18\+\b|\bnsfw\b|unrated|age\s*restricted|restricci[oó]n\s*de\s*edad|para\s*mayores\s*de\s*18)/i.test(combined);
}

/**
 * Detecta si un video tiene marcas explícitas de calidad inferior a 480p (240p, 360p, 144p, baja calidad)
 */
export function isLowQualityVideo(title?: string, artist?: string): boolean {
  if (!title && !artist) return false;
  const combined = `${title || ''} ${artist || ''}`.toLowerCase();
  return /\b(?:240p|360p|144p|low\s*quality|low\s*res|baja\s*calidad|calidad\s*baja|baja\s*resoluci[oó]n|potato\s*quality)\b/i.test(combined);
}

const playabilityCache = new Map<string, { isRestricted: boolean; timestamp: number }>();

/**
 * Comprueba de forma rápida si un video de YouTube tiene restricción de edad
 * o bloqueo de inserción (LOGIN_REQUIRED, Sign in to confirm your age, etc.)
 */
export async function isYouTubeVideoRestricted(videoId: string): Promise<boolean> {
  if (!videoId || videoId.length < 5) return false;
  const cached = playabilityCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.isRestricted;
  }

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8"
      },
      signal: AbortSignal.timeout(1800)
    });
    if (!res.ok) {
      playabilityCache.set(videoId, { isRestricted: true, timestamp: Date.now() });
      return true;
    }
    const html = await res.text();
    const isRestricted =
      html.includes("Sign in to confirm your age") ||
      html.includes("AGE_CHECK_REQUIRED") ||
      html.includes('"isAgeRestricted":true') ||
      html.includes("Este video tiene restricción de edad") ||
      html.includes("Inicia sesión para confirmar tu edad") ||
      /playabilityStatus[^{]+{[^}]+"status"\s*:\s*"LOGIN_REQUIRED"/i.test(html) ||
      /playabilityStatus[^{]+{[^}]+"status"\s*:\s*"AGE_CHECK_REQUIRED"/i.test(html) ||
      html.includes('"status":"UNPLAYABLE"') ||
      html.includes('"playableInEmbed":false');

    playabilityCache.set(videoId, { isRestricted, timestamp: Date.now() });
    return isRestricted;
  } catch {
    return false;
  }
}

/**
 * Puntuación estricta y matemáticamente precisa para elegir la canción exacta que el usuario pidió
 */
export function scoreCandidateVideo(
  item: CatalogTrack,
  query: string,
  directRankIndex: number = -1,
  contexto?: ContextoPuntuacion
): number {
  let score = 0;
  const titleNorm = normalizeText(item.title);
  const artistNorm = normalizeText(item.artist);
  const combined = `${titleNorm} ${artistNorm}`;

  // 0. Penalización estricta por canal con restricción de inserción en iframe (Error 150/101 de YouTube)
  if (isEmbedRestrictedChannel(item.artist, item.title)) {
    score -= 3000;
  }

  // 0.1 Penalización severa por marcas explícitas de restricción de edad
  if (hasAgeRestrictionMarkers(item.title, item.artist)) {
    score -= 3500;
  }

  // 0.2 Penalización estricta por calidad inferior a 480p (<480p)
  if (isLowQualityVideo(item.title, item.artist)) {
    score -= 4500;
  }

  const queryNorm = normalizeText(query);
  const queryTokens = queryNorm
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  // 1. Coincidencia estricta de tokens de búsqueda
  if (queryTokens.length > 0) {
    let matchedCount = 0;
    let missingSignificantToken = false;

    for (const token of queryTokens) {
      // Alias especiales (tupac / 2pac)
      if (token === "tupac" || token === "2pac") {
        if (combined.includes("tupac") || combined.includes("2pac")) {
          matchedCount++;
          score += 150;
        } else {
          missingSignificantToken = true;
        }
        continue;
      }

      if (combined.includes(token)) {
        matchedCount++;
        score += 100;
      } else if (token.length >= 4) {
        // Token largo e importante (ej: "hildemaro", "california", "bohemian") no encontrado
        missingSignificantToken = true;
      }
    }

    const coverageRatio = matchedCount / queryTokens.length;

    if (coverageRatio === 1.0) {
      // Coincidencia perfecta de todos los términos de búsqueda
      score += 1200;
    } else if (coverageRatio >= 0.75) {
      score += 600;
    } else if (coverageRatio < 0.5) {
      score -= 600;
    }

    // Penalización severa si falta una palabra clave principal (evita que Pandora reemplace a Hildemaro)
    if (missingSignificantToken && queryTokens.length >= 2) {
      score -= 1000;
    }
  }

  // 2. Coincidencia exacta de frase completa
  if (titleNorm.includes(queryNorm) || combined.includes(queryNorm)) {
    score += 800;
  }

  // 3. Bonificación por ranking original en la búsqueda directa de YouTube
  // (YouTube ya clasifica por relevancia bi-direccional)
  if (directRankIndex >= 0) {
    if (directRankIndex === 0) score += 500;
    else if (directRankIndex === 1) score += 350;
    else if (directRankIndex === 2) score += 200;
    else if (directRankIndex === 3) score += 100;
  }

  // 4. Prioridad a la etiqueta de "video oficial" / "official video" (cuando esté disponible)
  if (
    /(?:video\s*oficial|official\s*(?:music\s*)?video|\(video oficial\)|\[video oficial\]|\(official video\)|\[official video\])/i.test(
      item.title
    )
  ) {
    score += 1000; // Prioridad máxima a la etiqueta de "video oficial"
  } else if (/audio\s*oficial|\(audio\)|official\s*audio/i.test(item.title)) {
    score += 700;
  } else if (/- topic$/i.test(item.artist.trim())) {
    score += 650;
  } else if (/visualizer|lyric\s*video|letra|video\s*con\s*letra/i.test(item.title)) {
    score += 500;
  } else if (/official|oficial/i.test(item.title)) {
    score += 350;
  }

  // Bonificación para canales oficiales / VEVO
  if (/vevo|records|music\s*channel|official/i.test(item.artist)) {
    score += 200;
  }

  // Bonificación por alta definición o calidad garantizada (4K, 1080p, 720p, 480p, HD)
  if (/\b(?:4k|1080p|720p|480p|uhd|full\s*hd|hd)\b/i.test(item.title)) {
    score += 350;
  }

  // 5. Penalizaciones estrictas por contenido NO musical (podcasts, gameplays, tutoriales, noticias, gameplays, memes, etc.)
  if (
    /(?:podcast|gameplay|tutorial|walkthrough|noticias|news|documental|documentary|entrevista|interview|review|unboxing|resumen|vlog|tiktok|shorts|parodia|stream|directo|capitulo|episodio|trailer|pelicula|movie|scene|reaction|reacci[oó]n|meme|clase|curso|explicaci[oó]n|debate|full\s*movie|short\s*film|stand\s*up|speedrun)/i.test(
      combined
    )
  ) {
    score -= 1600;
  }

  // Penalizaciones por mixes largos no deseados o covers
  if (
    isCompilationOrMix(item.title) ||
    /compilation|grandes\s*exitos|exitos\s*completos|album\s*completo|full\s*album|mix\s*202|top\s*10|karaoke|cover\s*by|tributo|bass\s*boosted|slowed\s*\+\s*reverb|8d\s*audio/i.test(
      combined
    )
  ) {
    score -= 800;
  }

  // 6. Validación de duración típica de video musical (2 a 8 minutos)
  if (item.duration) {
    const parts = item.duration.split(":").map((p) => parseInt(p, 10));
    let totalSec = 0;
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      totalSec = parts[0] * 60 + parts[1];
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (totalSec > 0) {
      if (totalSec >= 100 && totalSec <= 480) {
        score += 50;
      } else if (totalSec > 900) {
        score -= 900;
      }
    }
  }

  // 7. Señales de la PETICIÓN DE VOZ (título, artista, fonética ES<->EN, género y
  //    variante pedida). Se suman a la puntuación propia para que "lo que el usuario
  //    dijo" pese tanto como la coincidencia literal de palabras.
  if (contexto) {
    score += bonificacionContexto(item, contexto).puntos;
  }

  return score;
}

/**
 * Consulta la búsqueda de YouTube y extrae metadatos ricos de videos (soporta videoRenderer y lockupViewModel)
 */
export async function scrapeYouTubeVideos(
  searchQuery: string,
  maxResults: number = 10
): Promise<CatalogTrack[]> {
  try {
    const encoded = encodeURIComponent(searchQuery);
    const searchUrl = `https://www.youtube.com/results?search_query=${encoded}&sp=EgIQAQ%253D%253D`;

    const fetchResponse = await fetch(searchUrl, {
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });

    if (!fetchResponse.ok) return [];
    const html = await fetchResponse.text();

    const items: CatalogTrack[] = [];
    const seenIds = new Set<string>();

    // Método A: Extracción de JSON ytInitialData
    const jsonMatch =
      html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*({.+?});/s);

    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const contents =
          data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;

        if (Array.isArray(contents)) {
          for (const section of contents) {
            const itemSection = section?.itemSectionRenderer?.contents;
            if (Array.isArray(itemSection)) {
              for (const item of itemSection) {
                // 1. Classic videoRenderer
                const vr = item?.videoRenderer;
                if (vr && vr.videoId && !seenIds.has(vr.videoId)) {
                  const rawTitle = vr.title?.runs?.[0]?.text || vr.title?.simpleText || "";
                  if (isValidSongTitle(rawTitle)) {
                    seenIds.add(vr.videoId);
                    let title = rawTitle.trim();
                    let artist =
                      vr.ownerText?.runs?.[0]?.text ||
                      vr.shortBylineText?.runs?.[0]?.text ||
                      "";
                    if ((!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') && title.includes(' - ')) {
                      const parts = title.split(/\s*-\s*/);
                      if (parts.length >= 2 && parts[0].trim().length >= 2) {
                        artist = parts[0].trim();
                        title = parts.slice(1).join(' - ').trim();
                      }
                    }
                    const duration =
                      vr.lengthText?.simpleText || vr.lengthText?.runs?.[0]?.text || "3:45";

                    items.push({
                      id: vr.videoId,
                      title: title || rawTitle,
                      artist,
                      thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
                      duration
                    });
                    if (items.length >= maxResults) break;
                  }
                }

                // 2. Modern lockupViewModel (usado en YouTube 2024-2026)
                const vm = item?.lockupViewModel;
                if (vm) {
                  const videoId =
                    vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
                  if (videoId && !seenIds.has(videoId)) {
                    const rawTitle =
                      vm.metadata?.lockupMetadataViewModel?.title?.content || "";
                    if (isValidSongTitle(rawTitle)) {
                      seenIds.add(videoId);
                      let title = rawTitle.trim();
                      let artist =
                        vm.metadata?.lockupMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content ||
                        "";
                      if ((!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') && title.includes(' - ')) {
                        const parts = title.split(/\s*-\s*/);
                        if (parts.length >= 2 && parts[0].trim().length >= 2) {
                          artist = parts[0].trim();
                          title = parts.slice(1).join(' - ').trim();
                        }
                      }
                      const duration =
                        vm.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text ||
                        "3:45";

                      items.push({
                        id: videoId,
                        title: title || rawTitle,
                        artist,
                        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        duration
                      });
                      if (items.length >= maxResults) break;
                    }
                  }
                }
              }
            }
            if (items.length >= maxResults) break;
          }
        }
      } catch (e) {
        console.warn("[YouTubeEngine] Error analizando JSON de YouTube:", e);
      }
    }

    // Método B: Regex extraction fallback si el JSON falló
    if (items.length === 0) {
      const vrRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
      let m;
      while ((m = vrRegex.exec(html)) !== null && items.length < maxResults) {
        if (!seenIds.has(m[1])) {
          seenIds.add(m[1]);
          items.push({
            id: m[1],
            title: searchQuery,
            artist: "",
            thumbnail: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`,
            duration: "3:45"
          });
        }
      }
    }

    return items;
  } catch (err) {
    console.warn("[YouTubeEngine] Error al consultar YouTube:", err);
    return [];
  }
}

/**
 * Obtiene la lista continua de reproducción YouTube Mix (list=RD[videoId])
 * Garantiza 25-30 canciones continuas similares y de alta calidad
 */
export async function scrapeYouTubeMix(videoId: string): Promise<CatalogTrack[]> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`, {
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match =
      html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match) return [];

    const data = JSON.parse(match[1]);
    const pr = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist;
    const contents = pr?.contents;
    const tracks: CatalogTrack[] = [];
    const seenIds = new Set<string>();

    if (Array.isArray(contents)) {
      for (const it of contents) {
        const item = it.playlistPanelVideoRenderer;
        if (item && item.videoId && !seenIds.has(item.videoId)) {
          const id = item.videoId;
          const rawTitle =
            (Array.isArray(item.title?.runs) ? item.title.runs.map((r: any) => r?.text || '').join('') : '') ||
            item.title?.simpleText ||
            item.title?.runs?.[0]?.text ||
            "";
          if (!isValidSongTitle(rawTitle)) continue;
          if (isLowQualityVideo(rawTitle)) continue;

          seenIds.add(item.videoId);
          let title = rawTitle.trim();
          let artist =
            (Array.isArray(item.shortBylineText?.runs) ? item.shortBylineText.runs.map((r: any) => r?.text || '').join('') : '') ||
            item.shortBylineText?.simpleText ||
            item.shortBylineText?.runs?.[0]?.text ||
            "";
          if ((!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') && title.includes(' - ')) {
            const parts = title.split(/\s*-\s*/);
            if (parts.length >= 2 && parts[0].trim().length >= 2) {
              artist = parts[0].trim();
              title = parts.slice(1).join(' - ').trim();
            }
          }
          if (!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') {
            artist = 'Música';
          }
          const duration = item.lengthText?.simpleText || item.lengthText?.runs?.[0]?.text || "3:45";
          tracks.push({
            id,
            title: title || rawTitle,
            artist,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            duration
          });
        }
      }
    }
    return tracks;
  } catch (err) {
    console.warn("[YouTubeEngine] Error obteniendo YouTube Mix:", err);
    return [];
  }
}

/**
 * Obtiene pistas adicionales de una playlist de YouTube
 */
export async function scrapeYouTubePlaylist(playlistId: string): Promise<CatalogTrack[]> {
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match =
      html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match) return [];

    const data = JSON.parse(match[1]);
    const tab = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0];
    const items =
      tab?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
    const tracks: CatalogTrack[] = [];
    const seenIds = new Set<string>();

    if (Array.isArray(items)) {
      for (const it of items) {
        const vm = it.lockupViewModel;
        if (vm) {
          const id =
            vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
          const rawTitle = vm.metadata?.lockupMetadataViewModel?.title?.content;
          if (id && isValidSongTitle(rawTitle) && !seenIds.has(id)) {
            seenIds.add(id);
            let title = rawTitle.trim();
            let artist =
              vm.metadata?.lockupMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content ||
              "";
            if ((!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') && title.includes(' - ')) {
              const parts = title.split(/\s*-\s*/);
              if (parts.length >= 2 && parts[0].trim().length >= 2) {
                artist = parts[0].trim();
                title = parts.slice(1).join(' - ').trim();
              }
            }
            tracks.push({
              id,
              title: title || rawTitle,
              artist,
              thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              duration: "3:45"
            });
          }
        }
        const vr = it.playlistVideoRenderer;
        if (vr && vr.videoId && !seenIds.has(vr.videoId)) {
          const id = vr.videoId;
          const rawTitle = vr.title?.runs?.[0]?.text || vr.title?.simpleText || "";
          if (id && isValidSongTitle(rawTitle)) {
            seenIds.add(vr.videoId);
            let title = rawTitle.trim();
            let artist = vr.shortBylineText?.runs?.[0]?.text || "";
            if ((!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') && title.includes(' - ')) {
              const parts = title.split(/\s*-\s*/);
              if (parts.length >= 2 && parts[0].trim().length >= 2) {
                artist = parts[0].trim();
                title = parts.slice(1).join(' - ').trim();
              }
            }
            const duration = vr.lengthText?.simpleText || "3:45";
            tracks.push({
              id,
              title: title || rawTitle,
              artist,
              thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              duration
            });
          }
        }
      }
    }
    return tracks;
  } catch (err) {
    console.warn("[YouTubeEngine] Error scrapeYouTubePlaylist:", err);
    return [];
  }
}

/**
 * Busca el ID de una playlist oficial del artista
 */
export async function searchYouTubePlaylistId(query: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(query);
    const searchUrl = `https://www.youtube.com/results?search_query=${encoded}&sp=EgIQAw%253D%253D`;

    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const items =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents;

    if (Array.isArray(items)) {
      for (const it of items) {
        const vm = it.lockupViewModel;
        if (vm) {
          const watchEp =
            vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
          if (watchEp?.playlistId) return watchEp.playlistId;

          const browseEp =
            vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint;
          if (browseEp?.browseId && browseEp.browseId.startsWith("VL")) {
            return browseEp.browseId.replace(/^VL/, "");
          }
        }
        const pr = it.playlistRenderer;
        if (pr?.playlistId) return pr.playlistId;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Construye una lista de reproducción y cola continua del artista estilo YouTube Mix / Radio.
 * Pista #1: La canción exacta solicitada.
 * Pistas #2..N: Éxitos adicionales del MISMO artista y canciones afines vía YouTube Mix,
 * garantizando que la MISMA canción NO se repita de otros canales (vídeo oficial, letra, re-subidas, etc.).
 */
export async function buildArtistAndMixPlaylist(
  topTrack: CatalogTrack,
  query: string = '',
  isArtistOnly: boolean = false,
  extraCandidates: CatalogTrack[] = []
): Promise<CatalogTrack[]> {
  // 1. Deducir y limpiar el nombre del artista principal
  let candidateArtist = (topTrack.artist || '').trim();
  let rawTitle = (topTrack.title || '').trim();

  // Limpiar sufijos típicos de canales de YouTube en el artista
  candidateArtist = candidateArtist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/\s*official(\s*channel)?$/i, '')
    .trim();

  // Si el título contiene "Artista - Canción", extraer el artista de ahí si es más confiable
  if (rawTitle.includes(' - ')) {
    const parts = rawTitle.split(/\s*-\s*/);
    const possibleArtist = parts[0].trim();
    if (
      possibleArtist.length >= 2 &&
      (!candidateArtist || candidateArtist.toLowerCase() === 'artista' || candidateArtist.toLowerCase() === 'youtube' || candidateArtist.toLowerCase().includes('cancion'))
    ) {
      candidateArtist = possibleArtist;
      rawTitle = parts.slice(1).join(' - ').trim();
    }
  }

  // Si aún no tenemos artista claro, intentar extraer de la consulta de búsqueda
  if (!candidateArtist || candidateArtist.toLowerCase() === 'artista' || candidateArtist.toLowerCase() === 'youtube') {
    const parts = query.split(/\s*-\s*|\s+de\s+|\s+por\s+/i);
    if (parts.length > 1) {
      candidateArtist = parts[parts.length - 1].trim();
    } else {
      candidateArtist = query.trim();
    }
  }

  // Sanitizar pista #1
  const cleanTopTrack: CatalogTrack = {
    ...topTrack,
    title: rawTitle || topTrack.title,
    artist: candidateArtist || topTrack.artist || 'Música',
    thumbnail: topTrack.thumbnail && !topTrack.thumbnail.includes('unsplash')
      ? topTrack.thumbnail
      : `https://i.ytimg.com/vi/${topTrack.id}/hqdefault.jpg`
  };

  const fullPlaylist: CatalogTrack[] = [cleanTopTrack];
  const seenIds = new Set<string>([topTrack.id]);

  console.log(`[ArtistMixEngine] 🎵 Generando cola de artista y YouTube Mix para: "${cleanTopTrack.title}" (${cleanTopTrack.id}) - Artista: "${cleanTopTrack.artist}"`);

  try {
    // 2. Obtener en paralelo:
    // a) YouTube Mix oficial de la canción (list=RD[videoId])
    // b) Más canciones populares del MISMO artista
    // c) Éxitos adicionales del artista
    const [mixTracks, artistHits1, artistHits2] = await Promise.all([
      scrapeYouTubeMix(topTrack.id).catch(() => []),
      candidateArtist && candidateArtist.length > 1
        ? scrapeYouTubeVideos(`${candidateArtist} canciones populares official music video`, 12).catch(() => [])
        : Promise.resolve([]),
      candidateArtist && candidateArtist.length > 1
        ? scrapeYouTubeVideos(`${candidateArtist} greatest hits official video`, 10).catch(() => [])
        : Promise.resolve([])
    ]);

    // Pool de candidatos priorizando:
    // 1) Más canciones del mismo artista (para reproducir la discografía / lista del artista)
    // 2) YouTube Mix oficial de la pista #1
    // 3) Candidatos adicionales de Google Videos / alternativas
    const candidatePool = [
      ...artistHits1,
      ...artistHits2,
      ...mixTracks,
      ...extraCandidates
    ];

    // Helper local para extraer título base de la canción
    const cleanSongPart = (t: string) => {
      const part = extractSongPart(t);
      return (part || cleanTitleForComparison(t)).replace(/[^a-z0-9]/g, '');
    };

    const topSongKey = cleanSongPart(cleanTopTrack.title);

    for (const item of candidatePool) {
      if (!item || !item.id || seenIds.has(item.id)) continue;
      // 🛡️ REGLA DE ORO ANTI-DURACIONES Y NOMBRES RAROS:
      // Jamás admitir duraciones / timestamps ("3:18", "5:15", "4:04 artista") ni títulos genéricos
      const sanitized = sanitizeSongTitleAndArtist(item.title, item.artist);
      if (!sanitized.isValid) continue;
      if (isNonMusicVideo(sanitized.title, item.duration)) continue;
      if (isLowQualityVideo(sanitized.title, item.artist)) continue;
      if (isCompilationOrMix(sanitized.title)) continue;

      // 🛡️ REGLA DE ORO ANTI-REPETICIÓN:
      // Jamás añadir la MISMA canción que la pista #1 bajo otro título o canal
      if (areSameSong(sanitized.title, cleanTopTrack.title, query)) continue;

      // Comparación estricta de parte de canción
      const itemSongKey = cleanSongPart(sanitized.title);
      if (topSongKey && itemSongKey && (topSongKey === itemSongKey || itemSongKey.includes(topSongKey) || topSongKey.includes(itemSongKey))) {
        continue;
      }

      // Evitar canciones duplicadas entre sí en la cola
      let isRepeatInQueue = false;
      for (const existing of fullPlaylist) {
        if (areSameSong(sanitized.title, existing.title)) {
          isRepeatInQueue = true;
          break;
        }
        const existingKey = cleanSongPart(existing.title);
        if (existingKey && itemSongKey && existingKey === itemSongKey) {
          isRepeatInQueue = true;
          break;
        }
      }
      if (isRepeatInQueue) continue;

      seenIds.add(item.id);

      let itemArtist = sanitized.artist;
      if (!itemArtist || isGenericArtistWord(itemArtist)) {
        itemArtist = candidateArtist || cleanTopTrack.artist || 'Música';
      }

      fullPlaylist.push({
        ...item,
        title: sanitized.title,
        artist: itemArtist,
        thumbnail: item.thumbnail && !item.thumbnail.includes('unsplash')
          ? item.thumbnail
          : `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
        duration: item.duration || '3:45'
      });

      if (fullPlaylist.length >= 35) break;
    }
  } catch (err) {
    console.warn('[ArtistMixEngine] Error generando cola de artista:', err);
  }

  return fullPlaylist;
}

/**
 * MOTOR PRINCIPAL DE BÚSQUEDA Y GENERACIÓN DE COLA INFINITA
 * 1. Encuentra con precisión milimétrica la canción exacta solicitada (Pista #1)
 * 2. Genera automáticamente una cola continua de 30-40 canciones recomendadas
 */
export async function searchYouTubeMusic(
  rawQuery: string,
  isArtistOnlyParam: boolean = false
): Promise<MusicSearchResult | null> {
  const analysis = await smartAnalyzeQueryWithGemini(rawQuery);
  const query = analysis.cleanedQuery || cleanSearchQuery(rawQuery);
  const isArtistOnly = isArtistOnlyParam || analysis.isArtistOnly;

  if (!query) return null;

  // 0. Resolver el contexto musical profundo (artista, género, canciones top, artistas afines)
  const context = await resolveMusicalContext(rawQuery);
  const mainArtist = context.requestedArtist || query;

  console.log(
    `[YouTubeEngine] 🎵 Búsqueda con Coherencia de Género (${context.primaryGenre}): "${query}" | Artista: "${mainArtist}" | Afines: ${context.coherentRelatedArtists.slice(0, 3).join(', ')}`
  );

  try {
    // 1. Ejecutar búsqueda directa exacta en YouTube, además de variantes "official video" y "video oficial"
    const [directResults, officialVideosEn, officialVideosEs] = await Promise.all([
      scrapeYouTubeVideos(query, 12),
      !isArtistOnly && !/official|oficial/i.test(query)
        ? scrapeYouTubeVideos(`${query} official video`, 6)
        : Promise.resolve([]),
      !isArtistOnly && !/official|oficial/i.test(query)
        ? scrapeYouTubeVideos(`${query} video oficial`, 6)
        : Promise.resolve([])
    ]);

    // Combinar y deduplicar candidatos iniciales por ID
    const combinedCandidates: CatalogTrack[] = [];
    const seenCandidateIds = new Set<string>();

    for (const list of [directResults, officialVideosEn, officialVideosEs]) {
      for (const item of list) {
        if (!seenCandidateIds.has(item.id)) {
          seenCandidateIds.add(item.id);
          combinedCandidates.push(item);
        }
      }
    }

    // =========================================================================
    // CASO A: El usuario pidió un artista completo (ej: "música de Kendrick Lamar", "Eminem", "Queen")
    // =========================================================================
    if (isArtistOnly) {
      // 1. Obtener canciones del artista principal
      let artistTracks: CatalogTrack[] = [];
      const playlistId = await searchYouTubePlaylistId(`${mainArtist} greatest hits exitos playlist`);
      if (playlistId) {
        artistTracks = await scrapeYouTubePlaylist(playlistId);
      }

      // Si la playlist oficial no fue suficiente, buscar videos de grandes éxitos
      if (artistTracks.length < 10) {
        const moreArtistHits = await scrapeYouTubeVideos(`${mainArtist} greatest hits official music video`, 12);
        artistTracks = [...artistTracks, ...moreArtistHits];
      }

      // 2. Obtener pistas de artistas afines del mismo género para una continuidad fluida
      const relatedPromises = context.coherentRelatedArtists.slice(0, 3).map(relArtist =>
        scrapeYouTubeVideos(`${relArtist} greatest hits official video`, 5)
      );
      const relatedResults = await Promise.all(relatedPromises);
      const relatedTracks = relatedResults.flat();

      const candidatePool = [...artistTracks, ...combinedCandidates, ...relatedTracks];
      const uniqueQueue: CatalogTrack[] = [];
      const seen = new Set<string>();

      for (const t of candidatePool) {
        if (!t.id || seen.has(t.id) || !isValidSongTitle(t.title) || isCompilationOrMix(t.title) || isLowQualityVideo(t.title, t.artist)) continue;

        // Filtro de coherencia de género para descartar pistas incompatibles
        if (!isTrackGenreCoherent(t, context)) continue;

        // Evitar canciones repetidas en la cola
        let isRepeat = false;
        for (const existing of uniqueQueue) {
          if (areSameSong(t.title, existing.title)) {
            isRepeat = true;
            break;
          }
        }
        if (isRepeat) continue;

        seen.add(t.id);
        let tTitle = t.title.trim();
        let tArtist = (t.artist || '').trim();
        if ((!tArtist || tArtist.toLowerCase() === 'artista' || tArtist.toLowerCase() === 'youtube') && tTitle.includes(' - ')) {
          const parts = tTitle.split(/\s*-\s*/);
          if (parts.length >= 2 && parts[0].trim().length >= 2) {
            tArtist = parts[0].trim();
            tTitle = parts.slice(1).join(' - ').trim();
          }
        }
        uniqueQueue.push({
          ...t,
          title: tTitle || t.title,
          artist: tArtist || mainArtist
        });
        if (uniqueQueue.length >= 40) break;
      }

      if (uniqueQueue.length > 0) {
        return {
          source: "youtube_coherent_artist_playlist",
          firstTrack: uniqueQueue[0],
          items: uniqueQueue
        };
      }
    }

    // =========================================================================
    // CASO B: Búsqueda de una canción o tema específico
    // =========================================================================
    if (combinedCandidates.length > 0) {
      // 1. Puntuar y seleccionar con precisión milimétrica la pista #1
      const scoredCandidates = combinedCandidates.map((item, index) => ({
        item,
        score: scoreCandidateVideo(item, query, index)
      }));

      scoredCandidates.sort((a, b) => b.score - a.score);
      const requestedTrack = scoredCandidates[0].item;

      let candidateArtist = requestedTrack.artist || mainArtist;
      if (requestedTrack.title.includes(" - ")) {
        const parts = requestedTrack.title.split(" - ");
        candidateArtist = parts[0].trim();
      }

      console.log(
        `[YouTubeEngine] 🎯 Pista #1 seleccionada: "${requestedTrack.title}" (${requestedTrack.id}) - Artista: "${candidateArtist}"`
      );

      // 2. Obtener:
      // a) Más éxitos del MISMO artista (para sonar justo después de la pista #1)
      // b) Éxitos de artistas AFINES del mismo género
      // c) YouTube Mix de la pista #1 filtrado por coherencia
      const [sameArtistHits, mixTracks, ...relatedBatches] = await Promise.all([
        scrapeYouTubeVideos(`${candidateArtist} greatest hits official music video`, 10),
        scrapeYouTubeMix(requestedTrack.id),
        ...context.coherentRelatedArtists.slice(0, 3).map(rel =>
          scrapeYouTubeVideos(`${rel} best songs official video`, 5)
        )
      ]);

      const relatedTracks = relatedBatches.flat();
      const filteredMixTracks = mixTracks.filter(t => isTrackGenreCoherent(t, context));

      // 3. Ensamblar la cola en orden de máxima coherencia:
      // - Pista #1: Canción exacta solicitada
      // - Pistas #2..10: Más canciones del mismo artista
      // - Pistas #11..25: Canciones de artistas afines del mismo género
      // - Pistas #26..40: Recomendaciones de YouTube Mix verificadas
      const finalPlaylist: CatalogTrack[] = [requestedTrack];
      const seenIds = new Set<string>([requestedTrack.id]);

      const candidatePool = [
        ...sameArtistHits,
        ...relatedTracks,
        ...filteredMixTracks,
        ...combinedCandidates.slice(1)
      ];

      for (const t of candidatePool) {
        if (!t.id || seenIds.has(t.id) || !isValidSongTitle(t.title) || isCompilationOrMix(t.title) || isLowQualityVideo(t.title, t.artist)) continue;

        // Filtro estricto de género y coherencia musical
        if (!isTrackGenreCoherent(t, context)) continue;

        // Descartar si es la misma canción que la pista #1
        if (areSameSong(t.title, requestedTrack.title, query)) continue;

        // Descartar duplicados en la cola
        let isRepeat = false;
        for (const existing of finalPlaylist) {
          if (areSameSong(t.title, existing.title)) {
            isRepeat = true;
            break;
          }
        }
        if (isRepeat) continue;

        seenIds.add(t.id);
        let tTitle = t.title.trim();
        let tArtist = (t.artist || '').trim();
        if ((!tArtist || tArtist.toLowerCase() === 'artista' || tArtist.toLowerCase() === 'youtube') && tTitle.includes(' - ')) {
          const parts = tTitle.split(/\s*-\s*/);
          if (parts.length >= 2 && parts[0].trim().length >= 2) {
            tArtist = parts[0].trim();
            tTitle = parts.slice(1).join(' - ').trim();
          }
        }
        finalPlaylist.push({
          ...t,
          title: tTitle || t.title,
          artist: tArtist || candidateArtist
        });

        if (finalPlaylist.length >= 40) break;
      }

      return {
        source: "youtube_genre_coherent_queue",
        firstTrack: finalPlaylist[0],
        items: finalPlaylist
      };
    }
  } catch (err) {
    console.error("[YouTubeEngine] Error en searchYouTubeMusic:", err);
  }

  return null;
}

/**
 * Busca específicamente una versión alternativa compatible (libre de restricciones de inserción en YouTube)
 * para una canción o show que falló al reproducirse (Error 150/101 o 100).
 */
export async function findCompatibleAlternative(
  failedId: string,
  title?: string,
  artist?: string,
  rawQuery?: string
): Promise<CatalogTrack | null> {
  // Limpiar título de metadatos o basura del canal bloqueado
  let cleanTitle = (title || rawQuery || "").trim();
  cleanTitle = cleanTitle
    .replace(/\b(?:nfl\s+y\s+\d+\s+m[aá]s|nfl\s+network|nfl\s+highlights|nfl|nba|fifa)\b/gi, "")
    .replace(/[\[\(](?:official\s*video|video\s*oficial|audio\s*oficial|lyric\s*video|en\s*vivo)[\]\)]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  let cleanArtist = (artist || "").trim();
  cleanArtist = cleanArtist
    .replace(/\b(?:nfl\s+y\s+\d+\s+m[aá]s|nfl\s+network|nfl|nba|fifa)\b/gi, "")
    .trim();

  const searchQueries: string[] = [];
  if (cleanTitle) {
    searchQueries.push(cleanTitle);
    if (!cleanTitle.toLowerCase().includes("completo") && !cleanTitle.toLowerCase().includes("full")) {
      searchQueries.push(`${cleanTitle} video`);
    }
  }
  if (cleanArtist && cleanTitle && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) {
    searchQueries.push(`${cleanArtist} ${cleanTitle}`);
  }

  console.log(`[YouTubeEngine] 🔍 Buscando alternativa compatible para "${title}" (ID fallido: ${failedId}). Variaciones:`, searchQueries);

  const seenIds = new Set<string>();
  if (failedId) seenIds.add(failedId);

  for (const q of searchQueries) {
    try {
      const candidates = await scrapeYouTubeVideos(q, 12);
      const viable = candidates.filter(
        c => c.id &&
             !seenIds.has(c.id) &&
             !isEmbedRestrictedChannel(c.artist, c.title) &&
             !isNonMusicVideo(c.title, c.duration) &&
             !isLowQualityVideo(c.title, c.artist)
      );

      if (viable.length > 0) {
        // Ordenar candidatos por relevancia con respecto al tema original
        // (priorizando audio oficial, topic o lyric, evitando repetir el video oficial bloqueado)
        const scored = viable.map((item, idx) => {
          let s = scoreCandidateVideo(item, cleanTitle || q, idx);
          if (/(?:video\s*oficial|official\s*(?:music\s*)?video)/i.test(item.title)) {
            s -= 1500;
          }
          if (/-?\s*topic$/i.test(item.artist)) s += 900;
          if (/\baudio\b/i.test(item.title)) s += 700;
          if (/\b(lyric|letra|lyrics)\b/i.test(item.title)) s += 500;
          return { item, score: s };
        });
        scored.sort((a, b) => b.score - a.score);

        for (const s of scored) {
          const cand = s.item;
          const restricted = await isYouTubeVideoRestricted(cand.id);
          if (!restricted) {
            console.log(`[YouTubeEngine] ✅ Alternativa compatible libre de restricción de edad: "${cand.title}" (${cand.id})`);
            return cand;
          }
        }
      }
    } catch (e) {
      console.warn(`[YouTubeEngine] Error en búsqueda de alternativa para "${q}":`, e);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BÚSQUEDA POR VOZ CON RECUPERACIÓN ESCALONADA
// ═══════════════════════════════════════════════════════════════════════════════

export interface BusquedaVozResultado {
  items: CatalogTrack[];
  firstTrack?: CatalogTrack;
  source: string;
  intent: PeticionVoz;
  variantes: Array<{ texto: string; origen: string }>;
  /** 0..1 según la puntuación del candidato elegido */
  confianza: number;
  /** Motivos legibles de la selección (o del rechazo) */
  motivo: string;
  /** Traza completa para diagnóstico */
  diagnostico: string[];
  /** true si la búsqueda en sí falló (red), para que el llamador use su respaldo */
  error?: boolean;
  /** true si se encontró algo pero sin confianza suficiente */
  sinConfianza?: boolean;
}

/** Umbral a partir del cual se considera buena coincidencia y se cortan las variantes */
const UMBRAL_ALTA_CONFIANZA = 2100;
/** Mínimo para aceptar un resultado cuando se pidió una canción concreta */
const UMBRAL_MINIMO_CANCION = 150;

/**
 * Busca la canción pedida por voz aplicando una estrategia escalonada:
 *   1ª) petición original limpiada de comandos
 *   2ª) variante fonética (español <-> inglés) y corrección de Google (auxiliar)
 *   3ª) recombinación título/artista o intención (artista/éxitos/género)
 * y elige el candidato con mejor puntuación. Si no hay coincidencia fiable, devuelve
 * vacío con el motivo en vez de reproducir algo al azar.
 *
 * La corrección de Google se inyecta como parámetro para no crear dependencias
 * circulares (googleSearchCorrector.ts ya importa este archivo).
 */
export async function searchYouTubeMusicSmart(
  rawQuery: string,
  isArtistOnly: boolean = false,
  opciones: {
    corregirConGoogle?: (q: string) => Promise<{ correctedQuery?: string; source?: string } | null>;
    maxVariantes?: number;
  } = {}
): Promise<BusquedaVozResultado> {
  const intent = analizarPeticionVoz(rawQuery);
  const diagnostico: string[] = [];
  const anotar = (linea: string) => diagnostico.push(linea);

  anotar(`petición="${rawQuery}" | limpia="${intent.limpia}" | tipo=${intent.tipo}` +
    ` | título="${intent.titulo || ''}" | artista="${intent.artista || ''}"` +
    ` | género="${intent.genero || ''}" | variante=${intent.variante || 'ninguna'}` +
    ` | idioma=${intent.idiomaProbable} | confianzaAnálisis=${intent.confianza.toFixed(2)}`);

  if (intent.tipo === 'no_musical') {
    anotar('descartada: es un comando de control, no una petición musical');
    console.log('[BusquedaVoz] ' + diagnostico.join('\n[BusquedaVoz] '));
    return { items: [], source: 'descartado', intent, variantes: [], confianza: 0, motivo: 'Comando de control', diagnostico };
  }

  const variantes = generarVariantesConsulta(intent, opciones.maxVariantes ?? 3);
  anotar('variantes generadas: ' + variantes.map(v => `"${v.texto}" (${v.origen})`).join(' | '));

  // Corrección de Google como fuente AUXILIAR (una sola consulta, con su caché interna)
  if (opciones.corregirConGoogle && variantes.length < (opciones.maxVariantes ?? 4)) {
    try {
      const correccion = await opciones.corregirConGoogle(intent.limpia);
      const texto = (correccion?.correctedQuery || '').trim();
      if (texto && normalizarBase(texto) !== normalizarBase(intent.limpia)) {
        const yaExiste = variantes.some(v => normalizarBase(v.texto) === normalizarBase(texto));
        if (!yaExiste) {
          variantes.splice(1, 0, { texto, origen: `google:${correccion?.source || 'suggest'}` });
          anotar(`corrección de Google añadida como variante: "${texto}"`);
        }
      } else {
        anotar('Google no propuso corrección distinta (la petición se conserva)');
      }
    } catch (e: any) {
      anotar(`Google no disponible para corregir: ${e?.message || e}`);
    }
  }

  const buscarComoArtista = isArtistOnly || intent.tipo === 'artista' || intent.tipo === 'exitos';
  // Para GÉNERO/mezcla/playlist NO se usa el modo "solo artista": hay que buscar el
  // género y no dejar que YouTube invente un artista con el texto de la petición.

  /** ¿El candidato cumple lo esencial que se pidió? (para aceptar con alta confianza) */
  const cumpleExpectativa = (item: CatalogTrack): boolean => {
    const tituloItem = normalizarBase(item.title || '');
    if (intent.genero) return new RegExp(intent.genero, 'i').test(tituloItem);
    if (intent.titulo) {
      const tituloPedido = normalizarBase(intent.titulo);
      const tokens = tituloPedido.split(/\s+/).filter(t => t.length > 1);
      // Comparación por PALABRA COMPLETA (no por subcadena). Además se compara el título
      // "compactado", porque hay títulos normales que al normalizar quedan en letras sueltas:
      // "P.I.M.P." -> "p i m p" -> "pimp". Antes, con esos títulos, la lista de tokens quedaba
      // vacía y la comprobación aceptaba CUALQUIER resultado (de ahí las búsquedas erróneas).
      const contienePalabra = (texto: string, palabra: string) =>
        new RegExp(`(^|[^a-z0-9])${palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(texto);
      const soloLetras = (t: string) => t.replace(/[^a-z0-9]/g, '');
      const compactadoPedido = soloLetras(tituloPedido);
      const tokensCompactados = tituloItem.split(/\s+/).map(soloLetras).filter(Boolean);
      const palabrasFon = normalizarBase(claveFoneticaFrase(tituloItem)).split(/\s+/).filter(Boolean);

      if (tokens.length === 0) {
        // Título tipo "P.I.M.P.": se exige que alguna palabra del resultado sea exactamente
        // el título compactado (o su clave fonética). Nunca se acepta por defecto.
        if (compactadoPedido.length < 3) return false;
        return tokensCompactados.includes(compactadoPedido) ||
          tokensCompactados.includes(soloLetras(claveFonetica(tituloPedido)));
      }

      const cubiertos = tokens.filter(t => {
        if (contienePalabra(tituloItem, t)) return true;
        const kf = claveFonetica(t);
        return kf.length > 1 && palabrasFon.includes(kf);
      }).length;
      return cubiertos / tokens.length >= 0.5;
    }
    if (intent.artista) {
      const primera = normalizarBase(intent.artista).split(/\s+/)[0];
      return tituloItem.includes(primera) || normalizarBase(item.artist || '').includes(primera);
    }
    return true;
  };

  const pool: CatalogTrack[] = [];
  const idsVistos = new Set<string>();
  const puntuados: Array<{ item: CatalogTrack; puntaje: number; motivo: string; variante: string }> = [];
  let mejor: { item: CatalogTrack; puntaje: number; motivo: string; variante: string } | null = null;
  let fuenteBase = '';
  let fallos = 0;
  const usadas: Array<{ texto: string; origen: string }> = [];

  for (const variante of variantes) {
    usadas.push(variante);
    let resultado: MusicSearchResult | null = null;
    try {
      resultado = await searchYouTubeMusic(variante.texto, buscarComoArtista);
    } catch (e: any) {
      fallos++;
      anotar(`variante "${variante.texto}" (${variante.origen}) falló: ${e?.message || e}`);
      continue;
    }
    if (!resultado || !Array.isArray(resultado.items) || resultado.items.length === 0) {
      anotar(`variante "${variante.texto}" (${variante.origen}): 0 resultados`);
      continue;
    }
    if (!fuenteBase) fuenteBase = resultado.source || 'youtube';
    anotar(`variante "${variante.texto}" (${variante.origen}): ${resultado.items.length} candidatos`);

    resultado.items.forEach((item, idx) => {
      if (!item || !item.id || !isValidSongTitle(item.title)) return;
      if (!idsVistos.has(item.id)) { idsVistos.add(item.id); pool.push(item); }
      const base = scoreCandidateVideo(item, variante.texto, idx);
      const ctx = bonificacionContexto(item, {
        intent,
        consultaOriginal: intent.original,
        variante: variante.texto
      });
      const total = base + ctx.puntos;
      anotar(`   #${idx} "${item.title}" [${item.artist}] base=${base} contexto=${ctx.puntos} total=${total}` +
        (ctx.motivos.length ? ` (${ctx.motivos.join('; ')})` : ''));
      const evaluado = { item, puntaje: total, motivo: ctx.motivos.join('; ') || 'mejor puntuación', variante: variante.texto };
      puntuados.push(evaluado);
      if (!mejor || total > mejor.puntaje) mejor = evaluado;
    });

    if (mejor && mejor.puntaje >= UMBRAL_ALTA_CONFIANZA && cumpleExpectativa(mejor.item)) {
      anotar(`corte anticipado: coincidencia de alta confianza y coherente (${mejor.puntaje} >= ${UMBRAL_ALTA_CONFIANZA})`);
      break;
    }
  }

  // Sin resultados: distinguir fallo de red (para permitir el respaldo) de "no existe"
  if (pool.length === 0) {
    const fueError = fallos > 0 && fallos === variantes.length;
    anotar(fueError ? 'todas las variantes fallaron por error de red' : 'ninguna variante devolvió resultados');
    console.log('[BusquedaVoz] ' + diagnostico.join('\n[BusquedaVoz] '));
    return {
      items: [], source: fuenteBase || 'youtube', intent, variantes: usadas,
      confianza: 0, motivo: fueError ? 'Error de búsqueda' : 'Sin resultados en YouTube',
      diagnostico, error: fueError
    };
  }

  // Umbral: si se pidió una canción concreta y nada se le parece, NO se elige al azar
  const pidioCancionConcreta = !!intent.titulo && (intent.tipo === 'cancion' || intent.tipo === 'fragmento_letra');
  if (pidioCancionConcreta && mejor && mejor.puntaje < UMBRAL_MINIMO_CANCION) {
    anotar(`rechazado: la mejor coincidencia no es fiable (${mejor.puntaje} < ${UMBRAL_MINIMO_CANCION}) ` +
      `para la canción pedida "${intent.titulo}"`);
    console.log('[BusquedaVoz] ' + diagnostico.join('\n[BusquedaVoz] '));
    return {
      items: [], source: fuenteBase || 'youtube', intent, variantes: usadas,
      confianza: 0, motivo: `No encontré "${intent.titulo}" con suficiente confianza`,
      diagnostico, sinConfianza: true
    };
  }

  // Se prefiere el candidato que CUMPLE lo esencial (título/artista/género) aunque su
  // puntuación sea algo menor que la de un resultado con más palabras coincidentes.
  if (mejor && !cumpleExpectativa(mejor.item)) {
    const alternativa = puntuados
      .filter(c => cumpleExpectativa(c.item))
      .sort((a, b) => b.puntaje - a.puntaje)[0];
    if (alternativa) {
      anotar(`preferido "${alternativa.item.title}" (cumple la expectativa) sobre "${mejor.item.title}" (más puntaje pero no coincide)`);
      mejor = alternativa;
    }
  }

  const elegido = mejor!.item;
  const confianza = Math.max(0, Math.min(1, mejor!.puntaje / 2600));
  anotar(`ELEGIDO: "${elegido.title}" [${elegido.artist}] (${elegido.id}) puntaje=${mejor!.puntaje}` +
    ` confianza=${confianza.toFixed(2)} variante="${mejor!.variante}" motivo="${mejor!.motivo}"`);
  anotar(`candidatos totales evaluados: ${pool.length}`);
  console.log('[BusquedaVoz] ' + diagnostico.join('\n[BusquedaVoz] '));

  const ordenados = await buildArtistAndMixPlaylist(elegido, rawQuery, isArtistOnly);
  return {
    items: ordenados,
    firstTrack: elegido,
    source: `${fuenteBase || 'youtube'}+voz`,
    intent,
    variantes: usadas,
    confianza,
    motivo: mejor!.motivo,
    diagnostico
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metadatos por ID de video
 *
 * La cola de reproducción recibe a veces solo IDs (playlist nativa de YouTube,
 * extensión de Edge). Sin metadatos, la UI mostraba duraciones o textos como
 * "Canción de la lista". Este resolutor obtiene el nombre y el artista reales
 * directamente de YouTube, con caché para no repetir peticiones.
 * ────────────────────────────────────────────────────────────────────────── */

const VIDEO_META_TTL_MS = 6 * 60 * 60 * 1000;
const videoMetadataCache = new Map<string, { at: number; data: CatalogTrack | null }>();

function secondsToDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Extrae un objeto JSON balanceado que empieza en `marker` (p. ej. "videoDetails":). */
function extractJsonObjectAfter(source: string, marker: string): any | null {
  const markerIdx = source.indexOf(marker);
  if (markerIdx < 0) return null;
  const start = source.indexOf('{', markerIdx + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeVideoMetadata(videoId: string, rawTitle: string, rawArtist: string, thumbnail?: string, duration?: string): CatalogTrack | null {
  if (!rawTitle || isDurationOnlyString(rawTitle)) return null;

  // Separar "Artista - Canción" comparando sin puntuación: el canal suele venir
  // como "DrDreVEVO" y el título como "Dr. Dre - Still D.R.E.".
  const compareKey = (value: string) =>
    (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

  let titleInput = rawTitle.trim();
  let artistInput = (rawArtist || '').trim();
  if (titleInput.includes(' - ')) {
    const parts = titleInput.split(/\s*-\s*/);
    const possibleArtist = (parts[0] || '').trim();
    const possibleTitle = parts.slice(1).join(' - ').trim();
    const channelKey = compareKey(artistInput).replace(/vevo$|official$|topic$/, '');
    const candidateKey = compareKey(possibleArtist);
    if (
      candidateKey.length >= 2 &&
      possibleTitle.length >= 2 &&
      (channelKey.includes(candidateKey) || candidateKey.includes(channelKey))
    ) {
      artistInput = possibleArtist;
      titleInput = possibleTitle;
    }
  }

  const sanitized = sanitizeSongTitleAndArtist(titleInput, artistInput);
  const title = sanitized.title || (isValidSongTitle(titleInput) ? titleInput : '');
  if (!title) return null;
  const artist = sanitized.artist || artistInput;
  return {
    id: videoId,
    title,
    artist,
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: duration || ''
  };
}

function isDurationOnlyString(value: string): boolean {
  const t = (value || '').trim();
  return /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+)\s*$/.test(t);
}

/**
 * Obtiene título, artista, miniatura y duración reales de un video de YouTube.
 * Usa la página del video (videoDetails) y cae a oEmbed si YouTube bloquea el HTML.
 */
export async function fetchVideoMetadata(videoId: string): Promise<CatalogTrack | null> {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const cached = videoMetadataCache.get(videoId);
  if (cached && Date.now() - cached.at < VIDEO_META_TTL_MS) {
    return cached.data;
  }

  let meta: CatalogTrack | null = null;

  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=es&gl=ES`, {
      headers: {
        'User-Agent': YOUTUBE_USER_AGENT,
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });
    if (response.ok) {
      const html = await response.text();
      const details = extractJsonObjectAfter(html, '"videoDetails":');
      if (details && details.title) {
        const thumbnails = details?.thumbnail?.thumbnails;
        const thumbnail = Array.isArray(thumbnails) && thumbnails.length > 0
          ? thumbnails[thumbnails.length - 1]?.url
          : undefined;
        meta = normalizeVideoMetadata(
          videoId,
          String(details.title || ''),
          String(details.author || ''),
          thumbnail,
          secondsToDuration(Number(details.lengthSeconds))
        );
      }
    }
  } catch (err) {
    // Sin conexión o HTML bloqueado: se intenta oEmbed abajo.
  }

  if (!meta) {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
        { headers: { 'User-Agent': YOUTUBE_USER_AGENT, 'Accept-Language': 'es-ES,es;q=0.9' } }
      );
      if (response.ok) {
        const data: any = await response.json();
        meta = normalizeVideoMetadata(
          videoId,
          String(data?.title || ''),
          String(data?.author_name || ''),
          data?.thumbnail_url,
          ''
        );
      }
    } catch (err) {
      // Se guarda null para no reintentar en bucle durante esta sesión.
    }
  }

  // Solo se memorizan resultados/fracasos recientes para aliviar la carga.
  videoMetadataCache.set(videoId, { at: Date.now(), data: meta });
  if (videoMetadataCache.size > 500) {
    const oldest = videoMetadataCache.keys().next().value;
    if (oldest) videoMetadataCache.delete(oldest);
  }

  return meta;
}

