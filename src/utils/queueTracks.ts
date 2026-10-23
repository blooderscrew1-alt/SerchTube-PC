import { Track } from '../types';
import { isValidTrackTitleClient } from './youtube';

/**
 * Utilidades para que la cola de reproducción NUNCA muestre duraciones,
 * timestamps o marcadores de posición en lugar del nombre real de la canción.
 *
 * Contexto del fallo: la extensión de Edge y la playlist nativa del reproductor
 * entregan a veces el texto de duración ("4:04") en el campo `title` y dejan el
 * artista vacío. La cola lo pintaba tal cual, así que se veían filas como
 * "4:04 / Artista" en vez de "Nombre de la canción / Artista real".
 */

const PLACEHOLDER_TITLES = new Set([
  'cancion',
  'canción',
  'cancion de la lista',
  'canción de la lista',
  'cancion recomendada',
  'canción recomendada',
  'cancion sugerida',
  'canción sugerida',
  'video',
  'audio',
  'youtube',
  'artista',
  'artist',
  'musica',
  'música',
  'desconocido',
  'unknown',
  'null',
  'undefined',
  'track',
  'reproducir',
  'reproduce',
  'play',
  'en vivo',
  'live'
]);

const GENERIC_ARTISTS = new Set([
  'artista',
  'artist',
  'youtube',
  'desconocido',
  'unknown',
  'various artists',
  'varios artistas',
  'musica',
  'música'
]);

/** Normaliza para comparar sin tildes, mayúsculas ni puntuación. */
function normalizeLabel(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿El texto es SOLO una duración/timestamp? ("4:04", "01:02:40", "3 min"). */
export function isDurationOnlyTitle(title: string | undefined | null): boolean {
  if (!title) return false;
  const t = title.trim();
  if (!t) return false;
  return (
    /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+|\d+\s*:\s*\d+)\s*$/.test(t) ||
    /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+)\s*(?:min|mins|seg|segundos|seconds|sec|s|m)\s*$/i.test(t)
  );
}

/** ¿El texto es un marcador de posición genérico? ("Canción de la lista", "Artista"...). */
export function isPlaceholderTitle(title: string | undefined | null): boolean {
  const key = normalizeLabel(title);
  if (!key) return true;
  if (PLACEHOLDER_TITLES.has(key)) return true;
  return /^(?:cancion|canción|video|audio|youtube|artista|artist|musica|música)\s+(?:de\s+la\s+lista|recomendada|sugerida)$/i.test(
    key
  );
}

export function isGenericArtistLabel(artist: string | undefined | null): boolean {
  const key = normalizeLabel(artist);
  if (!key) return true;
  if (GENERIC_ARTISTS.has(key)) return true;
  return isDurationOnlyTitle(key);
}

/** Limpia sufijos de YouTube y timestamps iniciales de un título. */
function cleanRawTitle(raw: string): string {
  return (raw || '')
    .replace(/\s*[-–—|·:]\s*YouTube.*$/i, '')
    .replace(/\s+YouTube$/i, '')
    .replace(/www\.youtube\.com.*$/i, '')
    .trim()
    .replace(/^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d+:\d+)\s*[\s\-–—·|:]*\s*/i, '')
    .replace(/^(?:#?\d+[\s.-]+)+/, '')
    .trim();
}

/**
 * Devuelve una pista saneada. Si el título recibido no es un nombre real
 * (por ejemplo una duración), `title` queda vacío para que la app lo repare
 * con los metadatos reales de YouTube y la interfaz muestre un texto neutral.
 */
export function cleanQueueTrack(track: Track): Track {
  if (!track) return track;

  const rawTitle = cleanRawTitle(track.title || '');
  let title = rawTitle;
  let artist = (track.artist || '').trim();

  // "Artista - Canción" -> separar cuando el artista es genérico o está vacío.
  if (title.includes(' - ')) {
    const parts = title.split(/\s*-\s*/);
    if (parts.length >= 2 && parts[0].trim().length >= 2) {
      const possibleArtist = parts[0].trim();
      const possibleTitle = parts.slice(1).join(' - ').trim();
      if (!artist || isGenericArtistLabel(artist)) {
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

  const usableTitle =
    !!title &&
    !isDurationOnlyTitle(title) &&
    !isPlaceholderTitle(title) &&
    isValidTrackTitleClient(title);

  if (!usableTitle) title = '';
  if (isGenericArtistLabel(artist)) artist = '';

  return {
    ...track,
    title,
    artist,
    thumbnail:
      track.thumbnail && !track.thumbnail.includes('unsplash')
        ? track.thumbnail
        : track.id
          ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`
          : ''
  };
}

/** ¿Necesita esta pista que busquemos su nombre real por ID? */
export function needsTitleRepair(track: Track | null | undefined): boolean {
  if (!track || !track.id) return false;
  return cleanQueueTrack(track).title === '';
}

/** Título listo para pintar: nunca una duración ni un marcador vacío. */
export function getTrackDisplayTitle(track: Track | null | undefined): string {
  if (!track) return 'Sin pista';
  const cleaned = cleanQueueTrack(track);
  return cleaned.title || 'Canción de YouTube';
}

/** Artista listo para pintar, sin "Artista" ni cadenas vacías. */
export function getTrackDisplayArtist(track: Track | null | undefined): string {
  if (!track) return 'YouTube';
  const cleaned = cleanQueueTrack(track);
  return cleaned.artist || 'YouTube';
}

/**
 * Combina la pista de la cola con metadatos reales de YouTube sin pisar
 * información ya válida (por ejemplo un título correcto que llegó después).
 */
export function applyTrackMetadata(track: Track, meta: Partial<Track> | null | undefined): Track {
  if (!track) return track;
  const cleaned = cleanQueueTrack(track);
  const metaTitle = (meta?.title || '').trim();
  const metaArtist = (meta?.artist || '').trim();

  // Se sanea también el metadato: puede venir como "Artista - Canción".
  const metaTrack = cleanQueueTrack({
    id: track.id,
    title: metaTitle,
    artist: metaArtist,
    thumbnail: meta?.thumbnail || '',
    duration: meta?.duration || ''
  });

  const title = cleaned.title || metaTrack.title;
  const artist = cleaned.artist || metaTrack.artist;

  return {
    ...track,
    title,
    artist,
    thumbnail:
      track.thumbnail && !track.thumbnail.includes('unsplash')
        ? track.thumbnail
        : meta?.thumbnail || cleaned.thumbnail,
    duration: meta?.duration || track.duration || ''
  };
}
