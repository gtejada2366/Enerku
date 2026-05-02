/**
 * pdf-report.js
 * Generación de reporte profesional multi-página en PDF para entrega a clientes.
 *
 * Usa jsPDF (con autoTable plugin) cargado vía CDN en index.html.
 * Captura el chart mensual de Chart.js como imagen PNG y lo embebe.
 *
 * Estructura del documento (típicamente 6–10 páginas):
 *   1. Portada con cliente, proyecto, analista, fecha
 *   2. Resumen ejecutivo (todas las métricas clave en una tabla)
 *   3. Análisis regional (región detectada, descripción, contexto)
 *   4. Ranking de puntos (tabla top 10)
 *   5. Generación mensual (chart embebido)
 *   6. Análisis económico (CAPEX, LCOE, payback, NPV, IRR + cash flow)
 *   7. Bombeo agrícola (si activo)
 *   8. Eólico (si activo)
 *   9. Limitaciones + disclaimers
 *  10. Metadata + firma del analista
 */

import { regionLabel, regionDescription } from './region.js';
import { absoluteCategory } from './score.js';
import { paybackCategory } from './economics.js';
import { totalEnergy } from './energy.js';

const COLORS = {
  primary: [39, 80, 10],       // var(--green)
  primaryLight: [59, 109, 17],
  text: [26, 26, 26],
  text2: [102, 102, 102],
  text3: [153, 153, 153],
  border: [220, 220, 220],
  green: [234, 243, 222],
  amber: [250, 238, 218],
  red: [252, 235, 235],
  blue: [230, 241, 251],
};

/**
 * Genera el reporte PDF completo. Devuelve el doc para que el caller decida
 * si guardar (.save()), descargar como blob, etc.
 *
 * @param {object} ctx - contexto completo del análisis
 * @returns {Promise<jsPDF>}
 */
export async function generateReport(ctx) {
  if (!window.jspdf) throw new Error('jsPDF no cargado (revisar CDN en index.html)');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const M = 18;
  const W = 210;
  const H = 297;
  const state = { y: M, page: 1 };

  function setPos(y) { state.y = y; }

  function addPage() {
    doc.addPage();
    state.page++;
    state.y = M;
    drawPageHeader(doc, ctx, state.page);
  }

  function need(space) {
    if (state.y + space > H - M - 10) addPage();
  }

  function h1(text) {
    need(15);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.primary);
    doc.text(text, M, state.y);
    doc.setDrawColor(...COLORS.primary);
    doc.line(M, state.y + 1.5, W - M, state.y + 1.5);
    state.y += 9;
  }

  function h2(text) {
    need(10);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.text);
    doc.text(text, M, state.y);
    state.y += 6;
  }

  function p(text, opts = {}) {
    need(6);
    doc.setFontSize(opts.size || 9);
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setTextColor(...(opts.color || COLORS.text));
    const lines = doc.splitTextToSize(text, W - 2 * M);
    need(lines.length * 4.2);
    doc.text(lines, M, state.y);
    state.y += lines.length * 4.2 + 1.5;
  }

  function space(n = 4) { state.y += n; }

  function tableKV(rows) {
    doc.autoTable({
      startY: state.y,
      head: [],
      body: rows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 1.5, lineColor: COLORS.border, lineWidth: 0.1 },
      columnStyles: {
        0: { cellWidth: 65, fontStyle: 'bold', textColor: COLORS.text2 },
        1: { cellWidth: 'auto', textColor: COLORS.text },
      },
      margin: { left: M, right: M },
    });
    state.y = doc.lastAutoTable.finalY + 5;
  }

  function tableData(head, body, colStyles) {
    doc.autoTable({
      startY: state.y,
      head: [head],
      body,
      theme: 'striped',
      headStyles: { fillColor: COLORS.primary, textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 1.5 },
      columnStyles: colStyles || {},
      margin: { left: M, right: M },
    });
    state.y = doc.lastAutoTable.finalY + 5;
  }

  // ════════════════ PÁGINA 1: PORTADA ════════════════
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, W, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Estudio de Pre-Factibilidad', M, 17);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'normal');
  doc.text('Energía Solar y Renovable', M, 26);
  doc.setFontSize(8);
  doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, M, 33);

  setPos(55);
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Información del proyecto', M, state.y);
  state.y += 8;

  tableKV([
    ['Cliente / proyecto', ctx.client || '—'],
    ['Analista', ctx.analyst || '—'],
    ['Empresa', ctx.company || '—'],
    ['Ubicación', `lat ${ctx.lat}, lng ${ctx.lng}`],
    ['Región detectada', regionLabel(ctx.regionInfo.region) +
      ` (confianza ${ctx.regionInfo.confidence}${ctx.regionInfo.transition ? ', transición' : ''})`],
    ['Período de análisis', ctx.seasonLabel],
    ['Sistema configurado', `${ctx.kWp} kWp`],
    ['Reporte ID', ctx.reportId],
  ]);

  // Resumen ejecutivo (la portada lo incluye)
  space(3);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.text);
  doc.text('Resumen ejecutivo', M, state.y);
  state.y += 8;

  const top = ctx.results[0];
  const summary = [
    ['Yield del mejor punto', `${top.irr} ±${top.irrBand} kWh/kWp · confianza ${top.confidence}`],
    ['Score relativo (vs área)', `${top.score}/100`],
    ['Score absoluto (vs Perú)', `${top.absScore}/100 · ${absoluteCategory(top.absScore)}`],
    ['Mes crítico (off-grid)', top.worst ? `${top.worst.name} · ${top.worst.dailyYield} kWh/kWp/día` : '—'],
    ['Producción anual sistema', `${(top.irr * ctx.kWp * (12 / ctx.seasonMonths)).toLocaleString('es-PE', {maximumFractionDigits: 0})} kWh/año`],
  ];
  if (ctx.economics) {
    summary.push(
      ['CAPEX', `$${ctx.economics.capex.toLocaleString('es-PE')} USD`],
      ['LCOE', `$${ctx.economics.lcoe} USD/kWh`],
      ['Payback simple', ctx.economics.simplePaybackYears ? `${ctx.economics.simplePaybackYears} años · ${paybackCategory(ctx.economics.simplePaybackYears)}` : 'no rentable'],
      ['NPV @ ' + ctx.economics.lifetimeYears + ' años', `${ctx.economics.npv >= 0 ? '+' : ''}$${ctx.economics.npv.toLocaleString('es-PE')} USD`],
      ['IRR', ctx.economics.irr != null ? `${ctx.economics.irr}%` : '—'],
    );
  }
  if (ctx.pumping) {
    summary.push(
      ['Bombeo: caudal', `${ctx.pumping.flowM3hr} m³/h · TDH ${ctx.pumping.tdh} m`],
      ['Bombeo: kWp PV requerido', `${ctx.pumping.requiredKwp} kWp`],
      ['Bombeo: bomba sugerida', ctx.pumping.pumpRec.primary?.name || '—'],
    );
  }
  if (ctx.windResult) {
    summary.push(
      ['Eólico: capacity factor', `${(ctx.windResult.cf * 100).toFixed(1)}%`],
      ['Eólico: energía anual', `${ctx.windResult.annualKwh.toLocaleString('es-PE')} kWh`],
    );
  }
  if (ctx.battery) {
    const sel = ctx.battery.selected;
    summary.push(
      ['Batería: capacidad', `${sel.grossCapacityKwh} kWh ${sel.chemistryName.split('(')[0].trim()}`],
      ['Batería: CAPEX', `$${sel.capexUSD.toLocaleString('es-PE')} USD · LCOS $${sel.lcos}/kWh`],
      ['Batería: vida útil', `${sel.lifetime.expectedYears} años (${sel.replacements} reemplazos)`],
    );
  }
  if (ctx.diesel) {
    const opt = ctx.diesel.optimal;
    summary.push(
      ['Diésel: PV óptimo', `${opt.kwp} kWp · cubre ${opt.solarFraction}% demanda`],
      ['Diésel: ahorro anual', `${opt.annualLitersSaved.toLocaleString('es-PE')} L · $${opt.annualCostSaved.toLocaleString('es-PE')} USD/año`],
      ['Diésel: payback / NPV', `${opt.simplePaybackYears}a · NPV $${opt.npvSavings.toLocaleString('es-PE')}`],
      ['Diésel: CO₂ evitado', `${(opt.annualCO2SavedKg / 1000).toFixed(2)} ton/año`],
    );
  }
  tableKV(summary);

  // ════════════════ PÁGINA 2+: ANÁLISIS REGIONAL ════════════════
  addPage();
  h1('1. Análisis regional');
  p(regionDescription(ctx.regionInfo));
  space(2);
  tableKV([
    ['Coordenadas centro', `${ctx.lat}, ${ctx.lng}`],
    ['Elevación centro', ctx.centerElev != null && !isNaN(ctx.centerElev) ? `${Math.round(ctx.centerElev)} m s.n.m.` : 'no disponible'],
    ['Región detectada', regionLabel(ctx.regionInfo.region)],
    ['Confianza', ctx.regionInfo.confidence],
    ['Divide andino aprox.', `${ctx.regionInfo.divide.toFixed(2)}° W`],
    ['Clearness index (KT)', ctx.centerKT != null ? ctx.centerKT.toFixed(2) + ' (NASA POWER)' : 'no disponible'],
    ['Temperatura base', ctx.baseTemp != null ? `${Math.round(ctx.baseTemp)} °C (forecast diario máx. 7d)` : 'no disponible'],
    ['Factor de calibración aplicado', `×${(top.soilingFactor || 1).toFixed(2)} (${ctx.regionInfo.region})`],
  ]);

  // ════════════════ ANÁLISIS SOLAR ════════════════
  h1('2. Análisis solar — ranking de puntos');
  p('Cada punto en la grilla fue evaluado con 7 factores ponderados según la región. El ranking siguiente muestra los 10 mejores ordenados por score relativo.', { color: COLORS.text2 });
  space(2);

  const rankRows = ctx.results.slice(0, 10).map((r, i) => [
    String(i + 1) + (i === 0 ? ' ★' : ''),
    `${r.lat}, ${r.lng}`,
    `${r.score}`,
    `${r.absScore ?? '—'}`,
    `${r.irr} ±${r.irrBand}`,
    `${r.shadowScore}`,
    `${r.slope}°`,
    r.tempEst != null ? `${r.tempEst.toFixed(1)}°` : '—',
    r.dist !== null ? `${r.dist} km` : '—',
    r.irrSource,
  ]);
  tableData(
    ['#', 'Coordenadas', 'Rel.', 'Abs.', 'Yield ± kWh/kWp', 'Sombra', 'Pend.', 'Temp', 'Dist.', 'Fuente'],
    rankRows,
    {
      0: { cellWidth: 8 },
      1: { cellWidth: 32, font: 'courier', fontSize: 7 },
      2: { cellWidth: 12 },
      3: { cellWidth: 12 },
      4: { cellWidth: 28 },
    }
  );

  // Chart mensual
  if (ctx.chartCanvas) {
    h2('Generación mensual (kWh/kWp)');
    try {
      const dataUrl = ctx.chartCanvas.toDataURL('image/png');
      const imgW = W - 2 * M;
      const imgH = 60;
      need(imgH + 4);
      doc.addImage(dataUrl, 'PNG', M, state.y, imgW, imgH);
      state.y += imgH + 6;
      p(`Verde: punto óptimo (#1) · Rojo: punto más bajo. El mes mínimo del óptimo (${top.worst?.name || '—'}) define el dimensionamiento off-grid.`,
        { color: COLORS.text3, size: 8 });
    } catch (e) {
      p('Chart no capturable: ' + e.message, { color: COLORS.text3, size: 8 });
    }
  }

  // ════════════════ ECONOMÍA ════════════════
  if (ctx.economics) {
    addPage();
    h1('3. Análisis económico');
    p(`Modo: ${ctx.economicsMode}. Vida útil ${ctx.economics.lifetimeYears} años, tasa de descuento ${ctx.economicsParams.discountRate}%, O&M ${ctx.economicsParams.omRate}% del CAPEX.`);
    space(2);
    tableKV([
      ['CAPEX inicial', `$${ctx.economics.capex.toLocaleString('es-PE')} USD (${ctx.kWp} kWp × $${ctx.economicsParams.capexPerKwp}/kWp)`],
      ['Energía año 1', `${ctx.economics.firstYearEnergy.toLocaleString('es-PE')} kWh`],
      ['Ingreso año 1', `$${ctx.economics.firstYearRevenue.toLocaleString('es-PE')} USD (a $${ctx.economicsParams.energyPrice}/kWh)`],
      ['O&M anual', `$${ctx.economics.annualOM.toLocaleString('es-PE')} USD`],
      ['Energía total ' + ctx.economics.lifetimeYears + ' años', `${ctx.economics.totalEnergyMWh.toLocaleString('es-PE')} MWh`],
      ['Ingreso total acumulado', `$${ctx.economics.totalRevenue.toLocaleString('es-PE')} USD`],
      ['LCOE', `$${ctx.economics.lcoe} / kWh`],
      ['Payback simple', ctx.economics.simplePaybackYears ? `${ctx.economics.simplePaybackYears} años (${paybackCategory(ctx.economics.simplePaybackYears)})` : 'no rentable'],
      ['Payback descontado', ctx.economics.discountedPaybackYears ? `${ctx.economics.discountedPaybackYears} años` : 'no recuperable'],
      ['NPV', `${ctx.economics.npv >= 0 ? '+' : ''}$${ctx.economics.npv.toLocaleString('es-PE')} USD`],
      ['IRR', ctx.economics.irr != null ? `${ctx.economics.irr}%` : 'no calculable'],
    ]);
  }

  // ════════════════ BOMBEO ════════════════
  if (ctx.pumping) {
    addPage();
    h1('4. Sistema de bombeo agrícola');
    space(2);
    h2('Hidráulica');
    tableKV([
      ['Caudal requerido', `${ctx.pumping.flowM3hr} m³/h (${ctx.pumpInputs.dailyVolumeM3} m³/día en ${ctx.pumpInputs.hours} h)`],
      ['Altura estática', `${ctx.pumpInputs.staticHead} m`],
      ['Pérdida por fricción', `${ctx.pumping.frictionLossM} m (tubería Ø ${ctx.pumping.diameterMm} mm × ${ctx.pumpInputs.length} m)`],
      ['Presión deseada en entrega', `${ctx.pumpInputs.pressure} m`],
      ['TDH (total dynamic head)', `${ctx.pumping.tdh} m`],
    ]);
    h2('Sistema motriz');
    tableKV([
      ['Potencia hidráulica', `${(ctx.pumping.hydraulicKW * 1000).toFixed(0)} W`],
      ['Eficiencia bomba aplicada', `${(ctx.pumping.pumpEfficiency * 100).toFixed(0)}%`],
      ['Potencia eléctrica', `${(ctx.pumping.electricKW * 1000).toFixed(0)} W (${ctx.pumping.electricKW.toFixed(2)} kW)`],
      ['Energía diaria', `${ctx.pumping.dailyKwh} kWh/día`],
      ['kWp PV requerido', ctx.pumping.requiredKwp ? `${ctx.pumping.requiredKwp} kWp (mes crítico ${top.worst?.name})` : '—'],
    ]);
    if (ctx.pumping.pumpRec.primary) {
      h2('Bomba recomendada');
      const pump = ctx.pumping.pumpRec.primary;
      tableKV([
        ['Tipo', pump.name],
        ['Uso típico', pump.typicalUse],
        ['Rango Q operativo', `${pump.qMin}–${pump.qMax} m³/h`],
        ['Rango H operativo', `${pump.hMin}–${pump.hMax} m`],
        ['Costo estimado bomba', `$${ctx.pumping.pumpCostUSD} USD`],
        ['Alternativas', ctx.pumping.pumpRec.alternatives.map(a => a.name).join(', ') || '—'],
      ]);
    }
    h2('Almacenamiento');
    tableKV([
      ['Tanque (recomendado)', `${ctx.pumping.storage.tank.capacityM3} m³ · ~$${ctx.pumping.storage.tank.estimatedCostUSD} USD`],
      ['Batería (alternativa)', `${ctx.pumping.storage.battery.capacityKwh} kWh · ~$${ctx.pumping.storage.battery.estimatedCostUSD} USD (LFP, DOD 80%)`],
      ['Recomendación', ctx.pumping.storage.reasoning],
    ]);
  }

  // ════════════════ BATERÍA ════════════════
  if (ctx.battery) {
    addPage();
    h1('5. Almacenamiento — baterías');
    if (ctx.batteryAutoReason) {
      p('Recomendación automática: ' + ctx.batteryAutoReason, { color: COLORS.text2, size: 9 });
      space(2);
    }
    const sel = ctx.battery.selected;
    h2('Configuración seleccionada');
    tableKV([
      ['Química', sel.chemistryName],
      ['Demanda diaria', `${ctx.battery.inputs.dailyKwh} kWh/día`],
      ['Días de autonomía', `${sel.daysAutonomy} días`],
      ['Capacidad bruta requerida', `${sel.grossCapacityKwh} kWh`],
      ['Capacidad útil', `${sel.usableCapacityKwh} kWh (DOD ${(sel.dodMax * 100).toFixed(0)}%)`],
      ['Eficiencia round-trip', `${(sel.roundTripEfficiency * 100).toFixed(0)}%`],
      ['Factor temperatura', `×${sel.temperatureFactor.toFixed(2)} (T avg ${ctx.battery.avgTempC.toFixed(0)}°C)`],
      ['CAPEX bateria', `$${sel.capexUSD.toLocaleString('es-PE')} USD`],
      ['Vida útil esperada', `${sel.lifetime.expectedYears} años (limitado por ${sel.lifetime.limitedBy === 'cycles' ? 'ciclos' : 'calendario'})`],
      ['LCOS', `$${sel.lcos} USD/kWh ciclado`],
      ['Reemplazos en vida proyecto', `${sel.replacements} (próximo año ${sel.lifetime.expectedYears})`],
      ['Costo total nominal a 20 años', `~$${sel.totalCostNominalUSD.toLocaleString('es-PE')} USD`],
    ]);

    h2('Comparativa de químicas');
    p('LCOS = costo nivelado por kWh ciclado. Menor = mejor.', { color: COLORS.text3, size: 8 });
    space(1);
    const compRows = ctx.battery.options.map(o => [
      o.chemistryName.split('(')[0].trim(),
      `${o.grossCapacityKwh} / ${o.usableCapacityKwh} kWh`,
      `$${o.capexUSD.toLocaleString('es-PE')}`,
      `${o.lifetime.expectedYears}a`,
      `$${o.lcos}`,
      o.chemistry === sel.chemistry ? '★ elegida' : '—',
    ]);
    tableData(
      ['Química', 'Bruto / útil', 'CAPEX', 'Vida', 'LCOS $/kWh', ''],
      compRows,
      { 0: { cellWidth: 50 } }
    );
  }

  // ════════════════ DIESEL HÍBRIDO ════════════════
  if (ctx.diesel) {
    addPage();
    h1('5b. Híbrido PV + Diésel');
    p('Análisis de reemplazo / hibridación de un genset diésel existente con sistema solar fotovoltaico. El kWp óptimo minimiza el costo total a 20 años (CAPEX PV + diésel residual descontado).', { color: COLORS.text2 });
    space(2);

    const opt = ctx.diesel.optimal;
    const base = ctx.diesel.baseline;

    h2('Configuración del genset existente');
    tableKV([
      ['Capacidad nominal', `${ctx.dieselInputs.gensetCapacityKVA} kVA`],
      ['Eficiencia', `${ctx.dieselInputs.efficiency} kWh/L`],
      ['Demanda diaria', `${ctx.dieselInputs.dailyDemandKwh} kWh/día`],
      ['Costo diésel', `$${ctx.dieselInputs.fuelCost}/L`],
      ['Inflación diésel asumida', `${ctx.dieselInputs.escalation}%/año`],
      ['Batería incluida', ctx.dieselInputs.withBattery ? 'sí' : 'no'],
    ]);

    h2('Baseline — solo diésel (sin PV)');
    tableKV([
      ['Consumo diésel anual', `${base.annualLitersDiesel.toLocaleString('es-PE')} L`],
      ['Costo diésel anual', `$${base.annualCostDiesel.toLocaleString('es-PE')} USD`],
      ['Costo total NPV 20 años', `$${base.npvCost20yr.toLocaleString('es-PE')} USD`],
      ['Emisiones CO₂', `~${Math.round(base.annualLitersDiesel * 2.68 / 1000)} ton/año`],
    ]);

    h2('Sistema híbrido recomendado');
    tableKV([
      ['PV óptimo (minimiza costo total)', `${opt.kwp} kWp`],
      ['CAPEX PV', `$${opt.capex.toLocaleString('es-PE')} USD`],
      ['Cobertura solar', `${opt.solarFraction}% de la demanda diaria`],
      ['Energía solar usada/año', `${opt.annualSolarKwh.toLocaleString('es-PE')} kWh`],
      ['Diésel residual', `${opt.annualDieselLiters.toLocaleString('es-PE')} L/año ($${opt.annualDieselCost.toLocaleString('es-PE')})`],
      ['Litros ahorrados/año', `${opt.annualLitersSaved.toLocaleString('es-PE')} L`],
      ['Costo ahorrado/año', `$${opt.annualCostSaved.toLocaleString('es-PE')} USD`],
      ['Reducción de costo diésel', `${opt.savingsRatio}%`],
      ['Payback (sólo PV vs diésel)', opt.simplePaybackYears != null ? `${opt.simplePaybackYears} años` : 'no rentable'],
      ['NPV ahorros 20 años', `${opt.npvSavings >= 0 ? '+' : ''}$${opt.npvSavings.toLocaleString('es-PE')} USD`],
      ['CO₂ evitado/año', `${(opt.annualCO2SavedKg / 1000).toFixed(2)} toneladas`],
      ['CO₂ evitado total 20 años', `~${(opt.annualCO2SavedKg * 20 / 1000).toFixed(1)} toneladas`],
    ]);

    p('Nota: el "kWp óptimo" no es el máximo ni el mínimo, sino el que minimiza el costo total descontado a 20 años. Más kWp reduce diésel pero aumenta CAPEX; menos kWp baja CAPEX pero mantiene el gasto de diésel.', { color: COLORS.text3, size: 8 });
  }

  // ════════════════ EÓLICO ════════════════
  if (ctx.windResult) {
    addPage();
    h1('5. Potencial eólico');
    space(2);
    tableKV([
      ['Turbina referencia', `${ctx.windResult.turbine.name} (${ctx.windResult.turbine.power} kW nominal)`],
      ['Altura del hub', `${ctx.windResult.hubHeight} m`],
      ['Velocidad media al hub', `${ctx.windResult.meanHubWind?.toFixed(1)} m/s`],
      ['Capacity factor', `${(ctx.windResult.cf * 100).toFixed(1)}%`],
      ['Energía anual', `${ctx.windResult.annualKwh.toLocaleString('es-PE')} kWh`],
      ['Horas útiles/año (sobre cut-in)', `${ctx.windResult.hoursAboveCutIn} h`],
      ['Híbrido solar + eólico', `${(top.irr * ctx.kWp * (12 / ctx.seasonMonths) + ctx.windResult.annualKwh).toLocaleString('es-PE', {maximumFractionDigits: 0})} kWh/año`],
    ]);
  }

  // ════════════════ LIMITACIONES + DISCLAIMERS ════════════════
  addPage();
  h1('6. Limitaciones y disclaimers');
  p('Este estudio es de PRE-FACTIBILIDAD. NO reemplaza ingeniería de detalle ni autoriza obra.', { bold: true });
  space(2);

  p('Validación del modelo:');
  p('• MAPE in-sample: 5.7 % (sobre 30 sitios de referencia en costa, sierra y selva)', { size: 8, color: COLORS.text2 });
  p('• MAPE LOO out-of-sample: 6.5 % (ratio 1.13× → calibración generaliza)', { size: 8, color: COLORS.text2 });
  p('• Detección de región: 100 % de aciertos en Perú continental', { size: 8, color: COLORS.text2 });
  space(2);

  p('Fuentes de datos:');
  p('• Yield solar: PVGIS v5.2 NSRDB (~1 km, dataset NREL)', { size: 8, color: COLORS.text2 });
  p('• Fallback histórico: ERA5-Land (Copernicus / ECMWF, ~9 km)', { size: 8, color: COLORS.text2 });
  p('• Clearness index: NASA POWER (ALLSKY_KT, ~50 km)', { size: 8, color: COLORS.text2 });
  p('• Elevación: SRTM 30 m + ASTER GDEM fallback', { size: 8, color: COLORS.text2 });
  p('• Calibración: factor regional combinando soiling físico + bias dataset', { size: 8, color: COLORS.text2 });
  space(2);

  p('Limitaciones:');
  p('• Error per-site: ±10–15 % (heterogeneidad dentro de cada región)', { size: 8, color: COLORS.text2 });
  p('• PVGIS resolución 1 km: puntos a <1 km dan mismo yield', { size: 8, color: COLORS.text2 });
  p('• ERA5 sub-estima vientos en topografía compleja ~10–20 %', { size: 8, color: COLORS.text2 });
  p('• No modelamos: tracking 1-eje en cálculo principal, bifacialidad, paneles específicos', { size: 8, color: COLORS.text2 });
  p('• Para diseño final de proyectos >$50k recomendamos PVSyst con datos calibrados', { size: 8, color: COLORS.text2 });
  p('• Para garantías bancables se requiere Solargis Pro o equivalente certificado', { size: 8, color: COLORS.text2 });
  space(3);

  p('Margen de seguridad recomendado en dimensionamiento: 15–20 % sobre los valores de este reporte para absorber degradación de paneles, soiling no anticipado y variabilidad climática interanual.', { color: COLORS.text2 });

  // ════════════════ FIRMA ════════════════
  space(8);
  state.y = Math.max(state.y, H - M - 50);
  doc.setDrawColor(...COLORS.text2);
  doc.line(M, state.y, M + 70, state.y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.text);
  doc.text(ctx.analyst || '—', M, state.y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.text2);
  doc.text(ctx.company || '', M, state.y + 10);
  doc.text(`EnerKu v0.7 · MAPE validado 5.7 % · Reporte ID: ${ctx.reportId}`, M, H - M - 5);

  // Pie de página en cada página
  for (let i = 1; i <= state.page; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.text3);
    doc.text(`Pre-feasibility · ${ctx.client || 'Sin cliente'} · ${new Date().toLocaleDateString('es-PE')}`, M, H - 7);
    doc.text(`${i} / ${state.page}`, W - M - 12, H - 7);
  }

  return doc;
}

function drawPageHeader(doc, ctx, page) {
  // Mini-header en páginas internas (no portada)
  const M = 18;
  doc.setFontSize(7);
  doc.setTextColor(102, 102, 102);
  doc.text(`Pre-Factibilidad · ${ctx.client || ''}`, M, 10);
  doc.text(`${ctx.lat}, ${ctx.lng}`, 210 - M - 25, 10);
  doc.setDrawColor(220, 220, 220);
  doc.line(M, 12, 210 - M, 12);
}
