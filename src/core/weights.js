/**
 * weights.js
 * Presets de pesos por región + ajuste dinámico según poder discriminante.
 *
 * Filosofía:
 *   1. Cada región tiene un perfil de pesos base (sierra → sombras críticas;
 *      costa → temperatura crítica; selva → clearness dominante).
 *   2. Si dentro del área analizada un factor no varía (ej. en una zona
 *      plana las sombras topográficas son uniformemente cero), su peso
 *      se redistribuye a los factores que sí discriminan.
 *
 * Esto evita que el ranking se base en factores que no diferencian los
 * puntos del área, y produce siempre un ordenamiento informativo.
 *
 * Factores soportados (claves):
 *   irr         — yield PV (kWh/kWp)
 *   slope       — pendiente (°)
 *   shadow      — score de sombras topográficas (0–100)
 *   dist        — distancia al consumo (km, opcional)
 *   azimut      — score de orientación (0–100)
 *   temp        — score de estrés térmico (0–100)
 *   clearness   — score de clearness index (0–100)
 */

/**
 * Pesos base por región. Cada preset suma 100.
 */
export const PRESETS = {
  costa: {
    irr: 28, slope: 10, shadow: 5, dist: 17, azimut: 5, temp: 22, clearness: 13,
  },
  sierra: {
    irr: 28, slope: 18, shadow: 27, dist: 12, azimut: 5, temp: 5, clearness: 5,
  },
  selva: {
    irr: 22, slope: 8, shadow: 0, dist: 15, azimut: 5, temp: 15, clearness: 35,
  },
};

/**
 * Etiquetas humanas por factor para UI.
 */
export const FACTOR_LABELS = {
  irr: 'Irradiancia',
  slope: 'Pendiente',
  shadow: 'Sombras',
  dist: 'Distancia',
  azimut: 'Orientación',
  temp: 'Estrés térmico',
  clearness: 'Clearness index',
};

/**
 * Calcula el poder discriminante de cada factor (0–1).
 * Si el factor es uniforme dentro de la grilla → discriminación 0.
 *
 * @param {Record<string, number[]>} factorArrays
 * @returns {Record<string, number>}
 */
export function discriminationByFactor(factorArrays) {
  const out = {};
  for (const [key, arr] of Object.entries(factorArrays)) {
    if (!arr || arr.length < 2) { out[key] = 0; continue; }
    const valid = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (valid.length < 2) { out[key] = 0; continue; }
    const mn = Math.min(...valid);
    const mx = Math.max(...valid);
    if (mx === mn) { out[key] = 0; continue; }
    const center = Math.abs((mn + mx) / 2) || 1;
    out[key] = Math.min(1, (mx - mn) / center);
  }
  return out;
}

/**
 * Redistribuye los pesos según poder discriminante.
 * Factores con discriminación < threshold ceden el 80% de su peso a
 * factores discriminantes, en proporción a sus pesos originales.
 *
 * @param {Record<string, number>} weights - Pesos base (suma 100)
 * @param {Record<string, number>} discrim - Discriminación 0–1
 * @param {number} threshold - Mínimo para considerar factor "útil" (default 0.05)
 * @returns {Record<string, number>} Pesos ajustados (suma 100)
 */
export function adjustWeights(weights, discrim, threshold = 0.05) {
  const lowDisc = Object.keys(weights).filter(
    k => weights[k] > 0 && (discrim[k] ?? 0) < threshold,
  );
  const highDisc = Object.keys(weights).filter(
    k => weights[k] > 0 && (discrim[k] ?? 0) >= threshold,
  );
  if (!lowDisc.length || !highDisc.length) return { ...weights };

  const adjusted = { ...weights };
  let pool = 0;
  for (const k of lowDisc) {
    pool += weights[k] * 0.8;
    adjusted[k] = weights[k] * 0.2;
  }
  const baseHighTotal = highDisc.reduce((a, k) => a + weights[k], 0) || 1;
  for (const k of highDisc) {
    adjusted[k] = weights[k] + pool * (weights[k] / baseHighTotal);
  }
  // Re-normalizar a 100 por seguridad numérica
  const sum = Object.values(adjusted).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const k of Object.keys(adjusted)) adjusted[k] = (adjusted[k] / sum) * 100;
  }
  return adjusted;
}

/**
 * Estima temperatura local a partir de elevación usando lapse rate
 * ambiental estándar (~6.5 °C / 1000 m). Útil cuando el forecast
 * entrega una sola temperatura para todo el grid (resolución ~13 km).
 *
 * @param {number} elev - Elevación del punto (m)
 * @param {number} baseTemp - Temperatura observada (°C)
 * @param {number} baseElev - Elevación de la observación (m)
 * @returns {number} Temperatura estimada (°C)
 */
export function estimateTemp(elev, baseTemp, baseElev) {
  if (baseTemp == null || isNaN(baseTemp)) return null;
  if (elev == null || isNaN(elev) || baseElev == null || isNaN(baseElev)) {
    return baseTemp; // sin elev → no aplicamos lapse rate
  }
  return baseTemp - (elev - baseElev) * 0.0065;
}

/**
 * Score de "estrés térmico" (0–100, mayor = mejor para paneles).
 *
 * Paneles cristalinos pierden ~0.4 % de eficiencia por cada °C sobre 25 °C.
 * Por debajo de 25 °C el rendimiento mejora ligeramente, pero hay un piso
 * por riesgo de heladas (<5 °C en sierra alta).
 *
 * @param {number} temp - Temperatura estimada (°C)
 * @returns {number} Score 0–100
 */
export function tempScore(temp) {
  if (temp == null || isNaN(temp)) return 50;
  if (temp >= 25) return Math.max(0, 100 - (temp - 25) * 4);
  if (temp >= 5)  return Math.min(100, 90 + (25 - temp) * 0.5);
  return Math.max(40, 90 - (5 - temp) * 3);
}

/**
 * Score de clearness index (0–100, mayor = mejor).
 *   KT > 0.65 → muy claro (costa norte, sierra alta seca)
 *   KT 0.45–0.65 → moderado (mucho de Perú)
 *   KT < 0.40 → nuboso (selva, costa central invierno)
 *
 * @param {number} kt - Clearness index promedio (0–1)
 * @returns {number} Score 0–100
 */
export function clearnessScore(kt) {
  if (kt == null || isNaN(kt)) return 50;
  return Math.max(0, Math.min(100, kt * 145)); // KT≈0.69 → 100
}

/**
 * Promedio de un array por meses [m1..m2] (1-indexed, inclusive).
 * Ignora valores null/0.
 */
export function seasonalAverage(monthly, m1, m2) {
  if (!monthly || !monthly.length) return null;
  const slice = monthly.slice(m1 - 1, m2);
  const valid = slice.filter(v => v !== null && !isNaN(v) && v > 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Suma de pesos (para validación).
 */
export function sumWeights(weights) {
  return Object.values(weights).reduce((a, b) => a + b, 0);
}
