/**
 * economics.js
 * Análisis económico de proyectos PV: CAPEX, LCOE, payback, NPV, IRR.
 *
 * Tres modos de uso:
 *   1. grid-tied  → ahorro = energía × tarifa eléctrica
 *   2. off-grid   → ahorro = energía × costo diésel desplazado (típico riego/bombeo)
 *   3. ppa        → ingreso = energía × precio inyección red
 *
 * Convenciones:
 * - Costos en USD por defecto (Perú: tipo de cambio ~3.7 S/./USD en 2026)
 * - Año 1 = primer año completo de operación
 * - Degradación aplicada año a año (0.5%/año típico c-Si)
 * - O&M como % del CAPEX (default 1%, valor industria)
 * - Discount rate 8% nominal (estándar análisis financiero PV en Perú)
 */

/**
 * Energía generada en año t considerando degradación lineal.
 * @param {number} firstYearEnergy - kWh totales en año 1
 * @param {number} year - 1 = primer año
 * @param {number} degradationRate - fracción/año (0.005 = 0.5%)
 */
export function annualEnergyAtYear(firstYearEnergy, year, degradationRate = 0.005) {
  return firstYearEnergy * Math.pow(1 - degradationRate, year - 1);
}

/**
 * Discount factor para año t con tasa r.
 */
function df(year, r) {
  return 1 / Math.pow(1 + r, year);
}

/**
 * Cálculo completo de economía para un proyecto PV.
 *
 * @param {object} p
 * @param {number} p.kWp - Potencia instalada
 * @param {number} p.annualEnergyKwhPerKwp - Yield kWh/kWp/año (de la calculadora)
 * @param {number} p.capexPerKwp - Costo de instalación (USD/kWp)
 * @param {number} p.energyPrice - Precio de energía ahorrada o vendida (USD/kWh)
 * @param {number} [p.lifetimeYears=20]
 * @param {number} [p.discountRate=0.08]
 * @param {number} [p.omRate=0.01] - 1% del CAPEX por año (industria)
 * @param {number} [p.degradationRate=0.005] - 0.5%/año (c-Si típico)
 * @param {number} [p.escalation=0] - inflación de precio energía/año (0 = constante)
 * @returns {object} métricas económicas
 */
export function solarEconomics(p) {
  const {
    kWp, annualEnergyKwhPerKwp, capexPerKwp, energyPrice,
    lifetimeYears = 20, discountRate = 0.08,
    omRate = 0.01, degradationRate = 0.005, escalation = 0,
  } = p;

  if (!kWp || !annualEnergyKwhPerKwp || !capexPerKwp || !energyPrice) {
    return null;
  }

  const capex = kWp * capexPerKwp;
  const firstYearEnergy = kWp * annualEnergyKwhPerKwp;
  const annualOM = capex * omRate;
  const firstYearRevenue = firstYearEnergy * energyPrice;

  // Series temporales para cálculos
  let totalEnergy = 0, totalRevenue = 0;
  let totalEnergyDisc = 0, totalOMDisc = 0;
  let npv = -capex;
  const cashflows = [-capex];
  let cumulative = -capex;
  let paybackYearExact = null;

  for (let t = 1; t <= lifetimeYears; t++) {
    const energy = annualEnergyAtYear(firstYearEnergy, t, degradationRate);
    const price = energyPrice * Math.pow(1 + escalation, t - 1);
    const revenue = energy * price;
    const netCF = revenue - annualOM;
    const factor = df(t, discountRate);

    totalEnergy += energy;
    totalRevenue += revenue;
    totalEnergyDisc += energy * factor;
    totalOMDisc += annualOM * factor;
    npv += netCF * factor;
    cashflows.push(netCF);

    const prevCumulative = cumulative;
    cumulative += netCF;
    // Payback descontado: año en que el cumulative cruza 0
    if (paybackYearExact === null && cumulative >= 0) {
      // Interpolación lineal del año fraccional
      paybackYearExact = (t - 1) + (-prevCumulative) / netCF;
    }
  }

  // LCOE = (CAPEX + Σ OM/(1+r)^t) / (Σ E/(1+r)^t)
  const lcoe = totalEnergyDisc > 0
    ? (capex + totalOMDisc) / totalEnergyDisc
    : null;

  // Payback simple = CAPEX / ahorro neto año 1
  const simplePayback = (firstYearRevenue - annualOM) > 0
    ? capex / (firstYearRevenue - annualOM)
    : null;

  // IRR
  const irr = calculateIRR(cashflows);

  return {
    capex: Math.round(capex),
    firstYearEnergy: Math.round(firstYearEnergy),
    firstYearRevenue: Math.round(firstYearRevenue),
    totalEnergyMWh: Math.round(totalEnergy / 1000),
    totalRevenue: Math.round(totalRevenue),
    annualOM: Math.round(annualOM),
    lcoe: lcoe != null ? Math.round(lcoe * 1000) / 1000 : null,
    simplePaybackYears: simplePayback != null ? Math.round(simplePayback * 10) / 10 : null,
    discountedPaybackYears: paybackYearExact != null ? Math.round(paybackYearExact * 10) / 10 : null,
    npv: Math.round(npv),
    irr: irr != null ? Math.round(irr * 10000) / 100 : null, // %
  };
}

/**
 * Internal Rate of Return vía Newton-Raphson.
 * Devuelve la tasa que hace NPV=0 (en fracción, ej. 0.12 = 12%).
 *
 * @param {number[]} cashflows - [-capex, cf1, cf2, ...]
 * @param {number} [guess=0.1]
 * @param {number} [tolerance=1e-5]
 * @param {number} [maxIter=200]
 * @returns {number|null} tasa de retorno o null si no converge
 */
export function calculateIRR(cashflows, guess = 0.1, tolerance = 1e-5, maxIter = 200) {
  if (!cashflows || cashflows.length < 2) return null;
  // Verificar que haya al menos un cambio de signo (necesario para IRR real)
  const hasNegative = cashflows.some(cf => cf < 0);
  const hasPositive = cashflows.some(cf => cf > 0);
  if (!hasNegative || !hasPositive) return null;

  let r = guess;
  for (let iter = 0; iter < maxIter; iter++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const denom = Math.pow(1 + r, t);
      npv += cashflows[t] / denom;
      if (t > 0) dnpv -= t * cashflows[t] / (denom * (1 + r));
    }
    if (Math.abs(dnpv) < 1e-12) return null;
    const newR = r - npv / dnpv;
    if (!isFinite(newR) || newR < -0.99) return null;
    if (Math.abs(newR - r) < tolerance) return newR;
    r = newR;
  }
  return null;
}

/**
 * Defaults realistas para Perú 2026.
 * Tipo de cambio referencia: 3.7 S/./USD.
 */
export const PERU_DEFAULTS = {
  // CAPEX típico instalado, listo para operar
  capexResidentialUSD: 1000,    // $/kWp para sistemas <10 kWp
  capexCommercialUSD: 850,      // $/kWp para 10-100 kWp
  capexUtilityUSD: 700,         // $/kWp para >1 MWp

  // Precios de electricidad
  rateBT5BResidentialUSD: 0.135, // ~S/. 0.50/kWh
  rateMTComercialUSD: 0.110,     // ~S/. 0.40/kWh
  feedInTariffUSD: 0.040,        // venta a red en Perú es bajo

  // Off-grid: costo diésel desplazado
  // Diésel ~S/. 16/L en 2026, 1L ≈ 3 kWh en genset pequeño → S/. 5/kWh ≈ $1.35/kWh
  dieselCostUSDPerKwh: 1.35,

  // Parámetros financieros estándar
  lifetimeYears: 20,
  discountRate: 0.08,
  omRate: 0.01,
  degradationRate: 0.005,
  escalation: 0.025, // 2.5% inflación anual energía
};

/**
 * Categoría cualitativa del payback (años).
 */
export function paybackCategory(years) {
  if (years == null) return 'no rentable';
  if (years <= 5) return 'excelente';
  if (years <= 8) return 'muy bueno';
  if (years <= 12) return 'aceptable';
  if (years <= 18) return 'marginal';
  return 'no rentable';
}
