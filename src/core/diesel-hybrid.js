/**
 * diesel-hybrid.js
 * Análisis híbrido PV + diésel para sitios con genset existente.
 *
 * Caso de uso típico Perú rural:
 *   - Hotel/lodge tiene genset 10 kVA que opera 8 h/día = 1500 L/año
 *   - Antena telecom con genset 5 kVA backup
 *   - Fundo ganadero con bombeo + iluminación
 *   - Centro de salud con refrigeración 24/7
 *
 * El operador YA gasta dinero en diesel. La pregunta no es "¿conviene PV?"
 * sino "¿cuántos kWp óptimos para minimizar costo total?".
 *
 * Sin batería: PV cubre el día, diesel arranca en la noche o cuando el sol falla.
 * Con batería: PV + batería cubren más; diesel sólo en días muy nublados o emergencia.
 */

export const DIESEL_DEFAULTS = {
  // Eficiencia genset (kWh por litro de diésel)
  efficiencyKwhPerL_small: 3.0,    // genset <10 kVA
  efficiencyKwhPerL_medium: 3.5,   // 10-50 kVA
  efficiencyKwhPerL_large: 4.0,    // >50 kVA

  // Costo diésel Perú 2026 (S/. 16/L ÷ 3.7 cambio ≈ $4.3/L)
  costPerLiterUSD: 4.30,

  // Emisiones por litro diésel (factor IPCC + carbón embebido)
  co2PerLiterKg: 2.68,

  // Fracción de demanda diaria que ocurre durante horas con sol (sin batería)
  daytimeDemandShare: 0.60,

  // O&M genset (% costo combustible/año, considera filtros, aceite, repuestos)
  gensetOmRate: 0.05,
};

/**
 * Calcula resultado para un kWp específico.
 *
 * @param {object} p
 * @param {number} p.kwp - Potencia PV (kW pico)
 * @param {number} p.dailyDemandKwh - Demanda diaria en kWh
 * @param {number} p.solarYieldKwhPerKwpPerDay - Producción PV diaria por kWp (mes crítico recomendado)
 * @param {number} [p.efficiency=3.5] - Eficiencia genset kWh/L
 * @param {number} [p.fuelCostUSD=4.3] - Costo $/L diésel
 * @param {boolean} [p.withBattery=false] - Si hay batería
 * @param {number} [p.batteryUsableKwh=0] - Capacidad útil de batería
 * @param {number} [p.daytimeShare=0.6] - Fracción de demanda diurna
 * @returns {object}
 */
function evaluateKwp(p) {
  const {
    kwp, dailyDemandKwh, solarYieldKwhPerKwpPerDay,
    efficiency = DIESEL_DEFAULTS.efficiencyKwhPerL_medium,
    fuelCostUSD = DIESEL_DEFAULTS.costPerLiterUSD,
    withBattery = false,
    batteryUsableKwh = 0,
    daytimeShare = DIESEL_DEFAULTS.daytimeDemandShare,
  } = p;

  // Generación PV diaria
  const dailyPVGenKwh = kwp * solarYieldKwhPerKwpPerDay;

  let dailySolarUsedKwh, dailyDieselKwh, dailyWastedPVKwh;

  if (withBattery && batteryUsableKwh > 0) {
    // Con batería: PV alimenta carga directa + carga batería para noche
    const nightDemand = dailyDemandKwh * (1 - daytimeShare);
    const dayDemand = dailyDemandKwh * daytimeShare;

    // PV cubre demanda diurna primero
    const pvToDay = Math.min(dailyPVGenKwh, dayDemand);
    let pvAvailableForBattery = dailyPVGenKwh - pvToDay;

    // Excedente carga batería hasta capacidad
    const pvToBattery = Math.min(pvAvailableForBattery, batteryUsableKwh);
    pvAvailableForBattery -= pvToBattery;
    // Batería cubre demanda nocturna (con eficiencia 0.95 round-trip)
    const batteryToNight = Math.min(pvToBattery * 0.95, nightDemand);
    const dieselNightKwh = nightDemand - batteryToNight;
    const dieselDayKwh = Math.max(0, dayDemand - pvToDay);

    dailySolarUsedKwh = pvToDay + batteryToNight;
    dailyDieselKwh = dieselDayKwh + dieselNightKwh;
    dailyWastedPVKwh = pvAvailableForBattery;
  } else {
    // Sin batería: PV cubre demanda diurna; resto es desperdiciado
    const dayDemand = dailyDemandKwh * daytimeShare;
    const nightDemand = dailyDemandKwh * (1 - daytimeShare);
    const pvUsed = Math.min(dailyPVGenKwh, dayDemand);
    dailySolarUsedKwh = pvUsed;
    dailyDieselKwh = nightDemand + Math.max(0, dayDemand - pvUsed);
    dailyWastedPVKwh = Math.max(0, dailyPVGenKwh - pvUsed);
  }

  // Anuales
  const annualDemandKwh = dailyDemandKwh * 365;
  const annualSolarKwh = dailySolarUsedKwh * 365;
  const annualDieselEnergyKwh = dailyDieselKwh * 365;
  const annualDieselLiters = annualDieselEnergyKwh / efficiency;
  const annualDieselCost = annualDieselLiters * fuelCostUSD;
  const annualWastedPVKwh = dailyWastedPVKwh * 365;

  // Sin PV, todo el demand vendría del diesel
  const baselineDieselLiters = annualDemandKwh / efficiency;
  const baselineDieselCost = baselineDieselLiters * fuelCostUSD;

  return {
    kwp: Math.round(kwp * 100) / 100,
    dailyPVGenKwh: Math.round(dailyPVGenKwh * 100) / 100,
    dailySolarUsedKwh: Math.round(dailySolarUsedKwh * 100) / 100,
    dailyDieselKwh: Math.round(dailyDieselKwh * 100) / 100,
    dailyWastedPVKwh: Math.round(dailyWastedPVKwh * 100) / 100,
    solarFraction: Math.round((dailySolarUsedKwh / dailyDemandKwh) * 1000) / 10, // %
    annualSolarKwh: Math.round(annualSolarKwh),
    annualDieselLiters: Math.round(annualDieselLiters),
    annualDieselCost: Math.round(annualDieselCost),
    annualLitersSaved: Math.round(baselineDieselLiters - annualDieselLiters),
    annualCostSaved: Math.round(baselineDieselCost - annualDieselCost),
    annualCO2SavedKg: Math.round((baselineDieselLiters - annualDieselLiters) * DIESEL_DEFAULTS.co2PerLiterKg),
  };
}

/**
 * Análisis completo: barre kWp de 0 a límite y encuentra óptimo por costo total
 * (CAPEX amortizado + diesel residual + O&M).
 *
 * @param {object} p
 * @param {number} p.dailyDemandKwh
 * @param {number} p.solarYieldKwhPerKwpPerDay
 * @param {number} p.capexPerKwpUSD - costo CAPEX PV
 * @param {number} [p.lifetimeYears=20]
 * @param {number} [p.discountRate=0.08]
 * @param {number} [p.efficiency=3.5]
 * @param {number} [p.fuelCostUSD=4.3]
 * @param {boolean} [p.withBattery=false]
 * @param {number} [p.batteryUsableKwh=0]
 * @returns {object}
 */
export function dieselHybridAnalysis(p) {
  const {
    dailyDemandKwh,
    solarYieldKwhPerKwpPerDay,
    capexPerKwpUSD,
    lifetimeYears = 20,
    discountRate = 0.08,
    efficiency = DIESEL_DEFAULTS.efficiencyKwhPerL_medium,
    fuelCostUSD = DIESEL_DEFAULTS.costPerLiterUSD,
    withBattery = false,
    batteryUsableKwh = 0,
    fuelEscalation = 0.04, // diésel sube ~4 %/año históricamente
  } = p;

  if (!dailyDemandKwh || !solarYieldKwhPerKwpPerDay || !capexPerKwpUSD) return null;

  // Caso baseline: sin PV
  const baseline = evaluateKwp({
    kwp: 0, dailyDemandKwh, solarYieldKwhPerKwpPerDay, efficiency, fuelCostUSD,
  });

  // Barrer kWp de 0.5 hasta 3× la demanda nominal por horas-pico
  const maxKwp = Math.max(2, dailyDemandKwh * 1.5);
  const candidates = [];
  for (let k = 0.5; k <= maxKwp; k += 0.5) {
    const evalResult = evaluateKwp({
      kwp: k, dailyDemandKwh, solarYieldKwhPerKwpPerDay,
      efficiency, fuelCostUSD, withBattery, batteryUsableKwh,
    });
    const capex = k * capexPerKwpUSD;
    // NPV total cost (CAPEX + costos de diesel descontados durante vida útil)
    let totalNPVCost = capex;
    for (let t = 1; t <= lifetimeYears; t++) {
      const dieselCostT = evalResult.annualDieselCost * Math.pow(1 + fuelEscalation, t - 1);
      totalNPVCost += dieselCostT / Math.pow(1 + discountRate, t);
    }
    candidates.push({ ...evalResult, capex, totalNPVCost: Math.round(totalNPVCost) });
  }

  // Baseline NPV cost (sin PV)
  let baselineNPVCost = 0;
  for (let t = 1; t <= lifetimeYears; t++) {
    const dieselCostT = baseline.annualDieselCost * Math.pow(1 + fuelEscalation, t - 1);
    baselineNPVCost += dieselCostT / Math.pow(1 + discountRate, t);
  }
  baselineNPVCost = Math.round(baselineNPVCost);

  // Encuentra mínimo costo total
  const optimal = candidates.reduce((min, c) =>
    c.totalNPVCost < min.totalNPVCost ? c : min
  );

  // Payback simple del kWp óptimo: CAPEX / ahorro año 1
  const optimalPayback = optimal.annualCostSaved > 0
    ? optimal.capex / optimal.annualCostSaved
    : null;

  // NPV del proyecto solar (ahorros descontados - CAPEX)
  let solarNPV = -optimal.capex;
  for (let t = 1; t <= lifetimeYears; t++) {
    const savingsT = optimal.annualCostSaved * Math.pow(1 + fuelEscalation, t - 1);
    solarNPV += savingsT / Math.pow(1 + discountRate, t);
  }

  return {
    baseline: {
      ...baseline,
      annualLitersDiesel: baseline.annualDieselLiters,
      annualCostDiesel: baseline.annualDieselCost,
      npvCost20yr: baselineNPVCost,
    },
    optimal: {
      ...optimal,
      capex: Math.round(optimal.capex),
      simplePaybackYears: optimalPayback != null ? Math.round(optimalPayback * 10) / 10 : null,
      npvSavings: Math.round(solarNPV),
      savingsRatio: Math.round((1 - optimal.annualDieselCost / baseline.annualDieselCost) * 1000) / 10, // %
    },
    candidates,
    parameters: {
      lifetimeYears, discountRate, efficiency, fuelCostUSD,
      fuelEscalation, withBattery, batteryUsableKwh,
    },
  };
}

/**
 * Recomienda eficiencia genset según capacidad nominal.
 */
export function recommendGensetEfficiency(capacityKVA) {
  if (!capacityKVA || capacityKVA < 10) return DIESEL_DEFAULTS.efficiencyKwhPerL_small;
  if (capacityKVA < 50) return DIESEL_DEFAULTS.efficiencyKwhPerL_medium;
  return DIESEL_DEFAULTS.efficiencyKwhPerL_large;
}

/**
 * Calcula consumo histórico de diesel a partir de horas operación + demanda promedio.
 * Útil cuando el usuario tiene horas pero no consumo medido.
 */
export function estimateAnnualDiesel({
  capacityKVA,
  loadFactor = 0.5,        // genset típico opera al 50% de su capacidad
  hoursPerDay = 8,
  daysPerYear = 365,
}) {
  const efficiency = recommendGensetEfficiency(capacityKVA);
  const avgKw = capacityKVA * loadFactor * 0.8; // factor de potencia 0.8
  const annualKwh = avgKw * hoursPerDay * daysPerYear;
  const annualLiters = annualKwh / efficiency;
  return {
    annualKwh: Math.round(annualKwh),
    annualLiters: Math.round(annualLiters),
    averageKw: Math.round(avgKw * 100) / 100,
    efficiencyAssumed: efficiency,
  };
}
