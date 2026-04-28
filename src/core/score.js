/**
 * score.js
 * Motor de score compuesto multi-factor con redistribución dinámica.
 *
 * Factores (cada punto debe traerlos):
 *   irr               — yield PV (kWh/kWp en el período) mayor = mejor
 *   slope             — pendiente (°)                   menor = mejor
 *   shadowScore       — sombras topográficas (0–100)    mayor = mejor
 *   dist              — distancia al consumo (km|null)  menor = mejor
 *   azimutScore       — orientación (0–100)             mayor = mejor
 *   tempScoreVal      — estrés térmico (0–100)          mayor = mejor
 *   clearnessScoreVal — clearness index (0–100)         mayor = mejor
 *
 * Los pesos vienen del preset de región y se ajustan dinámicamente:
 * factores que no diferencian dentro de la grilla ceden su peso.
 */

import { discriminationByFactor, adjustWeights } from './weights.js';

function norm(v, arr) {
  const valid = arr.filter(x => x !== null && x !== undefined && !isNaN(x));
  if (!valid.length) return 50;
  const mn = Math.min(...valid), mx = Math.max(...valid);
  if (mx === mn) return 100;
  if (v === null || v === undefined || isNaN(v)) return 50;
  return ((v - mn) / (mx - mn)) * 100;
}

function normInv(v, arr) {
  const valid = arr.filter(x => x !== null && x !== undefined && !isNaN(x));
  if (!valid.length) return 50;
  const mn = Math.min(...valid), mx = Math.max(...valid);
  if (mx === mn) return 100;
  if (v === null || v === undefined || isNaN(v)) return 50;
  return (1 - (v - mn) / (mx - mn)) * 100;
}

/**
 * Calcula scores compuestos con pesos ajustados dinámicamente.
 *
 * @param {object[]} points
 * @param {object}   baseWeights - { irr, slope, shadow, dist, azimut, temp, clearness } (suma 100)
 * @returns {{
 *   ranked: object[],
 *   effectiveWeights: object,
 *   discrimination: object
 * }}
 */
export function computeScores(points, baseWeights) {
  const factorArrays = {
    irr: points.map(p => p.irr),
    slope: points.map(p => p.slope),
    shadow: points.map(p => p.shadowScore),
    dist: points.map(p => p.dist).filter(d => d !== null && !isNaN(d)),
    azimut: points.map(p => p.azimutScore),
    temp: points.map(p => p.tempScoreVal),
    clearness: points.map(p => p.clearnessScoreVal),
  };

  const discrim = discriminationByFactor(factorArrays);

  // Si no hay punto de consumo, distancia no aplica → quitamos su peso
  // antes del ajuste (se redistribuirá a los demás).
  const adjustable = { ...baseWeights };
  if (factorArrays.dist.length === 0) adjustable.dist = 0;

  const eff = adjustWeights(adjustable, discrim);

  const w = Object.fromEntries(
    Object.entries(eff).map(([k, v]) => [k, v / 100]),
  );

  const ranked = points.map(p => {
    const sIrr   = norm(p.irr, factorArrays.irr);
    const sSlope = normInv(p.slope, factorArrays.slope);
    const sShad  = norm(p.shadowScore, factorArrays.shadow);
    const sDist  = (p.dist !== null && factorArrays.dist.length > 0)
      ? normInv(p.dist, factorArrays.dist)
      : 50;
    const sAzi   = p.azimutScore ?? 50;
    const sTemp  = p.tempScoreVal ?? 50;
    const sClr   = p.clearnessScoreVal ?? 50;

    const score = Math.round(
      sIrr   * (w.irr       || 0) +
      sSlope * (w.slope     || 0) +
      sShad  * (w.shadow    || 0) +
      sDist  * (w.dist      || 0) +
      sAzi   * (w.azimut    || 0) +
      sTemp  * (w.temp      || 0) +
      sClr   * (w.clearness || 0)
    );

    return { ...p, score };
  }).sort((a, b) => b.score - a.score);

  return { ranked, effectiveWeights: eff, discrimination: discrim };
}

/**
 * Clasificación cualitativa del score relativo (0–100, comparativo dentro del área).
 * @param {number} score
 * @returns {'optimo'|'bueno'|'bajo'}
 */
export function scoreCategory(score) {
  if (score >= 85) return 'optimo';
  if (score >= 70) return 'bueno';
  return 'bajo';
}

/**
 * Referencia de yield PV anual para Perú (kWh/kWp).
 *   excellent  — sierra alta seca / costa sur (Tacna, Arequipa)
 *   baseline   — piso útil para fotovoltaica residencial (selva muy nubosa)
 *
 * El score absoluto NO se usa para rankear (ya hay score relativo) sino
 * para indicarle al usuario si el "óptimo" del área es realmente bueno
 * en términos absolutos vs Perú.
 */
export const PERU_IRR_REF = { excellent: 2400, baseline: 750 };

/**
 * Score absoluto de irradiancia (0–100) contra benchmark peruano.
 * Escala linealmente al período seleccionado.
 *
 * @param {number} irr - Yield PV del punto (kWh/kWp) para el período [m1, m2]
 * @param {number} m1  - Mes inicio (1–12, inclusivo)
 * @param {number} m2  - Mes fin (1–12, inclusivo)
 * @returns {number} Score 0–100
 */
export function absoluteScore(irr, m1 = 1, m2 = 12) {
  if (irr == null || isNaN(irr)) return 0;
  const months = Math.max(1, m2 - m1 + 1);
  const top = PERU_IRR_REF.excellent * (months / 12);
  const bot = PERU_IRR_REF.baseline * (months / 12);
  return Math.max(0, Math.min(100, Math.round((irr - bot) / (top - bot) * 100)));
}

/**
 * Clasificación cualitativa del score absoluto.
 * @param {number} score
 * @returns {'excelente'|'bueno'|'moderado'|'bajo'}
 */
export function absoluteCategory(score) {
  if (score >= 75) return 'excelente';
  if (score >= 55) return 'bueno';
  if (score >= 35) return 'moderado';
  return 'bajo';
}
