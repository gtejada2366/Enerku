/**
 * calibration.js
 * Factores de corrección regional + fallback regional, compartidos entre
 * el app principal y la página de validación.
 *
 * El nombre histórico es "soiling" pero los factores actuales incluyen
 * DOS efectos combinados:
 *
 *   1. Soiling real (paneles sucios) — costa peruana sufre aerosoles
 *      marinos, sierra es limpia/seca, selva tiene bonus por lluvia.
 *
 *   2. Corrección de bias del dataset — PVGIS usa NSRDB (NREL) para
 *      América, que sub-estima sistemáticamente vs Global Solar Atlas
 *      (Solargis) ~5-25 % en Perú. La diferencia es mayor en costa norte
 *      (donde NSRDB tiene menos validación).
 *
 * Valores actuales calibrados con run de validación de 2026-04-28
 * contra 30 sitios de referencia (GSA + PVGIS direct + reportes MINEM).
 * Re-correr /validation/ tras cambios; el sesgo medio debería estar
 * cerca de 0.
 *
 *   costa   ×1.19  → bias dataset (~+25%) − soiling marino (~5%) = +19% neto
 *   sierra  ×1.16  → bias dataset (~+16%) sin soiling adicional
 *   selva   ×1.11  → bias dataset (~+10%) + bonus lluvia (~1%)
 *   unknown ×1.10  → promedio conservador para puntos sin región clara
 *
 * Si tenés datos COES o SENAMHI medidos, importálos vía /validation/ y
 * recalibrá. Lo "correcto" depende del truth source que anclás:
 *  - vs GSA Solargis: factores actuales (~1.1-1.2)
 *  - vs PVGIS direct: factores ~1.0
 *  - vs plantas COES reales: requiere medirlo, factores intermedios probablemente.
 */

export const SOILING_BY_REGION = {
  costa:   1.19,
  sierra:  1.16,
  selva:   1.11,
  unknown: 1.10,
};

export const FALLBACK_YIELD_BY_REGION = {
  costa:   2000,
  sierra:  2100,
  selva:   1400,
  unknown: 1700,
};

/**
 * Aplica soiling factor regional al resultado de PVGIS o ERA5.
 * @param {{val:number, monthly:number[], source:string}} irrRes
 * @param {string} region
 * @returns {object} Resultado ajustado, con campo `soilingFactor` añadido.
 */
export function applySoiling(irrRes, region) {
  const factor = SOILING_BY_REGION[region] ?? SOILING_BY_REGION.unknown;
  if (factor === 1) return { ...irrRes, soilingFactor: 1 };
  return {
    ...irrRes,
    val: Math.round(irrRes.val * factor * 10) / 10,
    monthly: irrRes.monthly.map(v => Math.round(v * factor * 10) / 10),
    soilingFactor: factor,
  };
}

/**
 * Genera un resultado fallback con yield anual típico de la región,
 * distribuido uniformemente entre meses.
 * @param {string} region
 * @param {number} m1 - Mes inicio (1–12, inclusivo)
 * @param {number} m2 - Mes fin (1–12, inclusivo)
 * @returns {{val:number, monthly:number[], source:string}}
 */
export function regionalFallback(region, m1 = 1, m2 = 12) {
  const annual = FALLBACK_YIELD_BY_REGION[region] ?? FALLBACK_YIELD_BY_REGION.unknown;
  const perMonth = Math.round((annual / 12) * 10) / 10;
  const monthly = Array(12).fill(perMonth);
  let total = 0;
  for (let i = m1 - 1; i < m2; i++) total += perMonth;
  return {
    val: Math.round(total * 10) / 10,
    monthly,
    source: `est.${region.charAt(0).toUpperCase()}`,
  };
}

/**
 * Helper genérico de retry con backoff exponencial.
 * @param {() => Promise<any>} fn
 * @param {number} retries - Reintentos máximos (default 2 → 3 intentos)
 * @param {number} baseDelay - Espera inicial en ms (default 300)
 */
export async function withRetry(fn, retries = 2, baseDelay = 300) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fn();
      if (r != null) return r;
    } catch { /* tratar como null */ }
    if (i < retries) await new Promise(r => setTimeout(r, baseDelay * (2 ** i)));
  }
  return null;
}

/**
 * Acuerdo entre fuentes independientes (PVGIS y ERA5):
 * 100 % = idénticos, 0 % = diferencia ≥50 % del promedio.
 *
 * @param {number} a - Yield PVGIS (kWh/kWp)
 * @param {number} b - Yield ERA5 (kWh/kWp)
 * @returns {number|null} Acuerdo 0–100, null si alguno falta
 */
export function sourceAgreement(a, b) {
  if (a == null || b == null || isNaN(a) || isNaN(b)) return null;
  const mean = (a + b) / 2;
  if (mean <= 0) return null;
  const rel = Math.abs(a - b) / mean;
  return Math.max(0, Math.round((1 - rel * 2) * 100));
}

/**
 * Banda de error (en kWh/kWp) para un yield estimado.
 * Combina varianza entre fuentes + cobertura de elevación + base residual.
 *
 * @param {number} irr - Yield principal (kWh/kWp)
 * @param {object} ctx
 * @param {number} [ctx.altIrr] - Yield de la fuente alternativa para comparar
 * @param {boolean} [ctx.elevMissing] - true si no hay elevación válida
 * @param {boolean} [ctx.usingFallback] - true si vino de fallback regional
 * @returns {number} Banda ± kWh/kWp
 */
export function uncertaintyBand(irr, ctx = {}) {
  if (!irr || isNaN(irr)) return 0;
  let band = irr * 0.05; // base residual ~5 %
  if (ctx.altIrr != null && !isNaN(ctx.altIrr)) {
    band = Math.max(band, Math.abs(irr - ctx.altIrr) / 2);
  } else {
    band = Math.max(band, irr * 0.08); // sin segunda fuente, asumir 8 %
  }
  if (ctx.elevMissing) band += irr * 0.05;
  if (ctx.usingFallback) band += irr * 0.10;
  return Math.round(band);
}

/**
 * Etiqueta de confianza basada en la banda de error relativa.
 * @param {number} irr
 * @param {number} band
 * @returns {'alta'|'media'|'baja'}
 */
export function confidenceLabel(irr, band) {
  if (!irr) return 'baja';
  const rel = band / irr;
  if (rel <= 0.07) return 'alta';
  if (rel <= 0.15) return 'media';
  return 'baja';
}

/**
 * Sugiere un ajuste de soiling factor para que el yield calculado coincida
 * con un yield medido conocido en un sitio específico.
 *
 *     factorAjustado = factorActual × (knownYield / calculatedYield)
 *
 * @param {number} knownYield - Yield real medido (kWh/kWp/año)
 * @param {number} calculatedYield - Yield que produjo la calculadora
 * @param {string} region
 * @returns {{ region: string, currentSoiling: number, suggestedSoiling: number, multiplier: number, deltaPct: number }}
 */
export function suggestCalibration(knownYield, calculatedYield, region) {
  const current = SOILING_BY_REGION[region] ?? SOILING_BY_REGION.unknown;
  if (!calculatedYield || calculatedYield <= 0) {
    return { region, currentSoiling: current, suggestedSoiling: current, multiplier: 1, deltaPct: 0 };
  }
  const multiplier = knownYield / calculatedYield;
  const suggested = Math.round(current * multiplier * 1000) / 1000;
  return {
    region,
    currentSoiling: current,
    suggestedSoiling: suggested,
    multiplier: Math.round(multiplier * 1000) / 1000,
    deltaPct: Math.round((multiplier - 1) * 1000) / 10,
  };
}

/**
 * Normaliza generación medida de una planta a "yield equivalente fijo nuevo":
 *   yield_normalizado = (MWh×1000 / kWp_DC) ÷ tracking_gain ÷ (1 − degradation)
 *
 * Esto produce un valor comparable directamente con la salida de PVGIS
 * (que asume sistema fijo, módulos nuevos, sin degradación).
 *
 * @param {object} plant - { capacityKwpDC, mountingType, codYear }
 * @param {number} measuredMWhPerYear - Generación anual medida (MWh)
 * @param {number} dataYear - Año al que corresponde el dato (para edad)
 * @param {object} [opts]
 * @param {number} [opts.annualDegradationPct=0.5]  - %/año típico c-Si
 * @param {number} [opts.lidLossPct=1.0]            - LID inicial fixed
 * @param {number} [opts.trackingGain1axis=1.20]    - Ganancia tracking 1-eje
 * @returns {{
 *   measuredYield: number,        // kWh/kWp/año bruto medido
 *   normalizedYield: number,      // kWh/kWp/año equivalente sistema fijo nuevo
 *   age: number,
 *   degradationFactor: number,    // 1 − pérdidas
 *   trackingGain: number
 * } | null}
 */
export function normalizePlantYield(plant, measuredMWhPerYear, dataYear, opts = {}) {
  if (!plant?.capacityKwpDC || !measuredMWhPerYear || measuredMWhPerYear <= 0) return null;
  const annualDeg = (opts.annualDegradationPct ?? 0.5) / 100;
  const lid = (opts.lidLossPct ?? 1.0) / 100;
  const trackingG = opts.trackingGain1axis ?? 1.20;

  const age = Math.max(0, (dataYear || new Date().getFullYear()) - (plant.codYear || dataYear));
  const degradationFactor = 1 - lid - annualDeg * age;
  const trackingGain = plant.mountingType === 'tracking-1axis' ? trackingG : 1.0;

  const measuredYield = (measuredMWhPerYear * 1000) / plant.capacityKwpDC;
  const normalizedYield = measuredYield / trackingGain / degradationFactor;

  return {
    measuredYield: Math.round(measuredYield),
    normalizedYield: Math.round(normalizedYield),
    age,
    degradationFactor: Math.round(degradationFactor * 1000) / 1000,
    trackingGain,
  };
}

/**
 * Sugiere factor regional a partir de plantas COES (ground truth medido).
 * Mejor que sugerencia desde GSA porque ancla en generación real.
 *
 * @param {Array<{normalizedYield: number, pvgisRaw: number}>} comparisons
 *   Cada elemento debe tener:
 *     normalizedYield — yield real normalizado a fixed-equivalent fresh-modules
 *     pvgisRaw — yield que PVGIS predice para ese punto SIN soiling
 * @returns {{ count: number, suggestedFactor: number, meanRatio: number, stdDev: number } | null}
 */
export function suggestFromCOES(comparisons) {
  const valid = comparisons.filter(c =>
    c?.normalizedYield > 0 && c?.pvgisRaw > 0
  );
  if (!valid.length) return null;
  const ratios = valid.map(c => c.normalizedYield / c.pvgisRaw);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length;
  return {
    count: valid.length,
    meanRatio: Math.round(mean * 1000) / 1000,
    stdDev: Math.round(Math.sqrt(variance) * 1000) / 1000,
    suggestedFactor: Math.round(mean * 1000) / 1000,
  };
}

/**
 * Promedio ponderado de sugerencias de calibración para una región.
 * Útil cuando hay múltiples sitios conocidos en la misma región.
 *
 * @param {Array<{region: string, suggestedSoiling: number}>} suggestions
 * @returns {Record<string, number>} Pesos sugeridos por región
 */
export function aggregateCalibrations(suggestions) {
  const byRegion = {};
  for (const s of suggestions) {
    if (!byRegion[s.region]) byRegion[s.region] = [];
    byRegion[s.region].push(s.suggestedSoiling);
  }
  const out = {};
  for (const [region, values] of Object.entries(byRegion)) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    out[region] = Math.round(mean * 1000) / 1000;
  }
  return out;
}
