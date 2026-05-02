/**
 * sensitivity.js
 * Análisis de sensibilidad y simulación Monte Carlo sobre el modelo económico.
 *
 * Dos análisis separados:
 *
 *   1. TORNADO ANALYSIS — barre cada variable ±20 % manteniendo el resto fijo.
 *      Muestra cuáles inputs mueven más el NPV (ranking de impacto).
 *
 *   2. MONTE CARLO — 1000 simulaciones con cada variable distribuida normalmente.
 *      Devuelve P10/P25/P50/P75/P90 + probabilidad de payback <X / NPV >0.
 *
 * Los dos juntos dan al cliente una "decisión informada" en lugar de un
 * "número estimado". Es el upgrade que justifica un estudio bancable.
 */

import { solarEconomics } from './economics.js';

/**
 * Variables que se varían en el análisis. Cada una tiene un rango +/- y
 * una desviación estándar relativa para Monte Carlo.
 */
export const SENSITIVITY_VARS = [
  { id: 'energyPrice',   label: 'Precio energía',     range: 0.20, sd: 0.10 },
  { id: 'capexPerKwp',   label: 'CAPEX por kWp',      range: 0.20, sd: 0.10 },
  { id: 'annualEnergyKwhPerKwp', label: 'Yield PV',   range: 0.15, sd: 0.07 },
  { id: 'discountRate',  label: 'Tasa de descuento',  range: 0.30, sd: 0.15 },
  { id: 'omRate',        label: 'O&M (% CAPEX)',      range: 0.50, sd: 0.20 },
];

/**
 * Tornado analysis: para cada variable, computa NPV a -range, base, +range.
 *
 * @param {object} baseParams - parámetros base de solarEconomics()
 * @returns {Array<{ id, label, low, base, high, lowDelta, highDelta, range }>}
 *   ordenado por |delta| descendente
 */
export function tornadoAnalysis(baseParams) {
  const baseEcon = solarEconomics(baseParams);
  if (!baseEcon) return null;
  const baseNPV = baseEcon.npv;

  const results = [];
  for (const v of SENSITIVITY_VARS) {
    const baseVal = baseParams[v.id];
    if (baseVal == null) continue;

    const lowParams = { ...baseParams, [v.id]: baseVal * (1 - v.range) };
    const highParams = { ...baseParams, [v.id]: baseVal * (1 + v.range) };
    const lowEcon = solarEconomics(lowParams);
    const highEcon = solarEconomics(highParams);
    if (!lowEcon || !highEcon) continue;

    results.push({
      id: v.id,
      label: v.label,
      baseVal: Math.round(baseVal * 1000) / 1000,
      lowVal: Math.round(baseVal * (1 - v.range) * 1000) / 1000,
      highVal: Math.round(baseVal * (1 + v.range) * 1000) / 1000,
      base: baseNPV,
      low: lowEcon.npv,
      high: highEcon.npv,
      lowDelta: lowEcon.npv - baseNPV,
      highDelta: highEcon.npv - baseNPV,
      range: v.range,
      maxAbsDelta: Math.max(Math.abs(lowEcon.npv - baseNPV), Math.abs(highEcon.npv - baseNPV)),
    });
  }

  // Ordenar por impacto (mayor primero)
  results.sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
  return { baseNPV, variables: results };
}

/**
 * Sample de una distribución normal (Box-Muller).
 */
function sampleNormal(mean, sd) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

/**
 * Monte Carlo simulation con todas las variables independientes.
 *
 * @param {object} baseParams
 * @param {number} [iterations=1000]
 * @returns {object} estadísticas P10-P90 + probabilidades + bins para histograma
 */
export function monteCarloAnalysis(baseParams, iterations = 1000) {
  const baseEcon = solarEconomics(baseParams);
  if (!baseEcon) return null;

  const npvSamples = [];
  const paybackSamples = [];
  const irrSamples = [];
  let positiveNPVCount = 0;

  for (let i = 0; i < iterations; i++) {
    const sampledParams = { ...baseParams };
    for (const v of SENSITIVITY_VARS) {
      const baseVal = baseParams[v.id];
      if (baseVal == null) continue;
      // Asegurar valores positivos (clamp en 0.01 para evitar divisiones por cero)
      sampledParams[v.id] = Math.max(0.01, sampleNormal(baseVal, baseVal * v.sd));
    }
    const econ = solarEconomics(sampledParams);
    if (!econ) continue;
    npvSamples.push(econ.npv);
    if (econ.simplePaybackYears != null && econ.simplePaybackYears > 0) {
      paybackSamples.push(econ.simplePaybackYears);
    }
    if (econ.irr != null) irrSamples.push(econ.irr);
    if (econ.npv > 0) positiveNPVCount++;
  }

  npvSamples.sort((a, b) => a - b);
  paybackSamples.sort((a, b) => a - b);
  irrSamples.sort((a, b) => a - b);

  const percentile = (sorted, p) => {
    if (!sorted.length) return null;
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  // Histogram bins para visualización (20 bins)
  const npvMin = npvSamples[0];
  const npvMax = npvSamples[npvSamples.length - 1];
  const binCount = 20;
  const binWidth = (npvMax - npvMin) / binCount || 1;
  const bins = Array(binCount).fill(0);
  for (const v of npvSamples) {
    const idx = Math.min(binCount - 1, Math.floor((v - npvMin) / binWidth));
    bins[idx]++;
  }
  const histogram = bins.map((count, i) => ({
    binStart: Math.round(npvMin + i * binWidth),
    binEnd: Math.round(npvMin + (i + 1) * binWidth),
    count,
    pct: Math.round((count / npvSamples.length) * 1000) / 10,
  }));

  return {
    iterations,
    baseNPV: baseEcon.npv,
    npv: {
      P10: Math.round(percentile(npvSamples, 0.10)),
      P25: Math.round(percentile(npvSamples, 0.25)),
      P50: Math.round(percentile(npvSamples, 0.50)),
      P75: Math.round(percentile(npvSamples, 0.75)),
      P90: Math.round(percentile(npvSamples, 0.90)),
      mean: Math.round(npvSamples.reduce((a, b) => a + b, 0) / npvSamples.length),
      probPositive: Math.round((positiveNPVCount / iterations) * 1000) / 10,
    },
    payback: paybackSamples.length ? {
      P10: Math.round(percentile(paybackSamples, 0.10) * 10) / 10,
      P50: Math.round(percentile(paybackSamples, 0.50) * 10) / 10,
      P90: Math.round(percentile(paybackSamples, 0.90) * 10) / 10,
    } : null,
    irr: irrSamples.length ? {
      P10: Math.round(percentile(irrSamples, 0.10) * 10) / 10,
      P50: Math.round(percentile(irrSamples, 0.50) * 10) / 10,
      P90: Math.round(percentile(irrSamples, 0.90) * 10) / 10,
    } : null,
    histogram,
    samplesCount: npvSamples.length,
  };
}

/**
 * Resumen ejecutivo de bancabilidad.
 * "Tu proyecto es rentable en X% de escenarios" en una sola frase.
 */
export function bankabilityVerdict(monteCarlo) {
  if (!monteCarlo) return null;
  const prob = monteCarlo.npv.probPositive;
  let level, message;
  if (prob >= 95) {
    level = 'high';
    message = `Bancabilidad ALTA — proyecto rentable en ${prob}% de escenarios. Robusto a variaciones de costo, yield y precio energía.`;
  } else if (prob >= 80) {
    level = 'medium-high';
    message = `Bancabilidad BUENA — rentable en ${prob}% de escenarios. Riesgo moderado si energía cae.`;
  } else if (prob >= 60) {
    level = 'medium';
    message = `Bancabilidad MEDIA — rentable en ${prob}% de escenarios. Considerar negociar mejor CAPEX o tarifa.`;
  } else if (prob >= 40) {
    level = 'low';
    message = `Bancabilidad BAJA — sólo ${prob}% de escenarios da NPV positivo. Proyecto frágil ante variaciones.`;
  } else {
    level = 'very-low';
    message = `Bancabilidad MUY BAJA — sólo ${prob}% rentable. Re-evaluar premisas (CAPEX, tarifa, dimensión).`;
  }
  return { level, message, probability: prob };
}
