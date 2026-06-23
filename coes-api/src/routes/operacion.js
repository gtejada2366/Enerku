'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const {
  BASE_URL,
  CACHE_TTL,
  getPortal,
  parseHtmlTables,
  jsRenderedFallback,
  envelope,
  optionalIsoDate,
  todayIso,
} = require('../utils/coesClient');

const router = express.Router();

async function fetchOperacion({ path, params, ttl, cacheKeyParts }) {
  const { data: html, fromCache } = await getPortal(path, { params, ttl, cacheKeyParts });
  const tables = parseHtmlTables(html);
  const sourceUrl = `${BASE_URL}${path}`;
  const data = tables.length > 0
    ? { tables, table_count: tables.length }
    : jsRenderedFallback({ html, sourceUrl });
  return { fromCache, sourceUrl, data };
}

router.get(
  '/programa-diario',
  asyncHandler(async (req, res) => {
    const fecha = optionalIsoDate(req.query.fecha, 'fecha') || optionalIsoDate(todayIso(), 'fecha');
    const path = '/Portal/Operacion/ProgOperacion/ProgramaDiario';
    const r = await fetchOperacion({
      path,
      params: { fecha },
      ttl: CACHE_TTL.PROGRAMAS,
      cacheKeyParts: ['diario', fecha],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { fecha }, fromCache: r.fromCache }));
  })
);

router.get(
  '/programa-semanal',
  asyncHandler(async (req, res) => {
    const fecha = optionalIsoDate(req.query.fecha, 'fecha') || optionalIsoDate(todayIso(), 'fecha');
    const path = '/Portal/Operacion/ProgOperacion/ProgSemanalOp';
    const r = await fetchOperacion({
      path,
      params: { fecha },
      ttl: CACHE_TTL.PROGRAMAS_LARGOS,
      cacheKeyParts: ['semanal', fecha],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { fecha }, fromCache: r.fromCache }));
  })
);

router.get(
  '/mantenimiento',
  asyncHandler(async (req, res) => {
    const tiposValidos = { diario: 'ProgDiario', semanal: 'ProgSemanal', mensual: 'ProgMensual', anual: 'ProgAnual' };
    const tipo = String(req.query.tipo || '').toLowerCase();
    if (!tiposValidos[tipo]) {
      const err = new Error(`tipo inválido. Valores: ${Object.keys(tiposValidos).join(', ')}`);
      err.status = 400;
      throw err;
    }
    const fecha = optionalIsoDate(req.query.fecha, 'fecha') || optionalIsoDate(todayIso(), 'fecha');
    const path = `/Portal/Operacion/ProgManten/${tiposValidos[tipo]}`;

    // Cache: anual=24h, mensual=24h, semanal=30min, diario=10min
    const ttl =
      tipo === 'anual' || tipo === 'mensual'
        ? CACHE_TTL.ESTATICOS
        : tipo === 'semanal'
        ? CACHE_TTL.PROGRAMAS_LARGOS
        : CACHE_TTL.PROGRAMAS;

    const r = await fetchOperacion({
      path,
      params: { fecha },
      ttl,
      cacheKeyParts: ['manten', tipo, fecha],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { tipo, fecha }, fromCache: r.fromCache }));
  })
);

router.get(
  '/caracteristicas-sein',
  asyncHandler(async (req, res) => {
    const path = '/Portal/Operacion/CaractSEIN/BaseDatos';
    const r = await fetchOperacion({
      path,
      params: {},
      ttl: CACHE_TTL.ESTATICOS,
      cacheKeyParts: ['caract-sein'],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: {}, fromCache: r.fromCache }));
  })
);

module.exports = router;
