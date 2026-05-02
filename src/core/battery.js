/**
 * battery.js
 * Dimensionamiento y análisis de baterías para sistemas off-grid o
 * autoconsumo con respaldo.
 *
 * Pipeline:
 *   1. Demanda diaria (kWh/día) + días autonomía → capacidad útil necesaria
 *   2. Capacidad bruta = útil / DOD / η_round-trip / temp_factor
 *   3. Costo CAPEX = capacidad × $/kWh química elegida
 *   4. Lifetime = ciclos × frecuencia (1 ciclo/día típico off-grid)
 *   5. LCOS (Levelized Cost of Storage) = CAPEX / (energía total descargable
 *      durante lifetime) descontado
 *   6. Calendario de reemplazos durante vida del proyecto
 *
 * Honestidad sobre limitaciones:
 * - No modelamos curvas de descarga reales (asumimos constante)
 * - El "1 ciclo/día" es promedio off-grid; auto-consumo grid-tied puede ser
 *   menos (en cuyo caso lifetime calendar > lifetime ciclos)
 * - Lead-acid pierde capacidad rápido si DOD se viola; lithium es más perdonante
 * - Costos en USD 2026, evolucionan rápido (lithium baja ~5 %/año típicamente)
 */

/**
 * Catálogo de químicas con parámetros típicos.
 * Costo en USD/kWh nominal.
 */
export const BATTERY_CHEMISTRIES = {
  flooded_lead_acid: {
    name: 'Plomo-ácido inundada (FLA)',
    shortName: 'FLA',
    dodMax: 0.50,           // 50 % - extender vida
    roundTripEfficiency: 0.80,
    cycleLifeAt50DOD: 1500, // ciclos a 50% DOD
    calendarLifeYears: 6,
    costPerKwhUSD: 130,
    selfDischargePct: 5,    // %/mes
    notes: 'Más barato pero pesado, requiere mantenimiento (rellenar agua), ventilación, no inclinable. DOD bajo limita capacidad útil real.',
    suitableFor: 'sistemas pequeños rurales, presupuesto ajustado',
  },
  agm: {
    name: 'Plomo-ácido AGM (sellada)',
    shortName: 'AGM',
    dodMax: 0.50,
    roundTripEfficiency: 0.85,
    cycleLifeAt50DOD: 1200,
    calendarLifeYears: 5,
    costPerKwhUSD: 200,
    selfDischargePct: 3,
    notes: 'Sellada (sin mantenimiento), inclinable, mejor para climas fríos. Vida útil menor que FLA.',
    suitableFor: 'sistemas residenciales pequeños, telecom rural',
  },
  gel: {
    name: 'Plomo-ácido GEL',
    shortName: 'GEL',
    dodMax: 0.50,
    roundTripEfficiency: 0.80,
    cycleLifeAt50DOD: 1400,
    calendarLifeYears: 7,
    costPerKwhUSD: 250,
    selfDischargePct: 2,
    notes: 'Mejor tolerancia a profundidad de descarga ocasional. Buena para climas cálidos (selva).',
    suitableFor: 'estaciones remotas, climas extremos',
  },
  lifepo4: {
    name: 'Litio LFP (Litio Ferro-Fosfato)',
    shortName: 'LFP',
    dodMax: 0.90,
    roundTripEfficiency: 0.95,
    cycleLifeAt80DOD: 5000,
    calendarLifeYears: 12,
    costPerKwhUSD: 400,
    selfDischargePct: 1,
    notes: 'Tecnología actual estándar. Alta densidad, cero mantenimiento, larga vida. La química PV recomendada hoy.',
    suitableFor: 'la mayoría de proyectos modernos: residencial, agrícola, comercial',
  },
  nmc: {
    name: 'Litio NMC (Níquel-Manganeso-Cobalto)',
    shortName: 'NMC',
    dodMax: 0.90,
    roundTripEfficiency: 0.95,
    cycleLifeAt80DOD: 3500,
    calendarLifeYears: 10,
    costPerKwhUSD: 380,
    selfDischargePct: 2,
    notes: 'Mayor densidad energética que LFP pero menos térmicamente estable. Más usado en EVs que estacionario.',
    suitableFor: 'instalaciones donde el espacio/peso son críticos',
  },
};

/**
 * Factor de derating por temperatura para baterías de plomo-ácido.
 * Lithium se ve menos afectado en este rango.
 *
 * @param {string} chemistry
 * @param {number} avgTempC - temperatura promedio operativa
 * @returns {number} factor multiplicativo sobre capacidad nominal
 */
export function temperatureFactor(chemistry, avgTempC) {
  if (avgTempC == null || isNaN(avgTempC)) return 1;
  const isLeadAcid = ['flooded_lead_acid', 'agm', 'gel'].includes(chemistry);
  if (isLeadAcid) {
    // Plomo-ácido pierde capacidad por debajo de 25°C
    // ~5% pérdida por cada 5°C bajo 25
    if (avgTempC < 25) return Math.max(0.7, 1 - (25 - avgTempC) * 0.01);
    if (avgTempC > 35) return Math.max(0.85, 1 - (avgTempC - 35) * 0.02);
    return 1.0;
  }
  // Lithium robusto entre -10 y 45
  if (avgTempC < 0) return 0.9;
  if (avgTempC > 45) return 0.95;
  return 1.0;
}

/**
 * Capacidad bruta de batería requerida.
 *
 * Cap_bruta = (E_diaria × días_aut) / (DOD × η_RT × T_factor × inversor_eff)
 *
 * @param {object} p
 * @param {number} p.dailyKwh - demanda eléctrica diaria
 * @param {number} p.daysAutonomy - días sin sol asumidos
 * @param {string} p.chemistry - clave en BATTERY_CHEMISTRIES
 * @param {number} [p.avgTempC=20] - temp promedio operativa
 * @param {number} [p.inverterEfficiency=0.95] - DC→AC si carga es AC
 * @returns {object} sizing detallado
 */
export function sizeBattery(p) {
  const { dailyKwh, daysAutonomy, chemistry, avgTempC = 20, inverterEfficiency = 0.95 } = p;
  const chem = BATTERY_CHEMISTRIES[chemistry];
  if (!chem || !dailyKwh || !daysAutonomy) return null;

  const tFactor = temperatureFactor(chemistry, avgTempC);
  const usableEnergyNeeded = dailyKwh * daysAutonomy;
  const grossCapacity = usableEnergyNeeded / (chem.dodMax * chem.roundTripEfficiency * tFactor * inverterEfficiency);
  const usableCapacity = grossCapacity * chem.dodMax;
  const capexUSD = grossCapacity * chem.costPerKwhUSD;

  return {
    chemistry,
    chemistryName: chem.name,
    grossCapacityKwh: Math.round(grossCapacity * 100) / 100,
    usableCapacityKwh: Math.round(usableCapacity * 100) / 100,
    dodMax: chem.dodMax,
    roundTripEfficiency: chem.roundTripEfficiency,
    temperatureFactor: tFactor,
    capexUSD: Math.round(capexUSD),
    daysAutonomy,
  };
}

/**
 * Lifetime esperado considerando ciclos + calendario (lo que llegue primero).
 *
 * @param {string} chemistry
 * @param {number} [cyclesPerYear=350] - ciclos típicos: 365 off-grid, 200 grid-tied
 * @returns {object}
 */
export function batteryLifetime(chemistry, cyclesPerYear = 350) {
  const chem = BATTERY_CHEMISTRIES[chemistry];
  if (!chem) return null;
  const cycleLife = chem.cycleLifeAt80DOD || chem.cycleLifeAt50DOD || 1000;
  const yearsByCycles = cycleLife / cyclesPerYear;
  const yearsByCalendar = chem.calendarLifeYears;
  const expectedYears = Math.min(yearsByCycles, yearsByCalendar);
  return {
    yearsByCycles: Math.round(yearsByCycles * 10) / 10,
    yearsByCalendar,
    expectedYears: Math.round(expectedYears * 10) / 10,
    limitedBy: yearsByCycles < yearsByCalendar ? 'cycles' : 'calendar',
  };
}

/**
 * LCOS — Levelized Cost of Storage.
 * Como LCOE pero para almacenamiento. USD por kWh "ciclado".
 *
 *   LCOS = (CAPEX + Σ replacements_t / (1+r)^t) / (Σ E_t / (1+r)^t)
 */
export function calculateLCOS(p) {
  const {
    capexUSD,
    usableCapacityKwh,
    cyclesPerYear = 350,
    chemistry,
    projectLifetime = 20,
    discountRate = 0.08,
  } = p;

  const lifeInfo = batteryLifetime(chemistry, cyclesPerYear);
  if (!lifeInfo) return null;
  const replacements = Math.floor(projectLifetime / lifeInfo.expectedYears);

  let totalCostDisc = capexUSD;
  let totalEnergyDisc = 0;

  for (let t = 1; t <= projectLifetime; t++) {
    const annualEnergy = usableCapacityKwh * cyclesPerYear;
    const df = 1 / Math.pow(1 + discountRate, t);
    totalEnergyDisc += annualEnergy * df;

    if (t > 0 && t < projectLifetime && t % lifeInfo.expectedYears === 0) {
      // Asumir que precio batería baja 5%/año (curva aprendizaje histórica lithium)
      const priceDecline = Math.pow(0.95, t);
      totalCostDisc += capexUSD * priceDecline * df;
    }
  }

  const lcos = totalEnergyDisc > 0 ? totalCostDisc / totalEnergyDisc : null;
  return {
    lcos: lcos != null ? Math.round(lcos * 1000) / 1000 : null,
    replacements,
    nextReplacementYear: lifeInfo.expectedYears,
    totalCostNominalUSD: Math.round(capexUSD * (1 + replacements * 0.7)),
  };
}

/**
 * Análisis end-to-end. Compara las 5 químicas y devuelve la mejor +
 * detalle de todas para mostrar al usuario.
 */
export function batteryAnalysis(p) {
  const {
    dailyKwh,
    daysAutonomy = 2,
    avgTempC = 20,
    cyclesPerYear = 350,
    projectLifetime = 20,
    discountRate = 0.08,
    inverterEfficiency = 0.95,
  } = p;

  if (!dailyKwh || dailyKwh <= 0) return null;

  const results = [];
  for (const chemistry of Object.keys(BATTERY_CHEMISTRIES)) {
    const sizing = sizeBattery({ dailyKwh, daysAutonomy, chemistry, avgTempC, inverterEfficiency });
    if (!sizing) continue;
    const lifetime = batteryLifetime(chemistry, cyclesPerYear);
    const lcos = calculateLCOS({
      capexUSD: sizing.capexUSD,
      usableCapacityKwh: sizing.usableCapacityKwh,
      cyclesPerYear, chemistry, projectLifetime, discountRate,
    });
    results.push({
      chemistry,
      ...sizing,
      lifetime,
      lcos: lcos.lcos,
      replacements: lcos.replacements,
      totalCostNominalUSD: lcos.totalCostNominalUSD,
    });
  }

  // Mejor por LCOS
  results.sort((a, b) => (a.lcos || Infinity) - (b.lcos || Infinity));

  return {
    inputs: { dailyKwh, daysAutonomy, avgTempC, cyclesPerYear, projectLifetime },
    options: results,
    recommended: results[0],
  };
}

/**
 * Recomendación de química según contexto del usuario.
 *
 * @param {object} ctx
 * @param {number} [ctx.budgetUSD] - presupuesto disponible
 * @param {string} [ctx.region] - costa / sierra / selva
 * @param {boolean} [ctx.hasMaintenance] - puede el usuario hacer mantenimiento mensual
 * @param {string} [ctx.useCase] - 'residencial' | 'agricola' | 'telecom' | 'comercial'
 * @returns {{ chemistry: string, reason: string }}
 */
export function recommendChemistry(ctx = {}) {
  const { budgetUSD = Infinity, region, hasMaintenance = false, useCase = 'residencial' } = ctx;

  // Reglas heurísticas basadas en estructura del proyecto
  if (useCase === 'telecom' || useCase === 'comercial') {
    return {
      chemistry: 'lifepo4',
      reason: 'LFP es el estándar industrial actual para sistemas críticos: vida útil 12+ años, cero mantenimiento, alta confiabilidad.',
    };
  }
  if (region === 'selva' || region === 'costa') {
    // Climas cálidos
    return {
      chemistry: 'lifepo4',
      reason: 'En clima cálido (selva/costa), lithium LFP supera ampliamente al plomo-ácido (que pierde capacidad rápido sobre 35°C).',
    };
  }
  if (region === 'sierra' && !hasMaintenance && budgetUSD > 2000) {
    return {
      chemistry: 'lifepo4',
      reason: 'Sierra con presupuesto razonable: LFP es la mejor inversión por LCOS aunque CAPEX inicial sea mayor.',
    };
  }
  if (budgetUSD < 1500 && hasMaintenance) {
    return {
      chemistry: 'flooded_lead_acid',
      reason: 'Presupuesto ajustado + capacidad de mantenimiento: FLA es la opción más barata. Requiere rellenar agua mensualmente.',
    };
  }
  return {
    chemistry: 'lifepo4',
    reason: 'LFP recomendado por defecto: mejor LCOS a 20 años, sin mantenimiento, vida útil 12+ años.',
  };
}
