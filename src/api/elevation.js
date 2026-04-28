/**
 * elevation.js
 * Cliente de elevación con dos fuentes y fallback automático.
 *
 * Fuente primaria:  Open-Elevation (SRTM, 30 m) — batch hasta 100 puntos
 * Fuente fallback:  OpenTopoData ASTER 30 m — punto a punto, más estable
 *
 * Importante: en caso de fallo, devuelve NaN (no 0). Esto distingue
 * "nivel del mar" de "API caída". Los consumidores (region.js, shadows.js,
 * weights.js) deben tratar NaN como dato faltante y no como cero.
 */

const OPEN_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';
const OPENTOPODATA_URL   = 'https://api.opentopodata.org/v1/aster30m';

/**
 * Obtiene elevaciones para un array de puntos.
 * @param {{ lat: number, lng: number }[]} points
 * @returns {Promise<number[]>} Array de elevaciones (NaN para puntos fallidos)
 */
export async function fetchElevations(points) {
  const batch = await fetchBatch(points);
  if (batch) return batch;

  console.warn('[Elevation] Batch falló, usando fallback punto a punto (ASTER)');
  const elevs = [];
  for (const pt of points) {
    elevs.push(await fetchSingle(pt.lat, pt.lng));
    await sleep(60); // rate limit amable
  }
  return elevs;
}

async function fetchBatch(points) {
  try {
    const locations = points.map(p => `${p.lat},${p.lng}`).join('|');
    const res = await fetch(`${OPEN_ELEVATION_URL}?locations=${locations}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results || data.results.length !== points.length) return null;
    return data.results.map(r => (r.elevation == null ? NaN : r.elevation));
  } catch {
    return null;
  }
}

async function fetchSingle(lat, lng) {
  try {
    const res = await fetch(`${OPENTOPODATA_URL}?locations=${lat},${lng}`);
    if (!res.ok) return NaN;
    const data = await res.json();
    const v = data.results?.[0]?.elevation;
    return v == null ? NaN : v;
  } catch {
    return NaN;
  }
}

/**
 * Estadísticas de cobertura de un array de elevaciones.
 * @param {number[]} elevs
 * @returns {{ valid: number, total: number, ratio: number }}
 */
export function elevationCoverage(elevs) {
  const total = elevs.length;
  const valid = elevs.filter(e => !isNaN(e)).length;
  return { valid, total, ratio: total ? valid / total : 0 };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
