import { VideoQuality } from '../types';

export interface QualityOption {
  id: VideoQuality;
  label: string;
  shortLabel: string;
  resolution: string;
  badge?: string;
  isHD?: boolean;
  description: string;
  isMinimum?: boolean;
}

export const MIN_RESOLUTION_LABEL = '480p';

/**
 * Niveles de calidad aceptables en la API de YouTube que cumplen el estándar de 480p o superior:
 * - highres: 4320p / 2160p (4K) / 1440p
 * - hd2880: 2880p
 * - hd2160: 2160p
 * - hd1440: 1440p
 * - hd1080: 1080p Full HD
 * - hd720: 720p HD
 * - large: 480p Definición Estándar (mínimo exigido)
 */
export const ACCEPTABLE_480P_QUALITIES: readonly string[] = [
  'highres',
  'hd2880',
  'hd2160',
  'hd1440',
  'hd1080',
  'hd720',
  'large'
];

/** Calidades de resolución estrictamente inferiores a 480p que deben evitarse */
export const SUB_480P_QUALITIES: readonly string[] = [
  'medium', // 360p
  'small',  // 240p
  'tiny'    // 144p
];

/**
 * Comprueba si la lista de calidades disponibles informada por YouTube incluye
 * al menos una opción de 480p o superior.
 */
export function hasAtLeast480pOption(levels?: string[]): boolean {
  if (!levels || levels.length === 0) return true; // Si aún no hay datos de búfer, no prejuzgar
  return levels.some(lvl => ACCEPTABLE_480P_QUALITIES.includes(lvl));
}

/**
 * Comprueba si una calidad específica es inferior a 480p (360p, 240p o 144p).
 */
export function isQualityBelow480p(quality?: string): boolean {
  if (!quality) return false;
  return SUB_480P_QUALITIES.includes(quality);
}

/**
 * Devuelve la etiqueta de la resolución máxima disponible en una lista de niveles de YouTube.
 */
export function getHighestQualityLabel(levels?: string[]): string {
  if (!levels || levels.length === 0) return 'Desconocida';
  if (levels.includes('highres') || levels.includes('hd2160')) return '4K / UHD';
  if (levels.includes('hd1440')) return '1440p 2K';
  if (levels.includes('hd1080')) return '1080p Full HD';
  if (levels.includes('hd720')) return '720p HD';
  if (levels.includes('large')) return '480p SD';
  if (levels.includes('medium')) return '360p (baja)';
  if (levels.includes('small')) return '240p (muy baja)';
  if (levels.includes('tiny')) return '144p (mínima)';
  return levels[0] || 'Desconocida';
}

export const VIDEO_QUALITY_OPTIONS: QualityOption[] = [
  {
    id: 'auto',
    label: 'Automática (Mínimo 480p)',
    shortLabel: 'Auto',
    resolution: 'Adaptativa (≥480p)',
    description: 'Ajusta la calidad según la red, garantizando al menos 480p.',
    badge: 'AUTO'
  },
  {
    id: 'highres',
    label: '4K / Máxima Disponible',
    shortLabel: '4K / Max',
    resolution: '2160p / 1440p',
    badge: 'UHD',
    isHD: true,
    description: 'Máxima nitidez para pantallas de alta resolución.'
  },
  {
    id: 'hd1080',
    label: '1080p Full HD',
    shortLabel: '1080p',
    resolution: '1920x1080',
    badge: '1080p HD',
    isHD: true,
    description: 'Calidad cristalina para pantallas grandes y cuadros de instrumentos.'
  },
  {
    id: 'hd720',
    label: '720p HD',
    shortLabel: '720p',
    resolution: '1280x720',
    badge: '720p HD',
    isHD: true,
    description: 'Excelente equilibrio entre nitidez HD y fluidez de carga.'
  },
  {
    id: 'large',
    label: '480p Definición Estándar (Mínimo)',
    shortLabel: '480p',
    resolution: '854x480',
    badge: '480p',
    isMinimum: true,
    description: 'Calidad estándar mínima permitida en SerchTube.'
  }
];

export const PLAYBACK_SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x (Lento)' },
  { value: 0.75, label: '0.75x' },
  { value: 1.0, label: '1.0x (Normal)' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x (Rápido)' },
  { value: 1.75, label: '1.75x' },
  { value: 2.0, label: '2.0x (Doble)' }
];

export function getQualityOption(quality: VideoQuality | string): QualityOption {
  // Si se solicita una calidad menor a 480p, elevarla al mínimo permitido (480p)
  if (quality === 'medium' || quality === 'small' || quality === 'tiny') {
    return {
      id: 'large',
      label: '480p Definición Estándar (Mínimo)',
      shortLabel: '480p',
      resolution: '854x480',
      badge: '480p',
      isMinimum: true,
      description: 'Elevado a 480p (resolución mínima permitida en SerchTube).'
    };
  }

  const found = VIDEO_QUALITY_OPTIONS.find(q => q.id === quality);
  return (
    found || {
      id: (quality as VideoQuality) || 'auto',
      label: quality || 'Automática (≥480p)',
      shortLabel: quality || 'Auto',
      resolution: quality || 'Auto',
      description: 'Resolución activa'
    }
  );
}

export function parseQualityFromText(text: string): VideoQuality | null {
  const lower = text.toLowerCase();
  if (lower.includes('1080') || lower.includes('full hd') || lower.includes('máxima') || lower.includes('maxima') || lower.includes('ultra')) {
    return 'hd1080';
  }
  if (lower.includes('720') || lower.includes('alta') || lower.includes(' hd')) {
    return 'hd720';
  }
  if (lower.includes('480') || lower.includes('estandar') || lower.includes('estándar') || lower.includes('media')) {
    return 'large';
  }
  // Peticiones de calidades menores a 480p (360p, 240p, 144p) se ajustan al mínimo permitido de 480p
  if (lower.includes('360') || lower.includes('240') || lower.includes('144') || lower.includes('baja') || lower.includes('mínima') || lower.includes('minima')) {
    return 'large';
  }
  if (lower.includes('4k') || lower.includes('uhd') || lower.includes('highres')) {
    return 'highres';
  }
  if (lower.includes('auto') || lower.includes('automática') || lower.includes('automatica') || lower.includes('adaptativa')) {
    return 'auto';
  }
  return null;
}
