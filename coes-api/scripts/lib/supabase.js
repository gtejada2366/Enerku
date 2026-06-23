'use strict';

// Cliente liviano para Supabase usando la API PostgREST directamente con axios.
// No agregamos @supabase/supabase-js para mantener el bundle chico.
//
// Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
// El schema 'enerku' debe estar expuesto en Settings → API → Exposed schemas.

const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCHEMA = process.env.ENERKU_SCHEMA || 'enerku';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // No tiramos en require — los scripts deciden si esto es fatal o no.
  console.warn('[supabase] SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no definidos');
}

const client = axios.create({
  baseURL: SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : undefined,
  timeout: 60000,
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': SCHEMA,
    'Content-Profile': SCHEMA,
  },
  validateStatus: s => s >= 200 && s < 500,
});

function ensureConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase no configurado: setea SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  }
}

async function insertRows(table, rows, { onConflict, returning = 'minimal' } = {}) {
  ensureConfigured();
  if (!Array.isArray(rows) || rows.length === 0) return { count: 0, data: [] };

  const headers = { Prefer: `return=${returning}` };
  if (returning === 'minimal') headers.Prefer = 'return=minimal';
  else if (returning === 'representation') headers.Prefer = 'return=representation';

  // upsert si onConflict definido
  const params = {};
  if (onConflict) {
    params.on_conflict = onConflict;
    headers.Prefer = `resolution=merge-duplicates,${headers.Prefer}`;
  }

  const res = await client.post(`/${table}`, rows, { headers, params });
  if (res.status >= 400) {
    const err = new Error(`Supabase insert ${table} → ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = res.status;
    throw err;
  }
  return { count: rows.length, data: res.data || [] };
}

async function selectOne(table, { match = {}, columns = '*' } = {}) {
  ensureConfigured();
  const params = { select: columns, limit: 1 };
  for (const [k, v] of Object.entries(match)) params[k] = `eq.${v}`;
  const res = await client.get(`/${table}`, { params });
  if (res.status >= 400) {
    const err = new Error(`Supabase select ${table} → ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = res.status;
    throw err;
  }
  return Array.isArray(res.data) ? res.data[0] || null : null;
}

async function select(table, { match = {}, gte = {}, lte = {}, columns = '*', order, limit } = {}) {
  ensureConfigured();
  const params = { select: columns };
  for (const [k, v] of Object.entries(match)) params[k] = `eq.${v}`;
  for (const [k, v] of Object.entries(gte)) params[k] = `gte.${v}`;
  for (const [k, v] of Object.entries(lte)) params[k] = `lte.${v}`;
  if (order) params.order = order;
  if (limit) params.limit = limit;

  const res = await client.get(`/${table}`, { params });
  if (res.status >= 400) {
    const err = new Error(`Supabase select ${table} → ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = res.status;
    throw err;
  }
  return res.data || [];
}

async function rpc(fnName, args = {}) {
  ensureConfigured();
  const res = await client.post(`/rpc/${fnName}`, args);
  if (res.status >= 400) {
    const err = new Error(`Supabase rpc ${fnName} → ${res.status}: ${JSON.stringify(res.data)}`);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

// Helpers para tracking de corridas del ingest
async function startRun({ jobName, params = {} }) {
  const res = await insertRows(
    'ingest_runs',
    [{ job_name: jobName, params, status: 'running' }],
    { returning: 'representation' }
  );
  return res.data[0];
}

async function finishRun(id, { status, filesProcessed = 0, rowsInserted = 0, errorMessage = null, notes = null }) {
  ensureConfigured();
  const res = await client.patch(`/ingest_runs?id=eq.${id}`, {
    finished_at: new Date().toISOString(),
    status,
    files_processed: filesProcessed,
    rows_inserted: rowsInserted,
    error_message: errorMessage,
    notes,
  });
  if (res.status >= 400) {
    throw new Error(`Supabase finishRun → ${res.status}: ${JSON.stringify(res.data)}`);
  }
}

module.exports = {
  client,
  SCHEMA,
  insertRows,
  selectOne,
  select,
  rpc,
  startRun,
  finishRun,
  isConfigured: () => Boolean(SUPABASE_URL && SUPABASE_KEY),
};
