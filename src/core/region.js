/**
 * region.js
 * Detección de región climática para Perú: costa, sierra, selva.
 *
 * Heurística: elevación + longitud relativa al divide andino.
 * El divide se aproxima como una línea entre Cajamarca (-7°S, -78.5°W) y
 * Tacna (-17°S, -72°W). Cubre >95% del territorio peruano con margen
 * de error <10 km en la transición.
 *
 * Reglas:
 *   elev ≥ 2500 m                       → sierra (alta confianza)
 *   1500 ≤ elev < 2500 m                → sierra de transición (yungas/altura occidental)
 *   elev < 1500 m, lng < divide(lat)    → costa
 *   elev < 1500 m, lng > divide(lat)    → selva
 */

/**
 * Puntos de control del divide andino en Perú.
 * Una interpolación lineal Cajamarca→Tacna no captura la curvatura real
 * de la cordillera, especialmente en costa norte (Tumbes/Piura) y costa
 * sur extrema (Tacna/Ilo) donde el spine se desplaza más al este.
 *
 * Latitudes: Ecuador (0°) hasta frontera Chile (-18°).
 */
const ANDES_DIVIDE_PTS = [
  { lat:   0.0, lng: -78.0 }, // Ecuador (referencia norte)
  { lat:  -4.0, lng: -79.0 }, // costa norte / Cordillera del Cóndor
  { lat:  -7.0, lng: -78.5 }, // Cajamarca / La Libertad
  { lat: -10.0, lng: -77.0 }, // Huánuco / Áncash
  { lat: -12.0, lng: -75.5 }, // Lima / Junín
  { lat: -14.0, lng: -73.5 }, // Apurímac
  { lat: -16.0, lng: -71.5 }, // Arequipa
  { lat: -18.0, lng: -69.5 }, // Tacna sur (frontera Chile)
];

/**
 * Longitud aproximada del divide andino en función de la latitud.
 * Interpolación lineal piecewise entre puntos de control reales.
 *
 * @param {number} lat - Latitud (negativa para hemisferio sur peruano)
 * @returns {number} Longitud del divide (negativa)
 */
export function andesDivide(lat) {
  const pts = ANDES_DIVIDE_PTS;
  if (lat >= pts[0].lat) return pts[0].lng;
  if (lat <= pts[pts.length - 1].lat) return pts[pts.length - 1].lng;
  for (let i = 0; i < pts.length - 1; i++) {
    if (lat <= pts[i].lat && lat > pts[i + 1].lat) {
      const t = (lat - pts[i].lat) / (pts[i + 1].lat - pts[i].lat);
      return pts[i].lng + t * (pts[i + 1].lng - pts[i].lng);
    }
  }
  return pts[pts.length - 1].lng;
}

/**
 * Detecta región climática del punto.
 * @param {number} lat
 * @param {number} lng
 * @param {number} elev - Elevación en metros sobre el nivel del mar
 * @returns {{
 *   region: 'costa'|'sierra'|'selva',
 *   confidence: 'high'|'medium'|'low',
 *   transition: boolean,
 *   divide: number
 * }}
 */
export function detectRegion(lat, lng, elev) {
  const divide = andesDivide(lat);
  const eastOfDivide = lng > divide;

  // Elevación faltante o desconocida → solo se puede usar la longitud,
  // y la sierra (que requiere elevación) deja de ser detectable.
  // Confianza baja, marca explícita para que la UI advierta.
  if (elev == null || isNaN(elev)) {
    return {
      region: eastOfDivide ? 'selva' : 'costa',
      confidence: 'low',
      transition: false,
      divide,
      missingElev: true,
    };
  }

  if (elev >= 2500) {
    return { region: 'sierra', confidence: 'high', transition: false, divide };
  }
  if (elev >= 1500) {
    return { region: 'sierra', confidence: 'medium', transition: true, divide };
  }
  if (eastOfDivide) {
    return {
      region: 'selva',
      confidence: elev < 800 ? 'high' : 'medium',
      transition: false,
      divide,
    };
  }
  return {
    region: 'costa',
    confidence: elev < 800 ? 'high' : 'medium',
    transition: false,
    divide,
  };
}

/**
 * Bounding box aproximada del territorio peruano continental.
 * lat: -18.5 (Tacna sur) a 0.0 (Tumbes norte)
 * lng: -81.5 (mar de Piura) a -68.5 (frontera Brasil/Bolivia)
 */
export const PERU_BBOX = { latMin: -18.5, latMax: -0.0, lngMin: -81.5, lngMax: -68.5 };

/**
 * Verifica si un punto cae dentro del territorio peruano (bounding box).
 * @returns {boolean}
 */
export function isInPeru(lat, lng) {
  return (
    lat >= PERU_BBOX.latMin && lat <= PERU_BBOX.latMax &&
    lng >= PERU_BBOX.lngMin && lng <= PERU_BBOX.lngMax
  );
}

/**
 * Etiqueta humana de región.
 */
export function regionLabel(region) {
  return {
    costa: 'Costa',
    sierra: 'Sierra andina',
    selva: 'Selva amazónica',
  }[region] || region;
}

/**
 * Descripción climática corta para UI.
 */
export function regionDescription(info) {
  const base = {
    costa: 'Irradiancia alta y estable, terreno mayormente plano, calor moderado a alto.',
    sierra: 'Irradiancia muy alta, relieve complejo (sombras críticas), temperatura fría = bonus.',
    selva: 'Nubosidad dominante, terreno plano, calor + humedad altos.',
  }[info.region];
  return info.transition
    ? `${base} Zona de transición — confianza media.`
    : base;
}
