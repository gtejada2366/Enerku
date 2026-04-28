/**
 * energy.js
 * Conversión de yield fotovoltaico → energía real, análisis del mes crítico
 * y recomendación de dimensionamiento para sistemas off-grid.
 *
 * Notación importante:
 *   - PVGIS PVcalc devuelve `E_m` en kWh/kWp/mes (energía por kWp instalado,
 *     ya con pérdidas). NO es irradiancia raw kWh/m².
 *   - ERA5 fallback fue convertido a la misma escala (kWh/kWp ≈ GHI × 0.92).
 *   - `monthlyYield[i]` representa kWh/kWp en el mes i (0=enero).
 *
 * Para dimensionar sistemas off-grid (riego, bombeo) se usa el MES CRÍTICO,
 * no el promedio: si el sistema no puede producir suficiente en julio,
 * la bomba no funciona en julio aunque el promedio anual sea bueno.
 */

const MONTH_DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

/**
 * Energía total del sistema en el período (kWh).
 *
 * @param {number[]} monthlyYield - 12 valores kWh/kWp/mes
 * @param {number} kWp - Potencia pico instalada
 * @param {number} m1 - Mes inicio (1–12, inclusivo)
 * @param {number} m2 - Mes fin (1–12, inclusivo)
 * @returns {number} kWh totales
 */
export function totalEnergy(monthlyYield, kWp, m1 = 1, m2 = 12) {
  if (!monthlyYield || !monthlyYield.length || !kWp) return 0;
  let total = 0;
  for (let i = m1 - 1; i < m2; i++) total += (monthlyYield[i] || 0) * kWp;
  return Math.round(total);
}

/**
 * Mes crítico (peor rendimiento) dentro del período.
 *
 * @param {number[]} monthlyYield
 * @param {number} m1
 * @param {number} m2
 * @returns {{ index: number, month: number, name: string, yield: number, dailyYield: number } | null}
 *   - yield: kWh/kWp del mes crítico
 *   - dailyYield: kWh/kWp/día promedio del mes crítico
 */
export function worstMonth(monthlyYield, m1 = 1, m2 = 12) {
  if (!monthlyYield || !monthlyYield.length) return null;
  let worstIdx = -1;
  let worstVal = Infinity;
  for (let i = m1 - 1; i < m2; i++) {
    const v = monthlyYield[i];
    if (v == null || isNaN(v) || v <= 0) continue;
    if (v < worstVal) { worstVal = v; worstIdx = i; }
  }
  if (worstIdx < 0) return null;
  return {
    index: worstIdx,
    month: worstIdx + 1,
    name: MONTH_NAMES_ES[worstIdx],
    yield: Math.round(worstVal * 10) / 10,
    dailyYield: Math.round((worstVal / MONTH_DAYS[worstIdx]) * 100) / 100,
  };
}

/**
 * Producción promedio diaria en el período (kWh/kWp/día).
 *
 * @param {number[]} monthlyYield
 * @param {number} m1
 * @param {number} m2
 * @returns {number}
 */
export function dailyAverage(monthlyYield, m1 = 1, m2 = 12) {
  if (!monthlyYield || !monthlyYield.length) return 0;
  let total = 0, days = 0;
  for (let i = m1 - 1; i < m2; i++) {
    total += monthlyYield[i] || 0;
    days += MONTH_DAYS[i];
  }
  return days > 0 ? Math.round((total / days) * 1000) / 1000 : 0;
}

/**
 * Recomendación de dimensionamiento off-grid.
 * Sistema mínimo para cubrir la demanda diaria en el mes crítico:
 *
 *     kWp_mínimo = demanda_diaria / yield_diario_mes_crítico
 *
 * Si la demanda es 5 kWh/día y el mes crítico produce 3 kWh/kWp/día,
 * el sistema mínimo es 5/3 ≈ 1.67 kWp.
 *
 * @param {object} worst - Output de worstMonth()
 * @param {number} loadKwhPerDay - Demanda diaria (kWh/día). null/0 → no recomienda.
 * @param {number} configuredKwp - Potencia pico ya configurada por el usuario
 * @returns {{
 *   requiredKwp: number,         // kWp mínimo
 *   coverage: number,             // % de demanda cubierta con el sistema configurado
 *   surplusOrDeficit: number      // kWh/día sobre o bajo demanda con sistema configurado
 * } | null}
 */
export function sizingRecommendation(worst, loadKwhPerDay, configuredKwp) {
  if (!worst || !worst.dailyYield || !loadKwhPerDay || loadKwhPerDay <= 0) return null;
  const requiredKwp = Math.ceil((loadKwhPerDay / worst.dailyYield) * 100) / 100;
  const configuredYield = configuredKwp * worst.dailyYield;
  const coverage = Math.min(999, Math.round((configuredYield / loadKwhPerDay) * 100));
  const surplus = Math.round((configuredYield - loadKwhPerDay) * 100) / 100;
  return { requiredKwp, coverage, surplusOrDeficit: surplus };
}
