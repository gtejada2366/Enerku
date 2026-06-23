'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const {
  BASE_URL,
  CACHE_TTL,
  getPortal,
  extractDownloadLinks,
  parseHtmlTables,
  jsRenderedFallback,
  envelope,
  requireYear,
  requireMonth,
} = require('../utils/coesClient');

const router = express.Router();

async function fetchPublicacion({ path, params, cacheKeyParts }) {
  const { data: html, fromCache } = await getPortal(path, {
    params,
    ttl: CACHE_TTL.PUBLICACIONES,
    cacheKeyParts,
  });
  const links = extractDownloadLinks(html);
  const tables = parseHtmlTables(html);
  const sourceUrl = `${BASE_URL}${path}`;
  // En publicaciones lo útil son los enlaces de descarga; las tablas son secundarias
  const data = {
    download_links: links,
    download_links_count: links.length,
    tables: tables.length > 0 ? tables : null,
    ...(links.length === 0 && tables.length === 0 ? jsRenderedFallback({ html, sourceUrl }) : {}),
  };
  return { fromCache, sourceUrl, data };
}

router.get(
  '/estadisticas/:anio',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.params.anio);
    const path = '/Portal/publicaciones/estadisticas/estadistica';
    const r = await fetchPublicacion({
      path,
      params: { anio },
      cacheKeyParts: ['est', anio],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { anio }, fromCache: r.fromCache }));
  })
);

router.get(
  '/memorias/:anio',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.params.anio);
    const path = '/Portal/Publicaciones/Memorias/';
    const r = await fetchPublicacion({
      path,
      params: { anio },
      cacheKeyParts: ['memorias', anio],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { anio }, fromCache: r.fromCache }));
  })
);

router.get(
  '/boletines',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.query.anio);
    const mes = req.query.mes ? requireMonth(req.query.mes) : null;
    const path = '/Portal/Publicaciones/Boletines/';
    const params = { anio };
    if (mes !== null) params.mes = mes;
    const r = await fetchPublicacion({
      path,
      params,
      cacheKeyParts: ['boletines', anio, mes],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { anio, mes }, fromCache: r.fromCache }));
  })
);

router.get(
  '/informes',
  asyncHandler(async (req, res) => {
    const anio = req.query.anio ? requireYear(req.query.anio) : null;
    const path = '/Portal/Publicaciones/Informes/';
    const params = anio !== null ? { anio } : {};
    const r = await fetchPublicacion({
      path,
      params,
      cacheKeyParts: ['informes', anio],
    });
    res.json(envelope({ data: r.data, source: r.sourceUrl, params: { anio }, fromCache: r.fromCache }));
  })
);

module.exports = router;
