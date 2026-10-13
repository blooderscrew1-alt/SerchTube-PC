/**
 * GOOGLE SEARCH & SPELL CORRECTOR ENGINE (SerchTube Music)
 * 
 * Utiliza los motores de sugerencia y corrección ortográfica en tiempo real de Google
 * (Google Search Web Suggest & Google Video/YouTube Suggest) para corregir y normalizar
 * las consultas de búsqueda de música y voz sin deformar el artista ni la canción.
 */

import {
  cleanSearchQuery,
  scrapeYouTubeVideos,
  scrapeYouTubeMix,
  hasAgeRestrictionMarkers,
  isYouTubeVideoRestricted,
  type CatalogTrack
} from './youtubeEngine.ts';
import { resolveMusicalContext } from './musicContextEngine.ts';
import {
  analizarPeticionVoz,
  bonificacionContexto,
  type ContextoPuntuacion
} from './voiceQueryEngine.ts';

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
 * Detecta si un video es un mix, enganchado, grandes éxitos o álbum completo
 */
export function isCompilationOrMix(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  const compilationPatterns = [
    /\bgrandes\s+[eé]xitos\b/i,
    /\bgreatest\s+hits\b/i,
    /\bmejores\s+canciones\b/i,
    /\bbest\s+songs\b/i,
    /\bdisco\s+completo\b/i,
    /\bfull\s+album\b/i,
    /\bcompleto\s+hd\b/i,
    /\bdiscograf[ií]a\b/i,
    /\bmix\s+(?:20\d\d|reggaeton|cumbia|rock|pop|romanticas|fiesta|exitos|enganchados)\b/i,
    /\benganchado\b/i,
    /\benganchados\b/i,
    /\btop\s+\d+\b/i,
    /\b\d+\s+grandes\s+[eé]xitos\b/i,
    /\b\d+\s+canciones\b/i,
    /\b\d+\s+hits\b/i
  ];
  for (const pattern of compilationPatterns) {
    if (pattern.test(lower)) return true;
  }
  return false;
}

/**
 * Comprueba si dos títulos corresponden a la misma canción para deduplicar
 */
export function areSameSong(titleA: string, titleB: string, requestedQuery?: string): boolean {
  if (!titleA || !titleB) return false;
  const cleanA = titleA.toLowerCase().replace(/[^a-z0-9\s]/gi, '').trim();
  const cleanB = titleB.toLowerCase().replace(/[^a-z0-9\s]/gi, '').trim();
  if (cleanA === cleanB) return true;
  if (cleanA.length > 5 && cleanB.length > 5) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  }
  return false;
}

/** Normaliza un título para comparar (sin acentos, sin puntuación, minúsculas) */
export function normalizarTitulo(t: string): string {
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Limpia las etiquetas de video o metadatos de un título para aislar el nombre puro de la canción */
export function limpiarNombreCancion(t: string): string {
  return (t || '')
    .replace(/[\[\(]?(?:official\s*(?:music\s*)?video|video\s*oficial|audio\s*oficial|official\s*audio|lyric\s*video|letra|video\s*con\s*letra|remaster(?:ed)?|4k|hd|hq|explicit|dirty\s*version|clean\s*version|uncensored|sin\s*censura|18\+|full\s*video)[\]\)]?/gi, '')
    .replace(/[\[\]\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Descompone un título y artista en su canción pura y artista puro,
 * eliminando etiquetas de video oficial, metadatos, etc.
 */
export function parseTrackInfo(rawTitle: string, rawArtist?: string): { pureSong: string; pureArtist: string } {
  const cleanT = limpiarNombreCancion(rawTitle);

  let pureArtist = (rawArtist || '')
    .replace(/vevo/gi, '')
    .replace(/\b(?:official|records|channel)\b/gi, '')
    .replace(/-?\s*topic\b/gi, '')
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let pureSong = cleanT;
  if (cleanT.includes(' - ')) {
    const parts = cleanT.split(' - ');
    if (parts.length >= 2) {
      const left = parts[0].trim();
      const right = parts.slice(1).join(' - ').trim();
      if (!pureArtist || normalizarTitulo(left).includes(normalizarTitulo(pureArtist)) || normalizarTitulo(pureArtist).includes(normalizarTitulo(left))) {
        pureArtist = pureArtist || left;
        pureSong = right;
      } else {
        pureSong = right;
      }
    }
  }

  return { pureSong: pureSong.trim(), pureArtist: pureArtist.trim() };
}

/**
 * Verifica si un candidato es con certeza la MISMA canción solicitada (mismo tema y mismo artista)
 */
export function isExactSameSong(candidate: CatalogTrack, targetSong: string, targetArtist?: string): boolean {
  if (!candidate || !candidate.title) return false;
  if (isEmbedRestrictedChannel(candidate.artist, candidate.title)) return false;
  if (isNonMusicVideo(candidate.title, candidate.duration)) return false;
  if (isCompilationOrMix(candidate.title)) return false;
  if (hasAgeRestrictionMarkers(candidate.title, candidate.artist)) return false;

  // Descartar versiones en vivo, covers, remixes o parodias si no fueron pedidos
  if (/\b(en vivo|live\s*(?:performance|version|stream|at|on)?|cover|remix|tribute|tributo|karaoke|instrumental|reaction|reacci[oó]n|parodia|interview|entrevista|behind the scenes|making of)\b/i.test(`${candidate.title} ${candidate.artist}`)) {
    return false;
  }

  const normTargetSong = normalizarTitulo(targetSong);
  if (!normTargetSong) return false;
  const compTargetSong = normTargetSong.replace(/\s+/g, '');

  const candParsed = parseTrackInfo(candidate.title, candidate.artist);
  const candNormSong = normalizarTitulo(candParsed.pureSong);
  const candCompSong = candNormSong.replace(/\s+/g, '');
  const candComb = normalizarTitulo(`${candidate.title} ${candidate.artist}`);

  // 1. Coincidencia del tema
  let songMatches = false;
  if (candNormSong === normTargetSong || candCompSong === compTargetSong) {
    songMatches = true;
  } else if (candComb.includes(normTargetSong)) {
    songMatches = true;
  } else {
    const songTokens = normTargetSong.split(' ').filter(t => t.length >= 2);
    if (songTokens.length > 0 && songTokens.every(tk => candComb.includes(tk))) {
      songMatches = true;
    }
  }

  if (!songMatches) return false;

  // 2. Coincidencia del artista (si se especificó artista)
  if (targetArtist) {
    const normTargetArtist = normalizarTitulo(targetArtist);
    const artistTokens = normTargetArtist.split(' ').filter(t => t.length >= 2);
    if (artistTokens.length > 0) {
      const hasArtist = artistTokens.every(tk => candComb.includes(tk));
      if (!hasArtist) return false;
    }
  }

  return true;
}

/**
 * Califica candidatos para seleccionar la mejor versión sin restricción de la misma canción
 * (Prioriza pistas oficiales de audio y YouTube Music Topic)
 */
export function scoreAlternativeCandidate(candidate: CatalogTrack, targetSong: string, targetArtist?: string): number {
  let score = 0;
  const candParsed = parseTrackInfo(candidate.title, candidate.artist);
  const normTargetSong = normalizarTitulo(targetSong);
  const candNormSong = normalizarTitulo(candParsed.pureSong);
  const candComb = `${candidate.title} ${candidate.artist}`.toLowerCase();

  // Coincidencia exacta de la canción
  if (candNormSong === normTargetSong) {
    score += 1500;
  } else {
    score += 800;
  }

  // 1. Canales "- Topic" automáticos de YouTube Music (audio de estudio oficial, 100% libre de restricciones de edad y de inserción)
  if (/-?\s*topic$/i.test(candidate.artist.trim())) {
    score += 1000;
  }

  // 2. Pistas de audio oficial
  if (/\b(?:audio\s*oficial|official\s*audio|\(audio\)|\baudio\b)\b/i.test(candidate.title)) {
    score += 800;
  }

  // 3. Videos con letra / lyric video
  if (/\b(?:lyric\s*video|letra|lyrics|video\s*con\s*letra)\b/i.test(candidate.title)) {
    score += 500;
  }

  // 4. Calidad HD / Remaster
  if (/\b(?:remaster(?:ed)?|hd|hq|original\s*mix)\b/i.test(candidate.title)) {
    score += 100;
  }

  // Si se verificó el artista
  if (targetArtist) {
    const normA = normalizarTitulo(targetArtist);
    if (normalizarTitulo(candidate.artist).includes(normA) || normalizarTitulo(candidate.title).includes(normA)) {
      score += 400;
    }
  }

  // Penalizaciones severas
  if (hasAgeRestrictionMarkers(candidate.title, candidate.artist)) score -= 5000;
  if (isEmbedRestrictedChannel(candidate.artist, candidate.title)) score -= 5000;
  if (isNonMusicVideo(candidate.title, candidate.duration)) score -= 4000;
  if (/\b(?:240p|360p|144p|low\s*quality|low\s*res|baja\s*calidad|calidad\s*baja)\b/i.test(candidate.title)) score -= 5000;
  if (isCompilationOrMix(candidate.title)) score -= 3000;
  if (/\b(live|en vivo|cover|remix|tribute|karaoke|instrumental)\b/i.test(candComb)) score -= 2000;

  return score;
}

/** Verifica con alta precisión si un candidato corresponde a la misma canción */
export function esMismaCancion(candTitle: string, candArtist: string, queryOrTitle: string): boolean {
  const combinedCand = `${candTitle || ''} ${candArtist || ''}`;
  const c = normalizarTitulo(limpiarNombreCancion(combinedCand));
  const q = normalizarTitulo(limpiarNombreCancion(queryOrTitle));
  if (!c || !q) return false;
  if (c === q || c.replace(/\s+/g, '') === q.replace(/\s+/g, '')) return true;
  const tokensQ = q.split(' ').filter(t => t.length >= 2);
  const tokensC = c.split(' ');
  if (tokensQ.length > 0 && tokensQ.every(tq => tokensC.includes(tq))) return true;
  return false;
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
 * Califica la relevancia musical de un candidato de video
 */
export function scoreCandidateVideo(
  item: CatalogTrack,
  query: string,
  indexInResults: number = 0,
  contexto?: ContextoPuntuacion
): number {
  let score = 100 - (indexInResults * 5);
  const title = (item.title || '').toLowerCase();
  const qLower = (query || '').toLowerCase();

  // Penalización estricta por canal con bloqueo de inserción (ej: NFL, NBA, FIFA) para evitar Error 150
  if (isEmbedRestrictedChannel(item.artist, item.title)) {
    score -= 3000;
  }

  // Penalización severa por marcas explícitas de restricción de edad
  if (hasAgeRestrictionMarkers(item.title, item.artist)) {
    score -= 3500;
  }

  // Prioridad máxima a la etiqueta de "video oficial" / "official video" cuando esté disponible
  if (/(?:video\s*oficial|official\s*(?:music\s*)?video|\(video oficial\)|\[video oficial\]|\(official video\)|\[official video\])/i.test(title)) {
    score += 1000;
  } else if (/audio\s*oficial|\(audio\)|official\s*audio/i.test(title)) {
    score += 700;
  } else if (/- topic$/i.test((item.artist || '').trim())) {
    score += 650;
  } else if (/visualizer|lyric\s*video|letra|video\s*con\s*letra/i.test(title)) {
    score += 500;
  } else if (/(official|oficial)/i.test(title)) {
    score += 400;
  }
  if (isNonMusicVideo(item.title, item.duration)) {
    score -= 100;
  }
  if (isCompilationOrMix(item.title)) {
    score -= 30;
  }
  if (title.includes(qLower)) {
    score += 20;
  }
  // Señales de la petición de voz (título, artista, fonética ES<->EN, género y variante)
  if (contexto) {
    score += bonificacionContexto(item, contexto).puntos;
  }
  return score;
}

export interface GoogleCorrectionResult {
  originalQuery: string;
  correctedQuery: string;
  changed: boolean;
  source: 'google_chrome' | 'google_youtube' | 'verified_intact';
  suggestions: string[];
}

// Caché en memoria para respuestas instantáneas
const correctionCache = new Map<string, GoogleCorrectionResult>();
const MAX_CACHE_SIZE = 500;

/**
 * Consulta la API de sugerencias y corrección ortográfica de Google Chrome (Web Search)
 */
async function fetchGoogleChromeSuggestions(query: string, timeoutMs: number = 700): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `https://suggestqueries.google.com/complete/search?client=chrome&hl=es&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return data[1].map((s: any) => String(s).trim()).filter(Boolean);
      }
    }
  } catch {
    // Timeout o error de red seguro
  }
  return [];
}

/**
 * Consulta la API de sugerencias musicales y de video de Google / YouTube
 */
async function fetchGoogleYouTubeSuggestions(query: string, timeoutMs: number = 700): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=es&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      const s = text.indexOf('(');
      const e = text.lastIndexOf(')');
      if (s !== -1 && e !== -1) {
        const parsed = JSON.parse(text.substring(s + 1, e));
        if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
          return parsed[1]
            .map((item: any) => (Array.isArray(item) ? String(item[0]).trim() : String(item).trim()))
            .filter(Boolean);
        }
      }
    }
  } catch {
    // Timeout o error seguro
  }
  return [];
}

/**
 * Calcula la similitud básica de palabras o typos (Levenshtein simple para evitar dependencias pesadas)
 */
function levenshteinDist(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Analiza las sugerencias de Google y determina la corrección ortográfica o contextual más precisa.
 * REGLA FUNDAMENTAL: Jamás sustituir palabras por canciones o artistas no relacionados.
 */
export async function correctQueryWithGoogle(rawQuery: string): Promise<GoogleCorrectionResult> {
  const clean = cleanSearchQuery(rawQuery).trim();
  if (!clean) {
    return {
      originalQuery: rawQuery,
      correctedQuery: rawQuery,
      changed: false,
      source: 'verified_intact',
      suggestions: []
    };
  }

  const cacheKey = clean.toLowerCase();
  if (correctionCache.has(cacheKey)) {
    return correctionCache.get(cacheKey)!;
  }

  // 1. Obtener sugerencias en paralelo de Google Web y Google YouTube
  const [chromeSugs, ytSugs] = await Promise.all([
    fetchGoogleChromeSuggestions(clean),
    fetchGoogleYouTubeSuggestions(clean)
  ]);

  const allSuggestions = Array.from(new Set([...ytSugs, ...chromeSugs]));
  const cleanLower = clean.toLowerCase();

  let corrected = clean;
  let changed = false;
  let source: 'google_chrome' | 'google_youtube' | 'verified_intact' = 'verified_intact';

  // 2. Verificar si la primera sugerencia de Google corrige un error ortográfico directo
  // Caso A: Error ortográfico evidente (ej: "neberita" -> "neverita", "despasito" -> "despacito")
  const firstChrome = chromeSugs[0]?.toLowerCase().trim();
  const firstYt = ytSugs[0]?.toLowerCase().trim();

  // Si la primera sugerencia de Chrome tiene una distancia Levenshtein pequeña y longitud similar
  if (firstChrome && firstChrome !== cleanLower) {
    const dist = levenshteinDist(cleanLower, firstChrome);
    // Si la distancia es pequeña respecto a la longitud (typo de 1 o 2 letras)
    if (dist > 0 && dist <= 2 && Math.abs(cleanLower.length - firstChrome.length) <= 2) {
      corrected = chromeSugs[0];
      changed = true;
      source = 'google_chrome';
    }
  }

  // Si Chrome no corrigió pero YouTube sí tiene una corrección ortográfica cercana
  if (!changed && firstYt && firstYt !== cleanLower) {
    const dist = levenshteinDist(cleanLower, firstYt);
    if (dist > 0 && dist <= 2 && Math.abs(cleanLower.length - firstYt.length) <= 2) {
      corrected = ytSugs[0];
      changed = true;
      source = 'google_youtube';
    }
  }

  // Caso B: Corrección de frases compuestas con error de artista (ej: "bad boni neverita" -> "bad bunny neverita")
  if (!changed) {
    // Si alguna sugerencia de Google contiene las palabras corregidas de la consulta original
    for (const sug of allSuggestions.slice(0, 5)) {
      const sugLower = sug.toLowerCase();
      // Ver si es una corrección multi-palabra directa de longitud similar
      const wordsQuery = cleanLower.split(/\s+/);
      const wordsSug = sugLower.split(/\s+/);

      if (wordsQuery.length >= 2 && wordsQuery.length === wordsSug.length) {
        let totalDist = 0;
        for (let i = 0; i < wordsQuery.length; i++) {
          totalDist += levenshteinDist(wordsQuery[i], wordsSug[i]);
        }
        if (totalDist > 0 && totalDist <= 3) {
          corrected = sug;
          changed = true;
          source = chromeSugs.includes(sug) ? 'google_chrome' : 'google_youtube';
          break;
        }
      }
    }
  }

  // Caso C: Si la consulta original ya es una palabra exacta o está en sugerencias (ej: "neverita")
  // NO modificar la consulta arbitrariamente para no deformarla.
  if (!changed) {
    // Si la consulta ya es correcta y coincide exactamente con alguna sugerencia
    const exactMatch = allSuggestions.find(s => s.toLowerCase() === cleanLower);
    if (exactMatch) {
      corrected = exactMatch;
      changed = false;
      source = 'verified_intact';
    }
  }

  const result: GoogleCorrectionResult = {
    originalQuery: clean,
    correctedQuery: corrected,
    changed,
    source,
    suggestions: allSuggestions.slice(0, 8)
  };

  // Guardar en caché
  if (correctionCache.size >= MAX_CACHE_SIZE) {
    const firstKey = correctionCache.keys().next().value;
    if (firstKey) correctionCache.delete(firstKey);
  }
  correctionCache.set(cacheKey, result);

  if (changed) {
    console.log(`[GoogleCorrector] ✅ Corrección de Google aplicada: "${clean}" -> "${corrected}" (Fuente: ${source})`);
  } else {
    console.log(`[GoogleCorrector] ℹ️ Consulta verificada por Google: "${clean}"`);
  }

  return result;
}

/**
 * Busca y resuelve el video musical exacto a partir del buscador de Google y YouTube,
 * utilizando el corrector ortográfico de Google como paso inicial.
 */
export async function searchGoogleForVideo(
  rawQuery: string,
  isArtistOnly: boolean = false
): Promise<{
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
  items?: CatalogTrack[];
} | null> {
  const clean = cleanSearchQuery(rawQuery).trim();
  if (!clean) return null;

  // 1. Corrector ortográfico de Google (Google Search & Suggest Corrector)
  const correction = await correctQueryWithGoogle(clean);
  const effectiveQuery = correction.correctedQuery || clean;

  console.log(`[GoogleSearch] 🔍 Buscando en Google/YouTube: "${effectiveQuery}" (Original: "${rawQuery}", isArtistOnly: ${isArtistOnly})`);

  try {
    // 2. Búsqueda directa en YouTube con la consulta verificada por Google
    // Enriquecer la consulta con términos musicales para garantizar que YouTube devuelva música real y no podcasts/gameplays
    const hasMusicHint = /(cancion|canción|tema|audio|video|official|oficial|letra|lyrics|musica|música|album|disco|remix|en vivo|live|acoustic|acustico|greatest hits|exitos|éxitos)/i.test(effectiveQuery);
    const searchQuery = isArtistOnly
      ? (hasMusicHint ? effectiveQuery : `${effectiveQuery} greatest hits video oficial`)
      : (hasMusicHint ? effectiveQuery : `${effectiveQuery} video oficial`);

    const directVideos = await scrapeYouTubeVideos(searchQuery, 14);

    // Filtrar estrictamente cualquier resultado que no sea música
    const musicOnlyVideos = directVideos.filter(v => !isNonMusicVideo(v.title, v.duration));
    const candidateList = musicOnlyVideos.length > 0 ? musicOnlyVideos : directVideos;

    if (candidateList.length > 0) {
      // Contexto de la petición de voz (título, artista, fonética ES<->EN, variante)
      const contextoVoz: ContextoPuntuacion = {
        intent: analizarPeticionVoz(rawQuery),
        consultaOriginal: rawQuery,
        variante: effectiveQuery
      };
      // Calificar y ordenar candidatos para seleccionar la pista de música exacta
      const scored = candidateList.map((item, idx) => ({
        item,
        score: scoreCandidateVideo(item, effectiveQuery, idx, contextoVoz)
      }));
      scored.sort((a, b) => b.score - a.score);
      let topTrack = scored[0].item;

      // Verificación en tiempo real anti-restricción de edad para el video #1:
      // Solo si el video oficial seleccionado está marcado con LOGIN_REQUIRED o restricción de edad,
      // el sistema lo sustituye automáticamente por la versión de audio/topic limpia de LA MISMA CANCIÓN.
      const isTopRestricted = await isYouTubeVideoRestricted(topTrack.id);
      if (isTopRestricted) {
        console.warn(`[GoogleSearch] 🛡️ El video oficial "${topTrack.title}" (${topTrack.id}) tiene restricción de edad. Buscando copia sin restricción de la MISMA canción...`);

        const { pureSong, pureArtist } = parseTrackInfo(topTrack.title, topTrack.artist);
        const searchBaseSong = pureSong || limpiarNombreCancion(effectiveQuery);
        const searchBaseArtist = pureArtist || '';

        // Buscar alternativas limpias (audio/topic/lyrics) de LA MISMA CANCIÓN sin la etiqueta que causó restricción
        const altQueries = [
          `${searchBaseArtist} ${searchBaseSong} audio`.trim(),
          `${searchBaseArtist} ${searchBaseSong} topic`.trim(),
          `${searchBaseSong} topic`.trim(),
          `${searchBaseArtist} ${searchBaseSong} lyrics`.trim(),
          `${searchBaseArtist} ${searchBaseSong}`.trim()
        ].filter((q, i, arr) => q.length > 2 && arr.indexOf(q) === i);

        const candidatePool: CatalogTrack[] = [];
        const seenCandidateIds = new Set<string>([topTrack.id]);

        // 1. Incluir también los otros candidatos iniciales que no sean el topTrack restringido
        for (let i = 1; i < scored.length; i++) {
          const item = scored[i].item;
          if (item && item.id && !seenCandidateIds.has(item.id)) {
            seenCandidateIds.add(item.id);
            candidatePool.push(item);
          }
        }

        // 2. Obtener candidatos de las consultas limpias (audio, topic, lyrics)
        for (const fq of altQueries) {
          try {
            const items = await scrapeYouTubeVideos(fq, 8);
            for (const it of items) {
              if (it && it.id && !seenCandidateIds.has(it.id)) {
                seenCandidateIds.add(it.id);
                candidatePool.push(it);
              }
            }
          } catch {}
          if (candidatePool.length >= 25) break;
        }

        // 3. Filtrar y calificar rigurosamente para garantizar que sea LA MISMA CANCIÓN
        const viableAlternatives = candidatePool
          .filter(cand =>
            !isEmbedRestrictedChannel(cand.artist, cand.title) &&
            !isNonMusicVideo(cand.title, cand.duration) &&
            !hasAgeRestrictionMarkers(cand.title, cand.artist) &&
            isExactSameSong(cand, searchBaseSong, searchBaseArtist)
          )
          .map(cand => ({
            cand,
            score: scoreAlternativeCandidate(cand, searchBaseSong, searchBaseArtist)
          }))
          .sort((a, b) => b.score - a.score);

        // 4. Elegir la mejor alternativa confirmada libre de restricciones
        let foundCleanSameSong: CatalogTrack | null = null;
        for (const alt of viableAlternatives) {
          if (alt.score <= -500) break;
          const restricted = await isYouTubeVideoRestricted(alt.cand.id);
          if (!restricted) {
            foundCleanSameSong = alt.cand;
            console.log(`[GoogleSearch] ✅ Encontrada versión alternativa de la MISMA canción: "${alt.cand.title}" [${alt.cand.artist}] (${alt.cand.id})`);
            break;
          }
        }

        if (foundCleanSameSong) {
          topTrack = foundCleanSameSong;
        } else {
          console.warn(`[GoogleSearch] No se encontró copia alternativa verificada; se mantiene "${topTrack.title}" para no cambiar de tema.`);
        }
      }

      console.log(`[GoogleSearch] 🎯 Video musical resuelto #1: "${topTrack.title}" (${topTrack.id}) - Artista: "${topTrack.artist}"`);

      const fullPlaylist: CatalogTrack[] = [topTrack];
      const seenIds = new Set<string>([topTrack.id]);

      // Función de deduplicación estricta para evitar cualquier repetición de la misma canción y contenido no musical
      const isDuplicate = (cand: CatalogTrack): boolean => {
        if (!cand || !cand.id || seenIds.has(cand.id)) return true;
        if (isEmbedRestrictedChannel(cand.artist, cand.title)) return true;
        if (isCompilationOrMix(cand.title) || isNonMusicVideo(cand.title, cand.duration)) return true;

        // Descartar si es una versión repetida de la canción inicial (#1)
        if (!isArtistOnly && areSameSong(cand.title, topTrack.title, effectiveQuery)) {
          return true;
        }

        // Descartar si ya existe una versión de esta misma canción en la cola
        for (const existing of fullPlaylist) {
          if (areSameSong(cand.title, existing.title)) {
            return true;
          }
        }
        return false;
      };

      if (isArtistOnly) {
        // CASO A: El usuario pidió un artista completo -> armar grandes éxitos
        for (const t of directVideos.slice(1)) {
          if (!isDuplicate(t)) {
            seenIds.add(t.id);
            fullPlaylist.push(t);
            if (fullPlaylist.length >= 25) break;
          }
        }
      } else {
        // CASO B: El usuario pidió una canción específica
        // REGLA CRÍTICA: La canción pedida va en la posición #1.
        // Las siguientes posiciones son del mismo artista o canciones afines de la búsqueda directa en YouTube,
        // deduplicadas y filtradas para evitar repeticiones.
        for (const t of directVideos.slice(1)) {
          if (!isDuplicate(t)) {
            seenIds.add(t.id);
            fullPlaylist.push(t);
            if (fullPlaylist.length >= 20) break;
          }
        }
      }

      console.log(`[GoogleSearch] 🎵 Cola generada para "${effectiveQuery}": ${fullPlaylist.length} canciones únicas y variadas.`);

      return {
        videoId: topTrack.id,
        title: topTrack.title,
        artist: topTrack.artist,
        thumbnail: topTrack.thumbnail,
        duration: topTrack.duration,
        items: fullPlaylist
      };
    }
  } catch (err) {
    console.error("[GoogleSearch] Error en búsqueda de video en Google/YouTube:", err);
  }

  return null;
}

