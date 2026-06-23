#!/usr/bin/env node
'use strict';

// Ingesta de Capítulos Anuales del SEIN → Supabase.
//
// Uso:
//   node scripts/ingest-anual.js                   # año actual, capítulos 1-5
//   node scripts/ingest-anual.js --anio=2024       # año específico
//   node scripts/ingest-anual.js --anio=2024 --cap=2,3
//   node scripts/ingest-anual.js --desde=2022 --hasta=2025
//
// Variables de entorno requeridas:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

require('dotenv').config();

const XLSX = require('xlsx');
const {
  CAPITULO_FILES,
  downloadBinary,
  statisticsDownloadUrl,
} = require('../src/utils/coesClient');
const supa = require('./lib/supabase');
const { sha256 } = require('./lib/normalize');
const { extractorsForCapitulo } = require('./lib/extractors');

function parseArgs(argv) {
  const out = { caps: [1, 2, 3, 4, 5] };
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.+)$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'anio') out.anio = parseInt(v, 10);
    else if (k === 'desde') out.desde = parseInt(v, 10);
    else if (k === 'hasta') out.hasta = parseInt(v, 10);
    else if (k === 'cap') out.caps = v.split(',').map(n => parseInt(n, 10)).filter(Boolean);
  }
  if (!out.anio && !out.desde) {
    out.anio = new Date().getFullYear();
  }
  return out;
}

function yearsToRun(args) {
  if (args.desde) {
    const hasta = args.hasta || new Date().getFullYear();
    const ys = [];
    for (let y = args.desde; y <= hasta; y++) ys.push(y);
    return ys;
  }
  return [args.anio];
}

async function parseWorkbookToSheets(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });
    sheets[name] = rows;
  }
  return { sheetNames: wb.SheetNames, sheets };
}

async function ingestCapitulo({ anio, capitulo, runId }) {
  const archivo = CAPITULO_FILES[capitulo];
  if (!archivo) {
    console.warn(`[skip] capítulo ${capitulo} no soportado`);
    return { ok: false, rowsInserted: 0 };
  }

  const url = statisticsDownloadUrl({ anio, archivo });
  console.log(`[fetch] cap${capitulo} ${anio} → ${url}`);

  let buf;
  try {
    const dl = await downloadBinary(url);
    buf = dl.buffer;
    console.log(`[fetch] ${dl.bytes} bytes`);
  } catch (e) {
    console.warn(`[skip] descarga falló para cap${capitulo} ${anio}: ${e.message}`);
    return { ok: false, rowsInserted: 0, error: e.message };
  }

  const hash = sha256(buf);

  // Check si ya tenemos este archivo
  const existing = await supa.select('raw_files', {
    match: { source_url: url, sha256: hash },
    columns: 'id',
    limit: 1,
  });
  if (existing && existing.length > 0) {
    console.log(`[skip] ya existe en raw_files (id=${existing[0].id}, hash idéntico)`);
    return { ok: true, rowsInserted: 0, skipped: true, fileId: existing[0].id };
  }

  // Parsear
  let parsed;
  try {
    parsed = await parseWorkbookToSheets(buf);
  } catch (e) {
    console.error(`[error] parseo cap${capitulo} ${anio}: ${e.message}`);
    return { ok: false, rowsInserted: 0, error: e.message };
  }

  // Insertar raw_files
  const inserted = await supa.insertRows(
    'raw_files',
    [{
      source_url: url,
      category: 'anual_capitulo',
      anio,
      capitulo,
      archivo,
      bytes: buf.length,
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sha256: hash,
      sheet_names: parsed.sheetNames,
      parsed_data: parsed.sheets,
      ingest_run_id: runId,
    }],
    { returning: 'representation' }
  );
  const fileId = inserted.data[0]?.id;
  console.log(`[raw] guardado raw_files id=${fileId}, ${parsed.sheetNames.length} hojas`);

  // Correr extractores
  const extractors = extractorsForCapitulo(capitulo);
  let totalExtracted = 0;
  for (const [sheetName, rows] of Object.entries(parsed.sheets)) {
    for (const fn of extractors) {
      let result;
      try {
        result = fn({ sheetName, rows, anio, sourceFileId: fileId, capitulo });
      } catch (e) {
        console.warn(`[warn] extractor ${fn.name} falló en hoja "${sheetName}": ${e.message}`);
        continue;
      }
      if (!result || !result.rows || result.rows.length === 0) continue;

      try {
        const r = await supa.insertRows(result.table, result.rows, {
          onConflict: result.onConflict,
          returning: 'minimal',
        });
        console.log(`[extract] ${fn.name} hoja "${sheetName}" → ${r.count} filas en ${result.table}`);
        totalExtracted += r.count;
      } catch (e) {
        console.warn(`[warn] insert ${result.table} falló: ${e.message}`);
      }
    }
  }

  return { ok: true, rowsInserted: totalExtracted, fileId };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!supa.isConfigured()) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados');
    process.exit(1);
  }

  const years = yearsToRun(args);
  console.log(`[start] años=${years.join(',')} capítulos=${args.caps.join(',')}`);

  const run = await supa.startRun({
    jobName: 'anual_capitulos',
    params: { years, caps: args.caps },
  });

  let filesProcessed = 0;
  let totalRows = 0;
  let firstError = null;

  for (const anio of years) {
    for (const cap of args.caps) {
      try {
        const r = await ingestCapitulo({ anio, capitulo: cap, runId: run.id });
        if (r.ok) {
          filesProcessed += 1;
          totalRows += r.rowsInserted;
        } else if (!firstError) {
          firstError = r.error;
        }
      } catch (e) {
        console.error(`[error] cap${cap} ${anio}: ${e.message}`);
        if (!firstError) firstError = e.message;
      }
    }
  }

  const status = firstError ? (filesProcessed > 0 ? 'partial' : 'error') : 'ok';
  await supa.finishRun(run.id, {
    status,
    filesProcessed,
    rowsInserted: totalRows,
    errorMessage: firstError,
    notes: `years=${years.join(',')} caps=${args.caps.join(',')}`,
  });

  console.log(`[done] status=${status} files=${filesProcessed} rows=${totalRows}`);
  process.exit(status === 'error' ? 1 : 0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
