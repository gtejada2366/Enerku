/**
 * cache.js
 * Cache simple en localStorage con TTL para acelerar re-análisis.
 *
 * Casos de uso:
 *   - PVGIS: ~1 segundo por punto. Cache por celda ~1 km, válido 30 días.
 *   - NASA POWER: 3–5 segundos. Cache por centro, válido 30 días.
 *   - ERA5: ~1 segundo. Mismo patrón que PVGIS.
 *
 * Estrategia ante quota exceeded: purga TODOS los entries del namespace.
 * No es bonito pero es seguro y sin dependencias.
 */

const PREFIX = 'solar-cache:v2:';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function buildKey(parts) {
  return PREFIX + parts.map(p => String(p)).join(':');
}

/**
 * Lee del cache. Devuelve null si no hay entrada o expiró.
 * @param  {...any} parts - Componentes de la clave (ej. 'pvgis', lat, lng, tilt)
 * @returns {any|null}
 */
export function cacheGet(...parts) {
  try {
    const k = buildKey(parts);
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!ts || Date.now() - ts > TTL_MS) {
      localStorage.removeItem(k);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Escribe en el cache. Si excede quota, purga todo el namespace y reintenta.
 * @param {any[]} parts - Componentes de la clave
 * @param {any}   data
 */
export function cacheSet(parts, data) {
  const k = buildKey(parts);
  const payload = JSON.stringify({ ts: Date.now(), data });
  try {
    localStorage.setItem(k, payload);
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      purgeAll();
      try { localStorage.setItem(k, payload); } catch { /* abandono silencioso */ }
    }
  }
}

/**
 * Borra todas las entradas del namespace.
 * @returns {number} Entradas borradas
 */
export function purgeAll() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
  return keys.length;
}

/**
 * Estadísticas del cache: número de entradas y bytes aproximados.
 * @returns {{ count: number, bytes: number }}
 */
export function cacheStats() {
  let count = 0, bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      count++;
      // Aproximación: 2 bytes/char en UTF-16
      bytes += (k.length + (localStorage.getItem(k)?.length || 0)) * 2;
    }
  }
  return { count, bytes };
}
