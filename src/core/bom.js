/**
 * bom.js
 * Bill of Materials + cotización formal para sistemas PV en Perú.
 *
 * Precios referenciados Perú 2026 (mercado distribuidor mayorista):
 *   PROENERGÍA, AUTOSOLAR PERÚ, SUNNYWAY, ECOSOLAR, ANYWHERE SOLAR
 *
 * Convenciones:
 * - Precios en USD; conversión a PEN (S/.) usando tipo de cambio configurable
 *   (default 3.7 S/./USD para 2026)
 * - Mano de obra calculada por kWp instalado (default $0.10/Wp = $100/kWp)
 * - IGV 18 % se aplica al final
 * - Margen utilidad configurable (default 20 %, rango sano 15-30 %)
 *
 * El generador adapta el BOM al sistema configurado:
 *   - Sólo solar
 *   - Solar + batería
 *   - Solar + bombeo (usa resultado de pumping.js)
 *   - Solar + diesel híbrido (necesita ATS)
 *   - Cualquier combinación
 */

/**
 * Catálogo de precios USD 2026 mercado peruano.
 * Cada item: { id, category, name, unit, price, supplier, notes }
 *
 * Nota: precios pueden variar ±15 % según proveedor y volumen. Estos son
 * referenciales — usuario debería ajustar con cotización real del proveedor.
 */
export const COMPONENT_CATALOG = {
  // ════ PANELES ════
  panel_550: {
    category: 'paneles',
    name: 'Panel mono PERC 550 Wp (tier-1: Jinko/Trina/Longi/JA)',
    unit: 'panel',
    price: 165,
    wattage: 550,
    supplier: 'PROENERGÍA / AUTOSOLAR PERÚ',
  },
  panel_450: {
    category: 'paneles',
    name: 'Panel mono PERC 450 Wp',
    unit: 'panel',
    price: 130,
    wattage: 450,
    supplier: 'mercado general',
  },

  // ════ INVERSORES ════
  inverter_string_3kw: { category: 'inversion', name: 'Inversor string 3 kW (Growatt/Sungrow/SMA)', unit: 'unidad', price: 700, kw: 3 },
  inverter_string_5kw: { category: 'inversion', name: 'Inversor string 5 kW', unit: 'unidad', price: 950, kw: 5 },
  inverter_string_10kw: { category: 'inversion', name: 'Inversor string 10 kW trifásico', unit: 'unidad', price: 1800, kw: 10 },
  inverter_string_20kw: { category: 'inversion', name: 'Inversor string 20 kW trifásico', unit: 'unidad', price: 3200, kw: 20 },
  inverter_string_50kw: { category: 'inversion', name: 'Inversor string 50 kW trifásico (comercial)', unit: 'unidad', price: 6500, kw: 50 },
  inverter_hybrid_5kw: { category: 'inversion', name: 'Inversor híbrido 5 kW (PV+batería+grid)', unit: 'unidad', price: 1800, kw: 5 },
  inverter_hybrid_10kw: { category: 'inversion', name: 'Inversor híbrido 10 kW trifásico', unit: 'unidad', price: 3000, kw: 10 },

  // ════ ESTRUCTURA / MONTAJE ════
  mount_roof_tile: { category: 'estructura', name: 'Estructura cubierta inclinada (tejado/calamina)', unit: 'panel', price: 35 },
  mount_roof_flat: { category: 'estructura', name: 'Estructura cubierta plana (tipo lastre + ángulo)', unit: 'panel', price: 45 },
  mount_ground: { category: 'estructura', name: 'Estructura suelo (hincado)', unit: 'panel', price: 60 },
  mount_tracker_1axis: { category: 'estructura', name: 'Tracker 1-eje (utility scale)', unit: 'panel', price: 180 },

  // ════ BATERÍAS ════
  battery_lfp_5kwh: { category: 'almacenamiento', name: 'Batería LFP 5 kWh (BYD/Pylontech/Dyness)', unit: 'unidad', price: 2000, kwh: 5 },
  battery_lfp_10kwh: { category: 'almacenamiento', name: 'Batería LFP 10 kWh', unit: 'unidad', price: 3800, kwh: 10 },
  battery_lfp_15kwh: { category: 'almacenamiento', name: 'Batería LFP 15 kWh', unit: 'unidad', price: 5500, kwh: 15 },
  battery_agm_2_4kwh: { category: 'almacenamiento', name: 'Batería AGM 12V 200Ah (2.4 kWh)', unit: 'unidad', price: 480, kwh: 2.4 },
  battery_fla_2_4kwh: { category: 'almacenamiento', name: 'Batería FLA 12V 200Ah (2.4 kWh)', unit: 'unidad', price: 320, kwh: 2.4 },

  // ════ CABLEADO DC ════
  cable_dc_10awg: { category: 'cableado', name: 'Cable solar DC 10 AWG (6 mm²) doble aislamiento', unit: 'm', price: 2.5 },
  cable_dc_8awg: { category: 'cableado', name: 'Cable solar DC 8 AWG (10 mm²)', unit: 'm', price: 3.5 },
  cable_dc_6awg: { category: 'cableado', name: 'Cable solar DC 6 AWG (16 mm²)', unit: 'm', price: 5.0 },
  cable_dc_4awg: { category: 'cableado', name: 'Cable solar DC 4 AWG (25 mm²)', unit: 'm', price: 7.5 },

  // ════ CABLEADO AC ════
  cable_ac_thw_12: { category: 'cableado', name: 'Cable AC THW-LS 12 AWG (4 mm²)', unit: 'm', price: 2.0 },
  cable_ac_thw_10: { category: 'cableado', name: 'Cable AC THW-LS 10 AWG (6 mm²)', unit: 'm', price: 3.0 },
  cable_ac_thw_8: { category: 'cableado', name: 'Cable AC THW-LS 8 AWG (10 mm²)', unit: 'm', price: 4.5 },
  cable_ac_thw_6: { category: 'cableado', name: 'Cable AC THW-LS 6 AWG (16 mm²)', unit: 'm', price: 6.5 },
  cable_ac_thw_4: { category: 'cableado', name: 'Cable AC THW-LS 4 AWG (25 mm²)', unit: 'm', price: 9.0 },

  // ════ CONDUIT / TUBERÍA ════
  conduit_pvc_3_4: { category: 'cableado', name: 'Tubería PVC SAP 3/4"', unit: 'm', price: 1.8 },
  conduit_pvc_1: { category: 'cableado', name: 'Tubería PVC SAP 1"', unit: 'm', price: 2.4 },
  conduit_pvc_1_5: { category: 'cableado', name: 'Tubería PVC SAP 1½"', unit: 'm', price: 3.5 },

  // ════ PROTECCIONES ════
  combiner_dc_2string: { category: 'protecciones', name: 'Combiner box DC 2 strings con DPS y fusibles', unit: 'unidad', price: 120 },
  combiner_dc_4string: { category: 'protecciones', name: 'Combiner box DC 4 strings con DPS y fusibles', unit: 'unidad', price: 180 },
  combiner_dc_8string: { category: 'protecciones', name: 'Combiner box DC 8 strings con DPS y fusibles', unit: 'unidad', price: 320 },
  dps_dc: { category: 'protecciones', name: 'Descargador atmosférico DC (DPS Tipo 2)', unit: 'unidad', price: 90 },
  dps_ac: { category: 'protecciones', name: 'Descargador atmosférico AC (DPS Tipo 2)', unit: 'unidad', price: 75 },
  breaker_dc: { category: 'protecciones', name: 'Breaker DC magnetotérmico bipolar', unit: 'unidad', price: 30 },
  breaker_ac_1p: { category: 'protecciones', name: 'Breaker AC monofásico (caja)', unit: 'unidad', price: 18 },
  breaker_ac_3p: { category: 'protecciones', name: 'Breaker AC trifásico (caja)', unit: 'unidad', price: 45 },
  fuse_dc: { category: 'protecciones', name: 'Fusible DC + portafusible (gPV)', unit: 'unidad', price: 12 },
  panelboard_ac: { category: 'protecciones', name: 'Tablero eléctrico AC IP65 (8 polos)', unit: 'unidad', price: 150 },
  panelboard_main: { category: 'protecciones', name: 'Tablero principal modificación + interconexión', unit: 'unidad', price: 200 },

  // ════ PUESTA A TIERRA ════
  ground_kit: { category: 'tierra', name: 'Sistema puesta a tierra (varilla + cable + grapa + caja registro)', unit: 'unidad', price: 80 },

  // ════ ATS / TRANSFER ════
  ats_5kw: { category: 'auxiliares', name: 'ATS automático 5 kW (PV/genset)', unit: 'unidad', price: 280 },
  ats_15kw: { category: 'auxiliares', name: 'ATS automático 15 kW (PV/genset trifásico)', unit: 'unidad', price: 580 },
  ats_50kw: { category: 'auxiliares', name: 'ATS automático 50 kW (PV/genset comercial)', unit: 'unidad', price: 1800 },

  // ════ MONITOREO ════
  monitoring_basic: { category: 'auxiliares', name: 'Sistema de monitoreo básico (WiFi data logger)', unit: 'unidad', price: 150 },
  monitoring_pro: { category: 'auxiliares', name: 'Sistema de monitoreo profesional (mediciones + alarmas + plataforma)', unit: 'unidad', price: 600 },
  meter_bidirectional: { category: 'auxiliares', name: 'Medidor bidireccional certificado OSINERGMIN', unit: 'unidad', price: 250 },

  // ════ BOMBEO ════
  pump_helical_surface_1kw: { category: 'bombeo', name: 'Bomba helicoidal superficial ~1 kW (Lorentz/Grundfos)', unit: 'unidad', price: 800 },
  pump_helical_submersible_1kw: { category: 'bombeo', name: 'Bomba helicoidal sumergible ~1 kW', unit: 'unidad', price: 1100 },
  pump_centrifugal_surface_1kw: { category: 'bombeo', name: 'Bomba centrífuga superficial ~1 kW', unit: 'unidad', price: 450 },
  pump_centrifugal_submersible_2kw: { category: 'bombeo', name: 'Bomba centrífuga sumergible ~2 kW', unit: 'unidad', price: 950 },
  pump_controller_solar: { category: 'bombeo', name: 'Controlador solar de bomba (MPPT integrado)', unit: 'unidad', price: 350 },

  // ════ TANQUES ════
  tank_pe_1000l: { category: 'almacenamiento_agua', name: 'Tanque polietileno 1,000 L (Rotoplas/Eternit)', unit: 'unidad', price: 130 },
  tank_pe_2500l: { category: 'almacenamiento_agua', name: 'Tanque polietileno 2,500 L', unit: 'unidad', price: 280 },
  tank_pe_5000l: { category: 'almacenamiento_agua', name: 'Tanque polietileno 5,000 L', unit: 'unidad', price: 580 },
  tank_pe_10000l: { category: 'almacenamiento_agua', name: 'Tanque polietileno 10,000 L', unit: 'unidad', price: 1100 },
};

/**
 * Selecciona el inversor más adecuado para una potencia kWp dada.
 * Strategy: 80-110 % oversizing, prefer string normal a hybrid si no hay batería.
 */
function pickInverter(kWp, withBattery = false) {
  const targetKW = kWp * 0.95; // ~5 % derating en el inversor vs paneles
  if (withBattery) {
    if (targetKW <= 5) return { id: 'inverter_hybrid_5kw', count: 1 };
    if (targetKW <= 10) return { id: 'inverter_hybrid_10kw', count: 1 };
    // Para >10 kW híbrido, varias unidades 10 kW en paralelo
    return { id: 'inverter_hybrid_10kw', count: Math.ceil(targetKW / 10) };
  }
  if (targetKW <= 3) return { id: 'inverter_string_3kw', count: 1 };
  if (targetKW <= 5) return { id: 'inverter_string_5kw', count: 1 };
  if (targetKW <= 10) return { id: 'inverter_string_10kw', count: 1 };
  if (targetKW <= 20) return { id: 'inverter_string_20kw', count: 1 };
  if (targetKW <= 50) return { id: 'inverter_string_50kw', count: 1 };
  return { id: 'inverter_string_50kw', count: Math.ceil(targetKW / 50) };
}

/**
 * Selecciona configuración de batería (cantidad de unidades de tamaño elegido).
 */
function pickBatteries(neededKwh, chemistry = 'lifepo4') {
  if (chemistry === 'flooded_lead_acid' || chemistry === 'agm') {
    const id = chemistry === 'agm' ? 'battery_agm_2_4kwh' : 'battery_fla_2_4kwh';
    return { id, count: Math.ceil(neededKwh / 2.4) };
  }
  // LFP — escoger la combinación más eficiente de 5/10/15 kWh
  if (neededKwh <= 5) return { id: 'battery_lfp_5kwh', count: 1 };
  if (neededKwh <= 10) return { id: 'battery_lfp_10kwh', count: 1 };
  if (neededKwh <= 15) return { id: 'battery_lfp_15kwh', count: 1 };
  // >15 kWh: combina 15+10+5 según necesidad
  return { id: 'battery_lfp_15kwh', count: Math.ceil(neededKwh / 15) };
}

/**
 * Selecciona tanque de agua según volumen requerido (m³).
 */
function pickTank(volumeM3) {
  const liters = volumeM3 * 1000;
  if (liters <= 1000) return { id: 'tank_pe_1000l', count: 1 };
  if (liters <= 2500) return { id: 'tank_pe_2500l', count: 1 };
  if (liters <= 5000) return { id: 'tank_pe_5000l', count: 1 };
  if (liters <= 10000) return { id: 'tank_pe_10000l', count: 1 };
  return { id: 'tank_pe_10000l', count: Math.ceil(liters / 10000) };
}

/**
 * Recomienda calibre AC según corriente y caída de tensión <2 % típica.
 */
function pickAcCable(kw, distanceM, voltage = 220) {
  // I = P / V (asumimos monofásico 220V residencial Perú; trifásico 380 ajusta)
  const isThreePhase = kw > 10;
  const v = isThreePhase ? 380 : 220;
  const current = (kw * 1000) / v;
  // Reglas simplificadas calibre-corriente:
  if (current <= 25) return 'cable_ac_thw_12';
  if (current <= 35) return 'cable_ac_thw_10';
  if (current <= 50) return 'cable_ac_thw_8';
  if (current <= 70) return 'cable_ac_thw_6';
  return 'cable_ac_thw_4';
}

/**
 * Selecciona bomba del catálogo según el resultado de pumping.js.
 */
function pickPump(pumpingResult) {
  if (!pumpingResult || !pumpingResult.pumpRec?.primary) return null;
  const type = pumpingResult.pumpRec.primary.id;
  const kw = pumpingResult.electricKW;
  // Mapeo aproximado al catálogo (1 unidad por sistema)
  if (type === 'helical_surface') return { id: 'pump_helical_surface_1kw', count: 1 };
  if (type === 'helical_submersible') return { id: 'pump_helical_submersible_1kw', count: 1 };
  if (type === 'centrifugal_surface') return { id: 'pump_centrifugal_surface_1kw', count: 1 };
  if (type === 'centrifugal_submersible') return { id: 'pump_centrifugal_submersible_2kw', count: 1 };
  return { id: 'pump_centrifugal_surface_1kw', count: 1 };
}

/**
 * Genera BOM completo + cotización.
 *
 * @param {object} p
 * @param {number} p.kWp - Potencia PV (kWp)
 * @param {number} [p.batteryKwh] - Capacidad batería bruta (si aplica)
 * @param {string} [p.batteryChemistry='lifepo4']
 * @param {object} [p.pumping] - Resultado de pumpingAnalysis() si aplica
 * @param {object} [p.diesel] - Resultado de dieselHybridAnalysis() si aplica
 * @param {string} [p.mountingType='roof_tile'] - roof_tile|roof_flat|ground|tracker_1axis
 * @param {number} [p.distanceToTableroM=20] - distancia inversor a tablero principal
 * @param {string} [p.region='costa'] - costa|sierra|selva (para flete)
 * @param {number} [p.profitMargin=0.20] - 0–1
 * @param {number} [p.laborPerWp=0.10] - $/Wp instalado
 * @param {number} [p.exchangeRate=3.7] - S/./USD
 * @param {boolean} [p.includePermits=true]
 * @param {boolean} [p.includeMonitoring=true]
 * @param {boolean} [p.includeBidirectionalMeter=false] - sólo grid-tied
 * @returns {object} BOM completo
 */
export function generateBOM(p) {
  const {
    kWp,
    batteryKwh = 0,
    batteryChemistry = 'lifepo4',
    pumping = null,
    diesel = null,
    mountingType = 'roof_tile',
    distanceToTableroM = 20,
    region = 'costa',
    profitMargin = 0.20,
    laborPerWp = 0.10,
    exchangeRate = 3.7,
    includePermits = true,
    includeMonitoring = true,
    includeBidirectionalMeter = false,
    panelWattage = 550,
  } = p;

  if (!kWp || kWp <= 0) return null;

  const items = [];

  // Helper para añadir items con look-up al catálogo
  const add = (catalogId, count, opts = {}) => {
    const c = COMPONENT_CATALOG[catalogId];
    if (!c) return null;
    const qty = Math.ceil(count);
    const price = opts.priceOverride ?? c.price;
    const subtotal = qty * price;
    items.push({
      id: catalogId,
      category: c.category,
      name: c.name,
      quantity: qty,
      unit: c.unit,
      unitPrice: price,
      subtotal,
      supplier: c.supplier,
      notes: opts.notes,
    });
    return subtotal;
  };

  // ═══ 1. PANELES ═══
  const panelId = panelWattage === 450 ? 'panel_450' : 'panel_550';
  const panelInfo = COMPONENT_CATALOG[panelId];
  const panelCount = Math.ceil((kWp * 1000) / panelInfo.wattage);
  add(panelId, panelCount);

  // ═══ 2. ESTRUCTURA ═══
  const mountId = `mount_${mountingType}`;
  add(mountId in COMPONENT_CATALOG ? mountId : 'mount_roof_tile', panelCount);

  // ═══ 3. INVERSOR ═══
  const invSel = pickInverter(kWp, batteryKwh > 0);
  add(invSel.id, invSel.count);

  // ═══ 4. CABLEADO DC ═══
  // ~3 m por panel (interconexión strings) + 10 m al inversor
  const dcLength = panelCount * 3 + 10;
  // Calibre DC según corriente: 8 AWG para sistemas pequeños, 6 para >5kW
  const dcCableId = kWp <= 3 ? 'cable_dc_10awg' : kWp <= 8 ? 'cable_dc_8awg' : 'cable_dc_6awg';
  add(dcCableId, dcLength * 2); // ida + vuelta (DC requiere par)
  add('conduit_pvc_3_4', dcLength); // tubería para DC

  // ═══ 5. PROTECCIONES DC ═══
  const stringCount = Math.ceil(panelCount / 12); // típico 10-14 paneles por string
  const combinerId = stringCount <= 2 ? 'combiner_dc_2string'
                  : stringCount <= 4 ? 'combiner_dc_4string'
                  : 'combiner_dc_8string';
  add(combinerId, 1);
  add('dps_dc', 1);
  add('breaker_dc', stringCount);
  add('fuse_dc', stringCount * 2); // un fusible por polaridad

  // ═══ 6. CABLEADO AC ═══
  const acCableId = pickAcCable(kWp, distanceToTableroM);
  add(acCableId, distanceToTableroM * 3); // L1, L2 (o L3+N+T trifásico)
  add('conduit_pvc_1', distanceToTableroM);

  // ═══ 7. PROTECCIONES AC ═══
  add('dps_ac', 1);
  add(kWp > 10 ? 'breaker_ac_3p' : 'breaker_ac_1p', 1);
  add('panelboard_ac', 1);
  add('panelboard_main', 1, { notes: 'modificación tablero existente + acometida' });

  // ═══ 8. PUESTA A TIERRA ═══
  add('ground_kit', 1);

  // ═══ 9. BATERÍAS ═══
  if (batteryKwh > 0) {
    const batSel = pickBatteries(batteryKwh, batteryChemistry);
    add(batSel.id, batSel.count);
  }

  // ═══ 10. ATS si diesel híbrido ═══
  if (diesel) {
    const atsId = kWp <= 5 ? 'ats_5kw' : kWp <= 15 ? 'ats_15kw' : 'ats_50kw';
    add(atsId, 1, { notes: 'transferencia automática PV/genset existente' });
  }

  // ═══ 11. BOMBA + TANQUE si bombeo ═══
  if (pumping) {
    const pumpSel = pickPump(pumping);
    if (pumpSel) add(pumpSel.id, pumpSel.count);
    add('pump_controller_solar', 1, { notes: 'controlador MPPT específico para bomba' });
    if (pumping.storage?.tank?.capacityM3) {
      const tankSel = pickTank(pumping.storage.tank.capacityM3);
      add(tankSel.id, tankSel.count);
    }
  }

  // ═══ 12. AUXILIARES ═══
  if (includeMonitoring) add('monitoring_basic', 1);
  if (includeBidirectionalMeter) add('meter_bidirectional', 1);

  // ═══ TOTALES ═══
  const materialsSubtotal = items.reduce((s, i) => s + i.subtotal, 0);

  // Mano de obra
  const laborTotal = Math.round(kWp * 1000 * laborPerWp);

  // Servicios
  const services = [];
  if (includePermits) {
    services.push({ name: 'Trámites OSINERGMIN + Defensa Civil + concesión', subtotal: 800 });
  }
  services.push({ name: 'Pruebas + puesta en marcha + capacitación al usuario', subtotal: Math.max(300, kWp * 30) });
  services.push({ name: 'Logística + flete' + (region === 'sierra' || region === 'selva' ? ' (incl. recargo regional)' : ''),
    subtotal: Math.max(150, kWp * 30 * (region === 'sierra' || region === 'selva' ? 1.5 : 1)) });

  const servicesTotal = services.reduce((s, x) => s + x.subtotal, 0);

  // Margen utilidad sobre (materiales + mano obra + servicios)
  const subtotalBeforeProfit = materialsSubtotal + laborTotal + servicesTotal;
  const profit = Math.round(subtotalBeforeProfit * profitMargin);
  const subtotalAfterProfit = subtotalBeforeProfit + profit;

  // Recargo regional materials (sierra/selva más caro por flete acumulado)
  const regionalSurcharge = (region === 'sierra' || region === 'selva')
    ? Math.round(materialsSubtotal * 0.10) : 0;

  // IGV 18 %
  const subtotalWithSurcharge = subtotalAfterProfit + regionalSurcharge;
  const igv = Math.round(subtotalWithSurcharge * 0.18);
  const totalUSD = subtotalWithSurcharge + igv;
  const totalPEN = Math.round(totalUSD * exchangeRate);

  // Precio por Wp implícito (referencia)
  const pricePerWp = Math.round((totalUSD / (kWp * 1000)) * 100) / 100;

  return {
    items,
    services,
    summary: {
      panelsCount: panelCount,
      panelWattage,
      kWp,
      materialsSubtotalUSD: Math.round(materialsSubtotal),
      laborTotalUSD: laborTotal,
      servicesTotalUSD: servicesTotal,
      regionalSurchargeUSD: regionalSurcharge,
      profitMarginPct: Math.round(profitMargin * 100),
      profitUSD: profit,
      subtotalUSD: subtotalWithSurcharge,
      igvUSD: igv,
      totalUSD,
      totalPEN,
      pricePerWp,
      exchangeRate,
    },
    parameters: {
      mountingType, distanceToTableroM, region,
      includePermits, includeMonitoring, includeBidirectionalMeter,
    },
  };
}

/**
 * Agrupa items por categoría para el reporte.
 */
export function groupByCategory(bom) {
  const groups = {};
  for (const item of bom.items) {
    if (!groups[item.category]) groups[item.category] = { items: [], subtotal: 0 };
    groups[item.category].items.push(item);
    groups[item.category].subtotal += item.subtotal;
  }
  return groups;
}

export const CATEGORY_LABELS = {
  paneles: 'Generación solar',
  inversion: 'Conversión',
  estructura: 'Estructura de montaje',
  cableado: 'Cableado y conduit',
  protecciones: 'Protecciones eléctricas',
  tierra: 'Sistema de puesta a tierra',
  almacenamiento: 'Almacenamiento eléctrico',
  almacenamiento_agua: 'Almacenamiento de agua',
  bombeo: 'Sistema de bombeo',
  auxiliares: 'Sistemas auxiliares',
};

/**
 * Formatea un número como USD o PEN.
 */
export function formatCurrency(value, currency = 'USD') {
  if (value == null || isNaN(value)) return '—';
  const symbol = currency === 'PEN' ? 'S/.' : '$';
  return `${symbol} ${Math.round(value).toLocaleString('es-PE')}`;
}
