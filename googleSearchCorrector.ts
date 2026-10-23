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
  buildArtistAndMixPlaylist,
  hasAgeRestrictionMarkers,
  isYouTubeVideoRestricted,
  isValidSongTitle,
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
 * Realiza una búsqueda directa en Google.com (sección Videos: tbm=vid) con la frase
 * completa ingresada por el usuario SIN modificaciones ni correcciones artificiales.
 * Extrae los videos musicales de YouTube proporcionados directamente por Google.
 */
export async function scrapeGoogleVideosSection(
  phrase: string,
  limit: number = 14
): Promise<CatalogTrack[]> {
  const query = phrase.trim();
  if (!query) return [];

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=vid&hl=es`;
  console.log(`[GoogleVideos] 🌐 Consultando Google.com (sección Videos) con la frase completa sin correcciones: "${query}"`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Opera/9.80 (J2ME/MIDP; Opera Mini/4.2.14912/870; U; id) Presto/2.4.15 Version/10.00',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[GoogleVideos] HTTP ${res.status} al consultar Google Videos.`);
      return [];
    }

    const text = await res.text();
    // Expresión regular que tolera comillas simples, dobles o sin comillas en href
    const re = /<a\s+[^>]*?href=([\"\']?)([^\"\'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi;

    // Agrupar por videoId para unificar los badges de duración y los encabezados con el título real
    const videoMap = new Map<string, {
      id: string;
      title: string;
      artist: string;
      duration: string;
      thumbnail: string;
    }>();

    let match;
    while ((match = re.exec(text)) !== null) {
      const rawHref = match[2].replace(/&amp;/g, '&');
      const decodedHref = decodeURIComponent(rawHref);

      if (!decodedHref.includes('youtube.com/watch') && !decodedHref.includes('youtu.be/')) {
        continue;
      }

      const mId = decodedHref.match(/(?:watch\?v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
      if (!mId) continue;
      const videoId = mId[1];

      const rawText = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.toLowerCase().startsWith('http')) continue;

      // 🛡️ DETECCIÓN DE DURACIÓN / TIMESTAMP: Si el texto dentro del enlace es solo un minutero ("3:18", "05:15", "1:02:40", "3:18 min")
      // se asigna como 'duration', PERO JAMÁS se utiliza como título de la canción.
      const isTimestamp =
        /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+|\d+\s*:\s*\d+)\s*$/.test(rawText) ||
        /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+)\s*(?:min|mins|seg|s|m)\b/i.test(rawText);

      if (!videoMap.has(videoId)) {
        videoMap.set(videoId, {
          id: videoId,
          title: '',
          artist: '',
          duration: isTimestamp ? rawText : '3:45',
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        });
      }

      const entry = videoMap.get(videoId)!;

      if (isTimestamp) {
        entry.duration = rawText;
        continue;
      }

      // Si es un título válido (no duración, no URL, no comodín genérico)
      if (isValidSongTitle(rawText)) {
        const cleanTitle = rawText
          .replace(/\s*-\s*YouTube.*$/i, '')
          .replace(/www\.youtube\.com.*$/i, '')
          .replace(/^[0-9]+:\s*/, '')
          .trim();

        if (cleanTitle.length >= 2 && !isNonMusicVideo(cleanTitle)) {
          // Si aún no tenemos título o este nuevo título es más largo/descriptivo
          if (!entry.title || cleanTitle.length > entry.title.length) {
            let title = cleanTitle;
            let artist = '';
            if (cleanTitle.includes(' - ')) {
              const parts = cleanTitle.split(/\s*-\s*/);
              if (parts.length >= 2 && parts[0].trim().length >= 2) {
                artist = parts[0].trim();
                title = parts.slice(1).join(' - ').trim();
              }
            }
            entry.title = title || cleanTitle;
            if (artist) entry.artist = artist;
            else if (!entry.artist) entry.artist = query;
          }
        }
      }
    }

    const items: CatalogTrack[] = [];
    for (const v of videoMap.values()) {
      // 🛡️ REGLA ESTRICTA: Descartar si el título quedó vacío o no es un título válido de canción
      if (!v.title || !isValidSongTitle(v.title)) continue;
      if (isNonMusicVideo(v.title)) continue;
      if (/\b(?:240p|360p|144p|low\s*quality|low\s*res|baja\s*calidad)\b/i.test(v.title)) continue;

      let artist = v.artist.trim();
      if (!artist || artist.toLowerCase() === 'artista' || artist.toLowerCase() === 'youtube') {
        artist = query;
      }

      items.push({
        id: v.id,
        title: v.title,
        artist,
        thumbnail: v.thumbnail,
        duration: v.duration || '3:45'
      });

      if (items.length >= limit) break;
    }

    console.log(`[GoogleVideos] ✅ Google Videos devolvió ${items.length} videos musicales válidos para "${query}".`);
    return items;
  } catch (err: any) {
    clearTimeout(timer);
    console.warn(`[GoogleVideos] Error o timeout al consultar Google Videos: ${err?.message}`);
    return [];
  }
}

/**
 * Busca y resuelve el video musical exacto a partir del buscador de Google.com (sección Videos),
 * buscando la frase completa ingresada por el usuario sin correcciones ni deformaciones.
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
  const query = rawQuery.trim();
  if (!query) return null;

  console.log(`[GoogleSearch] 🔍 Buscando frase completa SIN correcciones en Google.com sección Videos: "${query}" (isArtistOnly: ${isArtistOnly})`);

  // 1. Consultar Google.com sección Videos con la frase completa sin correcciones
  let googleVideos = await scrapeGoogleVideosSection(query, 14);

  // 2. Si Google Videos devolvió resultados, usar el primer video musical que Google proporciona
  if (googleVideos.length > 0) {
    let topTrack = googleVideos[0];

    // Verificación en tiempo real anti-restricción de edad
    const isTopRestricted = await isYouTubeVideoRestricted(topTrack.id);
    if (isTopRestricted) {
      console.warn(`[GoogleSearch] 🛡️ El video "${topTrack.title}" (${topTrack.id}) de Google tiene restricción de edad. Usando alternativa limpia...`);
      const viableAlt = googleVideos.slice(1).find(v => !hasAgeRestrictionMarkers(v.title, v.artist));
      if (viableAlt) {
        topTrack = viableAlt;
      }
    }

    console.log(`[GoogleSearch] 🎯 Video musical resuelto en Google Videos #1: "${topTrack.title}" (${topTrack.id}) - Artista: "${topTrack.artist}"`);

    // Construir la cola continua con la lista de reproducción del artista y YouTube Mix,
    // pasando los otros videos válidos de Google como candidatos adicionales
    const otherGoogleVideos = googleVideos.filter(v => v.id !== topTrack.id);
    const fullPlaylist = await buildArtistAndMixPlaylist(topTrack, query, isArtistOnly, otherGoogleVideos);

    return {
      videoId: topTrack.id,
      title: topTrack.title,
      artist: topTrack.artist,
      thumbnail: topTrack.thumbnail,
      duration: topTrack.duration,
      items: fullPlaylist
    };
  }

  // 3. Respaldo directo en YouTube con la frase exacta sin correcciones en caso de fallo de red
  try {
    console.log(`[GoogleSearch] 🔄 Respaldo en YouTube directo con la frase exacta: "${query}"`);
    const directVideos = await scrapeYouTubeVideos(query, 14);
    const musicOnly = directVideos.filter(v => !isNonMusicVideo(v.title, v.duration));
    const candidates = musicOnly.length > 0 ? musicOnly : directVideos;

    if (candidates.length > 0) {
      const top = candidates[0];
      const fullPlaylist = await buildArtistAndMixPlaylist(top, query, isArtistOnly);
      return {
        videoId: top.id,
        title: top.title,
        artist: top.artist,
        thumbnail: top.thumbnail,
        duration: top.duration,
        items: fullPlaylist
      };
    }
  } catch (err) {
    console.error("[GoogleSearch] Error en búsqueda de respaldo en YouTube:", err);
  }

  return null;
}


