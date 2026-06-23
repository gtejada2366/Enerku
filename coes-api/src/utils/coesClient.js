'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const XLSX = require('xlsx');

const BASE_URL = process.env.COES_BASE_URL || 'https://www.coes.org.pe';
const HTTP_TIMEOUT_MS = parseInt(process.env.HTTP_TIMEOUT_MS || '30000', 10);
const MAX_DOWNLOAD_BYTES = parseInt(process.env.MAX_DOWNLOAD_BYTES || `${50 * 1024 * 1024}`, 10);

// ---------------------------------------------------------------------------
// Headers obligatorios para emular navegador (el portal bloquea UAs vacíos)
// ---------------------------------------------------------------------------
const DEFAULT_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'es-PE,es;q=0.9',
  Referer: `${BASE_URL}/Portal/`,
});

// ---------------------------------------------------------------------------
// Cache en memoria. TTL por endpoint se pasa al .set()
// ---------------------------------------------------------------------------
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

const CACHE_TTL = Object.freeze({
  REALTIME: 120,        // 2 min — costos marginales en tiempo real
  GEN_DEMANDA: 300,     // 5 min — generación / demanda
  PROGRAMAS: 600,       // 10 min — programa diario
  PROGRAMAS_LARGOS: 1800, // 30 min — semanal / mensual
  PUBLICACIONES: 3600,  // 1 h
  ESTATICOS: 86400,     // 24 h — características SEIN, listado participantes
});

function cacheKey(parts) {
  return parts
    .map(p => (p === undefined || p === null ? '_' : String(p)))
    .join('::');
}

// ---------------------------------------------------------------------------
// axios instance compartida
// ---------------------------------------------------------------------------
const http = axios.create({
  baseURL: BASE_URL,
  timeout: HTTP_TIMEOUT_MS,
  headers: DEFAULT_HEADERS,
  maxRedirects: 5,
  validateStatus: status => status >= 200 && status < 500, // dejamos pasar 4xx para inspeccionar
});

// ---------------------------------------------------------------------------
// Fechas: el portal acepta DD/MM/YYYY. Aceptamos YYYY-MM-DD como input estándar.
// ---------------------------------------------------------------------------
function toCoesDate(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(yyyyMmDd).trim());
  if (!m) {
    // si ya viene como DD/MM/YYYY, devolverlo tal cual
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(yyyyMmDd)) return yyyyMmDd;
    throw new Error(`Formato de fecha inválido: ${yyyyMmDd}. Esperado YYYY-MM-DD`);
  }
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function todayCoes() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${d}/${mo}/${y}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Envelope estándar de respuesta
// ---------------------------------------------------------------------------
function envelope({ data, source, params = {}, fromCache = false, extras = {} }) {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    from_cache: fromCache,
    source,
    params,
    data,
    ...extras,
  };
}

function errorEnvelope({ message, source, params = {}, status = 500, details }) {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    from_cache: false,
    source,
    params,
    error: { message, status, ...(details ? { details } : {}) },
  };
}

// ---------------------------------------------------------------------------
// GET HTML/JSON con cache opcional
// ---------------------------------------------------------------------------
async function getPortal(path, { params, headers, responseType = 'text', ttl, cacheKeyParts } = {}) {
  const key = cacheKeyParts ? cacheKey(['get', path, ...cacheKeyParts]) : null;
  if (key) {
    const hit = cache.get(key);
    if (hit) return { ...hit, fromCache: true };
  }

  const res = await http.get(path, {
    params,
    headers: { ...DEFAULT_HEADERS, ...(headers || {}) },
    responseType,
  });

  if (res.status >= 400) {
    const err = new Error(`COES respondió ${res.status} en ${path}`);
    err.status = res.status;
    err.body = typeof res.data === 'string' ? res.data.slice(0, 500) : undefined;
    throw err;
  }

  const payload = { status: res.status, data: res.data, headers: res.headers, fromCache: false };
  if (key && ttl) cache.set(key, { status: res.status, data: res.data, headers: res.headers }, ttl);
  return payload;
}

async function postPortal(path, body, { headers, params, ttl, cacheKeyParts, responseType = 'json' } = {}) {
  const key = cacheKeyParts ? cacheKey(['post', path, ...cacheKeyParts]) : null;
  if (key) {
    const hit = cache.get(key);
    if (hit) return { ...hit, fromCache: true };
  }
  const res = await http.post(path, body, {
    params,
    headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', ...(headers || {}) },
    responseType,
  });
  if (res.status >= 400) {
    const err = new Error(`COES respondió ${res.status} en ${path}`);
    err.status = res.status;
    err.body = typeof res.data === 'string' ? res.data.slice(0, 500) : undefined;
    throw err;
  }
  const payload = { status: res.status, data: res.data, headers: res.headers, fromCache: false };
  if (key && ttl) cache.set(key, { status: res.status, data: res.data, headers: res.headers }, ttl);
  return payload;
}

// ---------------------------------------------------------------------------
// Parseo de tablas HTML genéricas (<table> con thead/tbody)
// ---------------------------------------------------------------------------
function parseHtmlTables(html) {
  const $ = cheerio.load(html);
  const tables = [];
  $('table').each((_, el) => {
    const $tbl = $(el);
    const headers = [];
    $tbl.find('thead tr').first().find('th, td').each((_, th) => headers.push($(th).text().trim()));
    if (headers.length === 0) {
      $tbl.find('tr').first().find('th, td').each((_, th) => headers.push($(th).text().trim()));
    }

    const rows = [];
    const $bodyRows = $tbl.find('tbody tr').length ? $tbl.find('tbody tr') : $tbl.find('tr').slice(1);
    $bodyRows.each((_, tr) => {
      const cells = [];
      $(tr).find('td, th').each((_, td) => cells.push($(td).text().trim()));
      if (cells.length === 0) return;
      if (headers.length && headers.length === cells.length) {
        const obj = {};
        headers.forEach((h, i) => { obj[h || `col_${i}`] = cells[i]; });
        rows.push(obj);
      } else {
        rows.push(cells);
      }
    });

    if (rows.length > 0) {
      tables.push({
        caption: $tbl.find('caption').text().trim() || null,
        headers,
        rows,
        row_count: rows.length,
      });
    }
  });
  return tables;
}

// ---------------------------------------------------------------------------
// Extracción de links de descarga (xlsx, pdf, zip, csv) cuando el portal usa JS
// para renderizar y no podemos leer las tablas. Es nuestra ruta de fallback.
// ---------------------------------------------------------------------------
function extractDownloadLinks(html, baseUrl = BASE_URL) {
  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set();
  const exts = /\.(xlsx?|csv|pdf|zip|rar|docx?|pptx?)(\?|#|$)/i;

  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    if (!exts.test(href) && !/download/i.test(href) && !/browser\/download/i.test(href)) return;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    links.push({
      url,
      text: $(a).text().trim() || null,
      title: $(a).attr('title') || null,
      type: (exts.exec(href) || [, null])[1]?.toLowerCase() || 'other',
    });
  });

  // También scripts/data-url embebidos que apuntan a /Portal/browser/download
  const scriptText = $('script').map((_, s) => $(s).html() || '').get().join('\n');
  const dlRegex = /\/Portal\/browser\/download\?url=[^"'\s)]+/g;
  let m;
  while ((m = dlRegex.exec(scriptText)) !== null) {
    const url = new URL(m[0], baseUrl).toString();
    if (!seen.has(url)) {
      seen.add(url);
      links.push({ url, text: null, title: null, type: 'browser-download', source: 'script' });
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Cuando no encontramos tablas con datos, devolvemos esta estructura para que
// el cliente sepa que necesita un headless browser o usar los links directos.
// ---------------------------------------------------------------------------
function jsRenderedFallback({ html, sourceUrl, note }) {
  const links = extractDownloadLinks(html, BASE_URL);
  const $ = cheerio.load(html);
  const title = $('title').text().trim() || null;
  return {
    rendered_by_js: true,
    title,
    note:
      note ||
      'El portal COES renderiza esta vista vía JavaScript (frameworks tipo Angular/DevExtreme). El HTML inicial no contiene los datos tabulares. Se requiere un headless browser (Playwright/Puppeteer) para extraer datos en vivo, o usar los links de descarga listados.',
    source_url: sourceUrl,
    download_links: links,
    download_links_count: links.length,
  };
}

// ---------------------------------------------------------------------------
// Descarga binaria con límite de tamaño
// ---------------------------------------------------------------------------
async function downloadBinary(url, { ttl, cacheKeyParts } = {}) {
  const key = cacheKeyParts ? cacheKey(['bin', url, ...cacheKeyParts]) : null;
  if (key) {
    const hit = cache.get(key);
    if (hit) return { ...hit, fromCache: true };
  }

  const res = await http.get(url, {
    responseType: 'arraybuffer',
    maxContentLength: MAX_DOWNLOAD_BYTES,
    maxBodyLength: MAX_DOWNLOAD_BYTES,
    headers: { ...DEFAULT_HEADERS, Accept: 'application/octet-stream, */*' },
  });

  if (res.status >= 400) {
    const err = new Error(`Descarga falló ${res.status}: ${url}`);
    err.status = res.status;
    throw err;
  }

  const buf = Buffer.from(res.data);
  const payload = { buffer: buf, contentType: res.headers['content-type'] || null, bytes: buf.length, fromCache: false };
  if (key && ttl) cache.set(key, { buffer: buf, contentType: payload.contentType, bytes: buf.length }, ttl);
  return payload;
}

// ---------------------------------------------------------------------------
// Parseo de Excel (xlsx) → JSON. max_filas previene respuestas gigantes.
// ---------------------------------------------------------------------------
function parseXlsxBuffer(buffer, { hoja, maxFilas = 500 } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetNames = wb.SheetNames;
  const targetSheet = hoja && sheetNames.includes(hoja) ? hoja : sheetNames[0];
  const ws = wb.Sheets[targetSheet];
  if (!ws) {
    return { sheet_names: sheetNames, sheet: null, rows: [], row_count: 0 };
  }

  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });

  const limited = typeof maxFilas === 'number' && maxFilas > 0 ? rows.slice(0, maxFilas) : rows;
  return {
    sheet_names: sheetNames,
    sheet: targetSheet,
    total_rows: rows.length,
    returned_rows: limited.length,
    truncated: limited.length < rows.length,
    rows: limited,
  };
}

// ---------------------------------------------------------------------------
// URL helper para descargas del repositorio de estadísticas anuales
// ---------------------------------------------------------------------------
function statisticsDownloadUrl({ anio, archivo }) {
  // archivo viene ya url-encoded del catálogo (con %C3%ADs etc.)
  return `${BASE_URL}/Portal/browser/download?url=Publicaciones/Estadisticas+Anuales/${anio}/Excel/${archivo}`;
}

const CAPITULO_FILES = Object.freeze({
  1: 'Capitulo+01_Estad%C3%ADstica+Relevante+del+SEIN.xlsx',
  2: 'Capitulo+02_Generaci%C3%B3n+de+Energ%C3%ADa.xlsx',
  3: 'Capitulo+03_M%C3%A1xima+Demanda.xlsx',
  4: 'Capitulo+04_Costos+Marginales.xlsx',
  5: 'Capitulo+05_Transferencias+de+Energ%C3%ADa.xlsx',
});

// ---------------------------------------------------------------------------
// Validadores de parámetros simples
// ---------------------------------------------------------------------------
function requireYear(value, fieldName = 'anio') {
  if (value === undefined || value === null || value === '') {
    const err = new Error(`Parámetro requerido: ${fieldName}`);
    err.status = 400;
    throw err;
  }
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1990 || n > 2100) {
    const err = new Error(`${fieldName} fuera de rango: ${value}`);
    err.status = 400;
    throw err;
  }
  return n;
}

function requireMonth(value, fieldName = 'mes') {
  if (value === undefined || value === null || value === '') {
    const err = new Error(`Parámetro requerido: ${fieldName}`);
    err.status = 400;
    throw err;
  }
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    const err = new Error(`${fieldName} fuera de rango (1-12): ${value}`);
    err.status = 400;
    throw err;
  }
  return n;
}

function optionalIsoDate(value, fieldName = 'fecha') {
  if (value === undefined || value === null || value === '') return null;
  try {
    return toCoesDate(value);
  } catch (e) {
    const err = new Error(`${fieldName}: ${e.message}`);
    err.status = 400;
    throw err;
  }
}

module.exports = {
  BASE_URL,
  CACHE_TTL,
  CAPITULO_FILES,
  DEFAULT_HEADERS,
  cache,
  http,
  // helpers
  toCoesDate,
  todayCoes,
  todayIso,
  envelope,
  errorEnvelope,
  cacheKey,
  // request helpers
  getPortal,
  postPortal,
  downloadBinary,
  // parsers
  parseHtmlTables,
  parseXlsxBuffer,
  extractDownloadLinks,
  jsRenderedFallback,
  // urls
  statisticsDownloadUrl,
  // validators
  requireYear,
  requireMonth,
  optionalIsoDate,
};
