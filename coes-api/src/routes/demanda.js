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
  requireYear,
  optionalIsoDate,
  todayIso,
} = require('../utils/coesClient');

const router = express.Router();

router.get(
  '/maxima',
  asyncHandler(async (req, res) => {
    const anio = req.query.anio ? requireYear(req.query.anio) : new Date().getFullYear();
    const path = '/Portal/portalinformacion/demanda';
    const params = { indicador: 'maxima', anio };

    const { data: html, fromCache } = await getPortal(path, {
      params,
      ttl: CACHE_TTL.GEN_DEMANDA * 2, // 10 min
      cacheKeyParts: ['maxima', anio],
    });

    const tables = parseHtmlTables(html);
    const sourceUrl = `${BASE_URL}${path}?indicador=maxima`;
    const payload =
      tables.length > 0
        ? { tables, table_count: tables.length }
        : jsRenderedFallback({ html, sourceUrl });

    res.json(
      envelope({
        data: payload,
        source: sourceUrl,
        params: { anio },
        fromCache,
      })
    );
  })
);

async function fetchDemandaBarras({ fecha_inicio, fecha_fin, tipo }) {
  const fi = optionalIsoDate(fecha_inicio, 'fecha_inicio') || optionalIsoDate(todayIso(), 'fecha_inicio');
  const ff = optionalIsoDate(fecha_fin, 'fecha_fin') || fi;
  const path = '/Portal/DemandaBarras/consulta/index';
  const params = { tipo, fechainicial: fi, fechafinal: ff };

  const { data: html, fromCache } = await getPortal(path, {
    params,
    ttl: CACHE_TTL.GEN_DEMANDA,
    cacheKeyParts: ['barras', tipo, fi, ff],
  });

  const tables = parseHtmlTables(html);
  const sourceUrl = `${BASE_URL}${path}?tipo=${tipo}`;
  const data =
    tables.length > 0 ? { tables, table_count: tables.length } : jsRenderedFallback({ html, sourceUrl });

  return {
    fromCache,
    sourceUrl,
    params: { fecha_inicio: fi, fecha_fin: ff, tipo },
    data,
  };
}

router.get(
  '/distribuidores',
  asyncHandler(async (req, res) => {
    const { fecha_inicio, fecha_fin } = req.query;
    const r = await fetchDemandaBarras({ fecha_inicio, fecha_fin, tipo: 2 });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: r.params, fromCache: r.fromCache }));
  })
);

router.get(
  '/usuarios-libres',
  asyncHandler(async (req, res) => {
    const { fecha_inicio, fecha_fin } = req.query;
    const r = await fetchDemandaBarras({ fecha_inicio, fecha_fin, tipo: 4 });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: r.params, fromCache: r.fromCache }));
  })
);

module.exports = router;
