/**
 * wind.js
 * Cálculo de potencial eólico a partir de velocidad de viento histórica.
 *
 * Pipeline:
 *   1. Open-Meteo Archive entrega series horarias de wind_speed_10m y wind_speed_100m
 *   2. Extrapolación log-law a la altura del hub si no es exactamente 100m
 *   3. Curva de potencia de la turbina aplicada hora-a-hora
 *   4. Integración → energía anual → capacity factor
 *
 * Limitaciones honestas:
 * - ERA5 (~9 km) sub-estima vientos en topografía compleja (sierra alta, valles)
 * - No modelamos efectos de wake (parques eólicos)
 * - Asumimos densidad de aire estándar (1.225 kg/m³ a nivel del mar)
 *   No corregimos por altitud — esto sub-estima output ~10% en sierra alta
 * - Las curvas de potencia son aproximaciones; cada fabricante difiere
 */

/**
 * Presets de turbinas comunes en proyectos pequeños y medianos en Perú.
 * Curvas simplificadas; valores reales se obtienen del fabricante.
 *
 * power: kW nominal
 * cutIn / ratedSpeed / cutOut: m/s
 * hubHeight: m (típica)
 * rotorDiameter: m (informativo)
 */
export const TURBINE_PRESETS = {
  micro_500w: {
    name: 'Micro 500 W (residencial)',
    power: 0.5, cutIn: 2.5, ratedSpeed: 11, cutOut: 25,
    hubHeight: 6, rotorDiameter: 1.7,
    typicalUse: 'casa rural, baterías, off-grid',
  },
  small_2kw: {
    name: 'Pequeña 2 kW',
    power: 2, cutIn: 2.5, ratedSpeed: 11, cutOut: 25,
    hubHeight: 12, rotorDiameter: 3.5,
    typicalUse: 'finca pequeña, bombeo',
  },
  small_10kw: {
    name: 'Pequeña 10 kW',
    power: 10, cutIn: 3, ratedSpeed: 12, cutOut: 25,
    hubHeight: 18, rotorDiameter: 7,
    typicalUse: 'comunidad rural, microred',
  },
  medium_100kw: {
    name: 'Mediana 100 kW',
    power: 100, cutIn: 3, ratedSpeed: 12, cutOut: 25,
    hubHeight: 30, rotorDiameter: 21,
    typicalUse: 'cooperativa agrícola, microred',
  },
  utility_2mw: {
    name: 'Utility 2 MW',
    power: 2000, cutIn: 3, ratedSpeed: 12, cutOut: 25,
    hubHeight: 80, rotorDiameter: 90,
    typicalUse: 'parque eólico (referencia ej. Marcona)',
  },
};

/**
 * Extrapolación log-law de velocidad de viento a otra altura.
 *
 *   v(h) = v(href) × ln(h / z0) / ln(href / z0)
 *
 * @param {number} vRef - velocidad observada (m/s)
 * @param {number} hRef - altura de la observación (m)
 * @param {number} hTarget - altura del hub (m)
 * @param {number} [roughness=0.03] - longitud de rugosidad (m)
 *   - 0.0002 → océano abierto
 *   - 0.03   → terreno agrícola plano (default)
 *   - 0.10   → arbustos / cultivos altos
 *   - 0.40   → bosque / urbano disperso
 *   - 1.00   → urbano denso / bosque cerrado
 */
export function logLawExtrapolate(vRef, hRef, hTarget, roughness = 0.03) {
  if (!vRef || vRef <= 0) return 0;
  if (hTarget === hRef) return vRef;
  if (roughness <= 0 || hRef <= roughness || hTarget <= roughness) return vRef;
  return vRef * Math.log(hTarget / roughness) / Math.log(hRef / roughness);
}

/**
 * Curva de potencia simplificada: cero hasta cut-in, cúbica hasta rated,
 * constante hasta cut-out, cero después.
 *
 * @param {number} v - velocidad de viento (m/s)
 * @param {object} t - turbina (con power, cutIn, ratedSpeed, cutOut)
 * @returns {number} potencia generada (kW)
 */
export function powerCurve(v, t) {
  if (v < t.cutIn || v > t.cutOut) return 0;
  if (v >= t.ratedSpeed) return t.power;
  // Interpolación cúbica entre cut-in y rated (∝ v³ es física)
  const ratio = (v - t.cutIn) / (t.ratedSpeed - t.cutIn);
  return t.power * Math.pow(ratio, 3);
}

/**
 * Capacity factor a partir de una serie horaria de viento.
 *
 * @param {number[]} windSpeeds - velocidades horarias en m/s (8760 horas idealmente)
 * @param {object} turbine
 * @returns {{ cf: number, annualKwh: number, hoursAboveCutIn: number }}
 */
export function capacityFromSeries(windSpeeds, turbine) {
  if (!windSpeeds?.length) return { cf: 0, annualKwh: 0, hoursAboveCutIn: 0 };
  let totalEnergy = 0;
  let hoursAbove = 0;
  for (const v of windSpeeds) {
    if (v == null || isNaN(v)) continue;
    const p = powerCurve(v, turbine);
    totalEnergy += p; // p en kW · 1 hora = p kWh
    if (v >= turbine.cutIn) hoursAbove++;
  }
  // Escalar a año completo si la serie no cubre exactamente 8760
  const hours = windSpeeds.filter(v => v != null && !isNaN(v)).length;
  if (!hours) return { cf: 0, annualKwh: 0, hoursAboveCutIn: 0 };
  const annualKwh = (totalEnergy / hours) * 8760;
  const cf = annualKwh / (turbine.power * 8760);
  return {
    cf: Math.round(cf * 1000) / 1000,
    annualKwh: Math.round(annualKwh),
    hoursAboveCutIn: Math.round((hoursAbove / hours) * 8760),
  };
}

/**
 * Capacity factor estimado a partir de la VELOCIDAD MEDIA usando una distribución
 * de Weibull con factor de forma k=2 (Rayleigh, default razonable).
 * Útil cuando no tenés serie horaria, solo la media anual.
 *
 * Aproximación rápida — para análisis serios usar capacityFromSeries.
 *
 * @param {number} meanWind - velocidad media anual (m/s) a la altura del hub
 * @param {object} turbine
 * @returns {{ cf: number, annualKwh: number }}
 */
export function capacityFromMean(meanWind, turbine) {
  if (!meanWind || meanWind <= 0) return { cf: 0, annualKwh: 0 };
  // Rayleigh: f(v) = (π/2) × (v/v̄²) × exp(-π/4 × (v/v̄)²)
  // Integramos numéricamente la curva de potencia × densidad
  const dv = 0.1; // m/s
  const vMax = 30;
  let totalPower = 0;
  for (let v = dv / 2; v < vMax; v += dv) {
    const ratio = v / meanWind;
    const pdf = (Math.PI / 2) * (v / (meanWind * meanWind)) *
                Math.exp(-Math.PI / 4 * ratio * ratio);
    totalPower += powerCurve(v, turbine) * pdf * dv;
  }
  const cf = totalPower / turbine.power;
  return {
    cf: Math.round(cf * 1000) / 1000,
    annualKwh: Math.round(totalPower * 8760),
  };
}

/**
 * Categoría cualitativa del recurso eólico según capacity factor.
 */
export function windCategory(cf) {
  if (cf == null) return 'sin datos';
  if (cf >= 0.40) return 'excelente';
  if (cf >= 0.30) return 'muy bueno';
  if (cf >= 0.20) return 'bueno';
  if (cf >= 0.12) return 'marginal';
  return 'no viable';
}
