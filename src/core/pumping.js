/**
 * pumping.js
 * Dimensionamiento de sistemas de bombeo solar agrícola.
 *
 * Pipeline completo:
 *   1. Necesidad de agua (m³/día) → del usuario, opcionalmente desde cultivo+ha
 *   2. TDH (Total Dynamic Head) = altura estática + fricción tubería + presión entrega
 *   3. Potencia hidráulica = ρ × g × Q × H
 *   4. Potencia eléctrica = P_hyd / (η_bomba × η_motor × η_controller)
 *   5. Energía diaria = P_elec × horas_operación
 *   6. kWp solar requerido = E_diaria / (yield_mes_crítico_diario × derating)
 *   7. Recomendación de bomba según Q y H
 *   8. Tanque vs batería decision
 *
 * Convenciones:
 * - Caudal Q en m³/h o m³/día (input usuario)
 * - Altura H en metros
 * - Energía en kWh, potencia en kW
 * - 1 m³ = 1000 L = 1000 kg de agua
 */

const G = 9.81;       // m/s²
const RHO = 1000;     // kg/m³ (agua dulce)
const SECS_HR = 3600;

/**
 * Tipos de bomba con rangos de operación, eficiencias y costos típicos.
 *
 * Q en m³/h, H en m, costo en USD (precio bomba pelada, sin BoS).
 */
export const PUMP_TYPES = {
  helical_surface: {
    name: 'Helicoidal superficial',
    qMin: 0.5, qMax: 5, hMin: 5, hMax: 60,
    efficiency: 0.40,
    costPerKw: 600,
    typicalUse: 'pozos poco profundos, caudal bajo, alta presión',
  },
  helical_submersible: {
    name: 'Helicoidal sumergible',
    qMin: 0.3, qMax: 12, hMin: 30, hMax: 250,
    efficiency: 0.42,
    costPerKw: 800,
    typicalUse: 'pozos profundos (>30 m), caudal bajo-medio',
  },
  centrifugal_surface: {
    name: 'Centrífuga superficial',
    qMin: 3, qMax: 80, hMin: 5, hMax: 35,
    efficiency: 0.60,
    costPerKw: 350,
    typicalUse: 'tomas superficiales (canal, río, pozo somero)',
  },
  centrifugal_submersible: {
    name: 'Centrífuga sumergible',
    qMin: 5, qMax: 150, hMin: 15, hMax: 180,
    efficiency: 0.62,
    costPerKw: 500,
    typicalUse: 'pozos profundos con caudal alto',
  },
  diaphragm: {
    name: 'Diafragma',
    qMin: 0.05, qMax: 1.5, hMin: 0, hMax: 80,
    efficiency: 0.30,
    costPerKw: 1200,
    typicalUse: 'micro-riego, fuentes muy bajas, agua sucia',
  },
};

/**
 * Requerimientos típicos de agua por cultivo en Perú (m³/ha/año).
 * Valores aproximados; varía con clima local, etapa fenológica, sistema de riego.
 *
 * `efficiency`: factor por tipo de riego aplicado:
 *   - inundación: 1.0 (referencia)
 *   - aspersión: 0.75
 *   - goteo: 0.45 (reduce el agua bruta requerida)
 */
export const CROP_WATER_NEEDS = {
  papa: { name: 'Papa', volumeM3HaYear: 4000, monthsActive: 6, season: 'sept-feb' },
  maiz: { name: 'Maíz', volumeM3HaYear: 6000, monthsActive: 6, season: 'oct-mar' },
  arroz: { name: 'Arroz', volumeM3HaYear: 12000, monthsActive: 5, season: 'nov-mar' },
  alfalfa: { name: 'Alfalfa', volumeM3HaYear: 14000, monthsActive: 12, season: 'permanente' },
  hortalizas: { name: 'Hortalizas', volumeM3HaYear: 5000, monthsActive: 12, season: 'permanente' },
  cafe: { name: 'Café', volumeM3HaYear: 5000, monthsActive: 12, season: 'permanente' },
  cacao: { name: 'Cacao', volumeM3HaYear: 5500, monthsActive: 12, season: 'permanente' },
  esparrago: { name: 'Espárrago', volumeM3HaYear: 8000, monthsActive: 10, season: 'casi-permanente' },
  uva: { name: 'Uva (vid)', volumeM3HaYear: 6500, monthsActive: 9, season: 'sept-may' },
  palta: { name: 'Palta (aguacate)', volumeM3HaYear: 7500, monthsActive: 12, season: 'permanente' },
  caña: { name: 'Caña de azúcar', volumeM3HaYear: 18000, monthsActive: 12, season: 'permanente' },
  pasto: { name: 'Pastos / forraje', volumeM3HaYear: 10000, monthsActive: 12, season: 'permanente' },
  ganado_consumo: { name: 'Bebedero ganado (50 L/cabeza/día)', volumeM3HaYear: null, special: 'livestock' },
};

export const IRRIGATION_EFFICIENCY = {
  inundacion: { name: 'Inundación / surcos', factor: 1.00 },
  aspersion: { name: 'Aspersión', factor: 0.75 },
  goteo: { name: 'Goteo', factor: 0.50 },
  microaspersion: { name: 'Microaspersión', factor: 0.55 },
};

/**
 * Pérdida por fricción en tubería (Hazen-Williams simplificado).
 * Aproximación útil para PVC/HDPE típicos en agricultura.
 *
 *   h_f = 10.67 × L × Q^1.852 / (C^1.852 × D^4.87)
 *
 * Donde L=longitud (m), Q=caudal (m³/s), D=diámetro (m), C=coef. material.
 *
 * Coeficientes Hazen-Williams típicos:
 *   PVC nuevo: 150
 *   HDPE: 140
 *   Acero galvanizado: 100
 *   Concreto: 130
 *
 * @param {number} flowM3hr - Caudal (m³/h)
 * @param {number} lengthMeters - Longitud total tubería (m)
 * @param {number} pipeDiameterMm - Diámetro interno (mm)
 * @param {number} [c=140] - Coeficiente Hazen-Williams (default HDPE)
 * @returns {number} Pérdida de carga en metros de columna de agua
 */
export function frictionLoss(flowM3hr, lengthMeters, pipeDiameterMm, c = 140) {
  if (!flowM3hr || !lengthMeters || !pipeDiameterMm) return 0;
  const Q = flowM3hr / 3600; // m³/s
  const D = pipeDiameterMm / 1000; // m
  const hf = 10.67 * lengthMeters * Math.pow(Q, 1.852) /
             (Math.pow(c, 1.852) * Math.pow(D, 4.87));
  return Math.round(hf * 100) / 100;
}

/**
 * Recomendación rápida de diámetro de tubería.
 * Velocidad recomendada para agua: 1.0-2.5 m/s (más alto = más fricción pero más barato)
 *
 * @param {number} flowM3hr
 * @param {number} [targetVelocity=1.5] - m/s
 * @returns {number} Diámetro interno recomendado en mm (redondeado a comercial)
 */
export function recommendPipeDiameter(flowM3hr, targetVelocity = 1.5) {
  if (!flowM3hr || flowM3hr <= 0) return 25;
  const Q = flowM3hr / 3600; // m³/s
  const A = Q / targetVelocity; // m²
  const D_m = Math.sqrt(4 * A / Math.PI);
  const D_mm = D_m * 1000;
  // Snap to commercial sizes (PVC común en Perú)
  const commercial = [25, 32, 40, 50, 63, 75, 90, 110, 140, 160, 200, 250];
  return commercial.find(d => d >= D_mm) || commercial[commercial.length - 1];
}

/**
 * TDH (Total Dynamic Head) = estático + fricción + presión deseada.
 */
export function totalDynamicHead({ staticHead = 0, frictionHead = 0, pressureHead = 0 }) {
  return Math.round((staticHead + frictionHead + pressureHead) * 10) / 10;
}

/**
 * Potencia hidráulica del sistema (kW).
 *   P = ρ × g × Q × H / 1000  [SI, con Q en m³/s]
 *   P = Q[m³/h] × H[m] × 9.81 / 3600  [kW]
 */
export function hydraulicPower(flowM3hr, headM) {
  return (flowM3hr * headM * G) / SECS_HR;
}

/**
 * Potencia eléctrica requerida considerando pérdidas del tren motor-bomba.
 * Para PV directa: η_inverter es 1.0 (DC directo a bomba DC con controlador).
 * Para bomba AC con inversor: η_inverter ≈ 0.95.
 */
export function electricPower(hydraulicKW, opts = {}) {
  const {
    pumpEfficiency = 0.45,
    motorEfficiency = 0.88,
    controllerEfficiency = 0.95,
  } = opts;
  const trainEff = pumpEfficiency * motorEfficiency * controllerEfficiency;
  if (trainEff <= 0) return 0;
  return hydraulicKW / trainEff;
}

/**
 * Energía eléctrica diaria requerida.
 */
export function dailyEnergy(electricKW, hoursPerDay) {
  return electricKW * hoursPerDay;
}

/**
 * kWp PV requerido para cubrir demanda diaria, dimensionado por mes crítico.
 * Aplica derating estándar: soiling × mismatch × cable.
 *
 * @param {number} dailyKwhRequired
 * @param {number} criticalDailyYieldPerKwp - kWh/kWp/día del peor mes (de worstMonth.dailyYield)
 * @param {number} [systemDerating=0.85] - factor sobre yield: 0.95×0.97×0.98 ≈ 0.85
 * @returns {number} kWp recomendado (con +10 % de margen)
 */
export function requiredKwp(dailyKwhRequired, criticalDailyYieldPerKwp, systemDerating = 0.85) {
  if (!criticalDailyYieldPerKwp || criticalDailyYieldPerKwp <= 0) return null;
  const base = dailyKwhRequired / (criticalDailyYieldPerKwp * systemDerating);
  return Math.round(base * 1.1 * 100) / 100; // +10% margen
}

/**
 * Recomienda tipo de bomba según caudal y altura.
 * Devuelve la mejor opción + alternativas.
 */
export function recommendPump(flowM3hr, headM) {
  const candidates = [];
  for (const [id, p] of Object.entries(PUMP_TYPES)) {
    const flowOK = flowM3hr >= p.qMin && flowM3hr <= p.qMax;
    const headOK = headM >= p.hMin && headM <= p.hMax;
    if (flowOK && headOK) {
      candidates.push({ id, ...p, score: 100 });
    } else {
      // Score parcial si está cerca
      const flowDist = flowOK ? 0 : Math.min(
        Math.abs(flowM3hr - p.qMin), Math.abs(flowM3hr - p.qMax)
      ) / Math.max(p.qMax, 1);
      const headDist = headOK ? 0 : Math.min(
        Math.abs(headM - p.hMin), Math.abs(headM - p.hMax)
      ) / Math.max(p.hMax, 1);
      const score = Math.max(0, 100 - (flowDist + headDist) * 50);
      if (score > 30) candidates.push({ id, ...p, score: Math.round(score) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) {
    return {
      primary: null,
      message: 'Caudal/altura fuera del rango común. Considerá multibomba o booster.',
      alternatives: [],
    };
  }
  return {
    primary: candidates[0],
    message: candidates[0].score === 100
      ? 'Punto de operación dentro del rango óptimo.'
      : 'Punto de operación borde del rango. Verificar curva de la bomba específica.',
    alternatives: candidates.slice(1, 3),
  };
}

/**
 * Costo estimado de la bomba según potencia.
 */
export function pumpCost(electricKW, costPerKwUSD = 500) {
  return Math.round(Math.max(electricKW, 0.2) * costPerKwUSD);
}

/**
 * Decisión tanque vs batería para almacenamiento.
 *
 * Regla general agrícola:
 *   - SIEMPRE preferir tanque (más simple, sin reemplazo, sin pérdidas eléctricas)
 *   - Batería solo si: bombeo nocturno obligatorio o tanque imposible (espacio, peso)
 *
 * Costos referenciales Perú 2026:
 *   - Tanque polietileno: $0.10-0.15 USD/L (gratis flete <500 L)
 *   - Tanque metálico: $0.20-0.30 USD/L
 *   - Batería litio LFP: $400 USD/kWh utilizable
 */
export function storageRecommendation({ dailyVolumeM3, dailyKwhPump, daysAutonomy = 2 }) {
  const tankM3 = dailyVolumeM3 * daysAutonomy;
  const tankLiters = tankM3 * 1000;
  const tankCostUSD = Math.round(tankLiters * 0.12);

  const batteryKwh = dailyKwhPump * daysAutonomy / 0.80; // DOD 80% litio
  const batteryCostUSD = Math.round(batteryKwh * 400);

  return {
    tank: {
      capacityLiters: Math.round(tankLiters),
      capacityM3: Math.round(tankM3 * 10) / 10,
      estimatedCostUSD: tankCostUSD,
    },
    battery: {
      capacityKwh: Math.round(batteryKwh * 10) / 10,
      estimatedCostUSD: batteryCostUSD,
    },
    recommendation: tankCostUSD * 1.5 < batteryCostUSD ? 'tank' : 'either',
    reasoning: tankCostUSD * 1.5 < batteryCostUSD
      ? `Tanque ${Math.round(batteryCostUSD / tankCostUSD)}× más barato que batería; sin reemplazo periódico. Recomendado.`
      : `Costos comparables; elegí según restricciones físicas (espacio para tanque vs cuarto técnico para batería).`,
  };
}

/**
 * Demanda de agua a partir de cultivo + hectáreas + tipo de riego.
 */
export function waterFromCrop({ cropId, hectares, irrigationType = 'goteo', headCount = 0 }) {
  const crop = CROP_WATER_NEEDS[cropId];
  const irr = IRRIGATION_EFFICIENCY[irrigationType] || IRRIGATION_EFFICIENCY.goteo;
  if (!crop) return null;

  // Caso especial ganado
  if (crop.special === 'livestock') {
    const dailyM3 = (headCount * 50) / 1000;
    return {
      cropName: crop.name,
      annualM3: Math.round(dailyM3 * 365),
      dailyM3Active: Math.round(dailyM3 * 100) / 100,
      dailyM3Year: Math.round(dailyM3 * 100) / 100,
      monthsActive: 12,
      irrigationFactor: 1.0,
    };
  }

  const baseAnnual = crop.volumeM3HaYear * hectares;
  const adjustedAnnual = baseAnnual * irr.factor;
  const dailyM3Active = adjustedAnnual / (crop.monthsActive * 30);
  const dailyM3Year = adjustedAnnual / 365;

  return {
    cropName: crop.name,
    season: crop.season,
    monthsActive: crop.monthsActive,
    irrigationName: irr.name,
    irrigationFactor: irr.factor,
    annualM3: Math.round(adjustedAnnual),
    dailyM3Active: Math.round(dailyM3Active * 100) / 100,
    dailyM3Year: Math.round(dailyM3Year * 100) / 100,
  };
}

/**
 * Cálculo end-to-end: input simple, output completo.
 */
export function pumpingAnalysis({
  dailyVolumeM3,
  staticHead,
  pipeLengthM = 50,
  pipeDiameterMm = null,
  pressureHead = 0,
  hoursPerDay = 6,
  pumpEfficiency = null,
  criticalDailyYieldPerKwp = null,
  daysAutonomy = 2,
}) {
  if (!dailyVolumeM3 || dailyVolumeM3 <= 0) return null;
  if (staticHead == null) return null;

  const flowM3hr = dailyVolumeM3 / hoursPerDay;

  const diameterMm = pipeDiameterMm || recommendPipeDiameter(flowM3hr);
  const fLoss = frictionLoss(flowM3hr, pipeLengthM, diameterMm);
  const tdh = totalDynamicHead({
    staticHead, frictionHead: fLoss, pressureHead,
  });

  const pumpRec = recommendPump(flowM3hr, tdh);
  const effectiveEff = pumpEfficiency ?? pumpRec.primary?.efficiency ?? 0.45;

  const hydKW = hydraulicPower(flowM3hr, tdh);
  const elecKW = electricPower(hydKW, { pumpEfficiency: effectiveEff });
  const dailyKwh = dailyEnergy(elecKW, hoursPerDay);

  const kWp = criticalDailyYieldPerKwp
    ? requiredKwp(dailyKwh, criticalDailyYieldPerKwp)
    : null;

  const pumpCostUSD = pumpRec.primary
    ? pumpCost(elecKW, pumpRec.primary.costPerKw)
    : null;

  const storage = storageRecommendation({
    dailyVolumeM3, dailyKwhPump: dailyKwh, daysAutonomy,
  });

  return {
    flowM3hr: Math.round(flowM3hr * 100) / 100,
    diameterMm,
    frictionLossM: fLoss,
    tdh,
    pumpEfficiency: effectiveEff,
    hydraulicKW: Math.round(hydKW * 1000) / 1000,
    electricKW: Math.round(elecKW * 1000) / 1000,
    dailyKwh: Math.round(dailyKwh * 100) / 100,
    requiredKwp: kWp,
    pumpRec,
    pumpCostUSD,
    storage,
  };
}
