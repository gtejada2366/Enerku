/**
 * utils.js
 * Funciones utilitarias compartidas.
 */

/**
 * Distancia entre dos coordenadas en kilómetros (fórmula de Haversine).
 *
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distancia en km
 */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pausa async.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Redondea a N decimales.
 * @param {number} val
 * @param {number} decimals
 */
export function round(val, decimals = 1) {
  return Math.round(val * 10 ** decimals) / 10 ** decimals;
}

/**
 * Trimestres de análisis — mapeo índice → meses.
 * Relevante para selva peruana donde la estacionalidad
 * de nubosidad define el período crítico de riego.
 */
export const SEASONS = {
  0: { label: 'Anual',      m1: 1,  m2: 12 },
  1: { label: 'Q1 ene–mar', m1: 1,  m2: 3  },
  2: { label: 'Q2 abr–jun', m1: 4,  m2: 6  },
  3: { label: 'Q3 jul–sep', m1: 7,  m2: 9  },
  4: { label: 'Q4 oct–dic', m1: 10, m2: 12 }
};
