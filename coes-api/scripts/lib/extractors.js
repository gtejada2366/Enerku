'use strict';

// Extractores específicos por capítulo del SEIN. Convierten la matriz de filas
// (sheet_to_json header:1) en filas estructuradas listas para insertar.
//
// IMPORTANTE: estos extractores son "best-effort" — los Excel del SEIN tienen
// headers en filas variables y celdas combinadas. La estrategia es:
//   1. raw_files SIEMPRE se llena (toda la matriz queda en JSONB)
//   2. estos extractores intentan poblar las tablas estructuradas
//   3. cuando alguno falla, se loguea pero NO se aborta la corrida
//   4. los extractores se refinan iterando sobre los raw_files ya guardados
//
// Cada extractor recibe: { sheetName, rows: [[]...], anio, sourceFileId, capitulo }
// Cada extractor devuelve: { table: 'generacion_mensual', rows: [...] } | null

const { parseNumber, normName, detectTipoCentral } = require('./normalize');

// Encuentra la fila de encabezados buscando la primera con varias celdas no
// vacías que sean strings (heurística simple).
function findHeaderRow(rows, { minCells = 3, maxScan = 20 } = {}) {
  const scan = Math.min(maxScan, rows.length);
  for (let i = 0; i < scan; i++) {
    const row = rows[i] || [];
    const nonEmpty = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
    const stringy = nonEmpty.filter(c => typeof c === 'string' || isNaN(Number(c)));
    if (nonEmpty.length >= minCells && stringy.length >= Math.ceil(minCells * 0.6)) {
      return { headerRow: i, headers: row.map(c => (c === null || c === undefined ? '' : String(c).trim())) };
    }
  }
  return { headerRow: -1, headers: [] };
}

// Mapea índices de columnas que contengan los 12 meses
function findMonthColumns(headers) {
  const months = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
  };
  const map = {};
  headers.forEach((h, i) => {
    if (!h) return;
    const key = String(h).toLowerCase().trim();
    if (months[key]) map[months[key]] = i;
    else {
      for (const [w, m] of Object.entries(months)) {
        if (key.startsWith(w)) { map[m] = i; break; }
      }
    }
  });
  return map;
}

// =========================================================================
// Capítulo 02 — Generación de Energía: típicamente tiene hojas con la matriz
// "central × mes" en GWh.
// =========================================================================
function extractCap02_generacionMensual({ sheetName, rows, anio, sourceFileId }) {
  if (!rows || rows.length < 5) return null;
  const { headerRow, headers } = findHeaderRow(rows, { minCells: 4 });
  if (headerRow < 0) return null;

  const monthCols = findMonthColumns(headers);
  if (Object.keys(monthCols).length < 6) return null; // necesitamos al menos medio año de columnas

  // Buscar columna de nombre de central (usualmente la primera columna con strings)
  let nameCol = headers.findIndex(h => /central|empresa|nombre/i.test(h || ''));
  if (nameCol < 0) nameCol = 0;

  // Detectar columna 'tipo' opcional
  const tipoCol = headers.findIndex(h => /tipo|tecnolog/i.test(h || ''));

  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const nombre = normName(row[nameCol]);
    if (!nombre) continue;
    // saltar filas de subtotal/total
    if (/total|subtotal|resumen/i.test(nombre)) continue;

    const tipoRaw = tipoCol >= 0 ? row[tipoCol] : null;
    const tipo = detectTipoCentral(nombre, tipoRaw);

    for (const [mes, colIdx] of Object.entries(monthCols)) {
      const val = parseNumber(row[colIdx]);
      if (val === null) continue;
      out.push({
        anio: Number(anio),
        mes: Number(mes),
        central_nombre: nombre,
        tipo,
        energia_gwh: val,
        source_file_id: sourceFileId,
      });
    }
  }

  if (out.length === 0) return null;
  return { table: 'generacion_mensual', rows: out, onConflict: 'anio,mes,central_nombre' };
}

// =========================================================================
// Capítulo 03 — Máxima Demanda: usualmente "mes × año" o "fecha → MW"
// =========================================================================
function extractCap03_demandaMaxima({ sheetName, rows, anio, sourceFileId }) {
  if (!rows || rows.length < 4) return null;
  const { headerRow, headers } = findHeaderRow(rows, { minCells: 2 });
  if (headerRow < 0) return null;

  // Caso A: tabla mensual con columna "mes" y "MW"
  const mesCol = headers.findIndex(h => /^mes$|periodo/i.test(h || ''));
  const mwCol = headers.findIndex(h => /mw\b|máxima|maxima/i.test(h || ''));
  const fechaCol = headers.findIndex(h => /fecha/i.test(h || ''));

  const out = [];
  if (mesCol >= 0 && mwCol >= 0) {
    const monthMap = {
      enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
      julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10,
      noviembre: 11, diciembre: 12,
    };
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const mesRaw = String(row[mesCol] || '').toLowerCase().trim();
      const mes = monthMap[mesRaw] || (Number.isInteger(parseNumber(mesRaw)) ? parseNumber(mesRaw) : null);
      const mw = parseNumber(row[mwCol]);
      if (!mes || mw === null) continue;
      const fecha = fechaCol >= 0 ? row[fechaCol] : null;
      out.push({
        anio: Number(anio),
        mes,
        area: 'SEIN',
        demanda_mw: mw,
        fecha_ocurrencia: fecha instanceof Date ? fecha.toISOString().slice(0, 10) : null,
        source_file_id: sourceFileId,
      });
    }
  }

  if (out.length === 0) return null;
  return { table: 'demanda_maxima', rows: out, onConflict: 'anio,mes,area' };
}

// =========================================================================
// Capítulo 04 — Costos Marginales: estructura es muy variable
// (puede ser barra × mes, barra × hora, etc.). Lo dejamos como TODO: el
// extractor real necesita ver los archivos reales. Por ahora solo guardamos
// el raw y reportamos.
// =========================================================================
function extractCap04_cmg({ sheetName, rows, anio, sourceFileId }) {
  // Placeholder: refinar viendo Excel real. Por ahora retorna null para que
  // el raw_files quede como única fuente de CMg histórico hasta que se afine.
  return null;
}

// =========================================================================
// Dispatcher: dado capítulo + nombre de hoja, decide qué extractor correr
// =========================================================================
function extractorsForCapitulo(num) {
  switch (num) {
    case 1: return [];                                    // Estadística Relevante: heterogénea, raw nomás
    case 2: return [extractCap02_generacionMensual];
    case 3: return [extractCap03_demandaMaxima];
    case 4: return [extractCap04_cmg];
    case 5: return [];                                    // Transferencias: TODO
    default: return [];
  }
}

module.exports = {
  findHeaderRow,
  findMonthColumns,
  extractCap02_generacionMensual,
  extractCap03_demandaMaxima,
  extractCap04_cmg,
  extractorsForCapitulo,
};
