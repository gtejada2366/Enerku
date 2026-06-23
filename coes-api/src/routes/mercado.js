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
  requireYear,
  requireMonth,
  todayIso,
} = require('../utils/coesClient');

const router = express.Router();

router.get(
  '/costos-marginales',
  asyncHandler(async (req, res) => {
    const fecha = optionalIsoDate(req.query.fecha, 'fecha') || optionalIsoDate(todayIso(), 'fecha');
    const path = '/Portal/MercadoMayorista/CostosMarginales/Index';
    const { data: html, fromCache } = await getPortal(path, {
      params: { fecha },
      ttl: CACHE_TTL.REALTIME,
      cacheKeyParts: ['cmg', fecha],
    });
    const tables = parseHtmlTables(html);
    const sourceUrl = `${BASE_URL}${path}`;
    const data = tables.length > 0
      ? { tables, table_count: tables.length }
      : jsRenderedFallback({ html, sourceUrl });
    res.json(envelope({ data, source: sourceUrl, params: { fecha }, fromCache }));
  })
);

router.get(
  '/costos-marginales/revisados',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.query.anio);
    const mes = req.query.mes ? requireMonth(req.query.mes) : null;
    const path = '/Portal/mercadomayorista/costosmarginales/revisados';
    const params = { anio };
    if (mes !== null) params.mes = mes;

    const { data: html, fromCache } = await getPortal(path, {
      params,
      ttl: CACHE_TTL.PUBLICACIONES,
      cacheKeyParts: ['cmg-rev', anio, mes],
    });
    const tables = parseHtmlTables(html);
    const sourceUrl = `${BASE_URL}${path}`;
    const data = tables.length > 0
      ? { tables, table_count: tables.length }
      : jsRenderedFallback({ html, sourceUrl });
    res.json(envelope({ data, source: sourceUrl, params: { anio, mes }, fromCache }));
  })
);

router.get(
  '/participantes',
  asyncHandler(async (req, res) => {
    const path = '/Portal/mercadomayorista/visualizaciondatos/listadoparticipantes';
    const { data: html, fromCache } = await getPortal(path, {
      ttl: CACHE_TTL.ESTATICOS / 24, // 1 h
      cacheKeyParts: ['participantes'],
    });
    const tables = parseHtmlTables(html);
    const sourceUrl = `${BASE_URL}${path}`;
    const data = tables.length > 0
      ? { tables, table_count: tables.length }
      : jsRenderedFallback({ html, sourceUrl });
    res.json(envelope({ data, source: sourceUrl, params: {}, fromCache }));
  })
);

router.get(
  '/liquidaciones',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.query.anio);
    const mes = req.query.mes ? requireMonth(req.query.mes) : null;
    const path = '/Portal/mercadomayorista/liquidaciones';
    const params = { anio };
    if (mes !== null) params.mes = mes;

    const { data: html, fromCache } = await getPortal(path, {
      params,
      ttl: CACHE_TTL.PUBLICACIONES,
      cacheKeyParts: ['liquidaciones', anio, mes],
    });
    const tables = parseHtmlTables(html);
    const sourceUrl = `${BASE_URL}${path}`;
    const data = tables.length > 0
      ? { tables, table_count: tables.length }
      : jsRenderedFallback({ html, sourceUrl });
    res.json(envelope({ data, source: sourceUrl, params: { anio, mes }, fromCache }));
  })
);

module.exports = router;
