'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const {
  CACHE_TTL,
  CAPITULO_FILES,
  downloadBinary,
  parseXlsxBuffer,
  statisticsDownloadUrl,
  envelope,
  requireYear,
} = require('../utils/coesClient');

const router = express.Router();

function parseMaxFilas(value, def = 500) {
  if (value === undefined || value === null || value === '') return def;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, 10000); // cap dura
}

async function fetchCapitulo({ num, anio, hoja, maxFilas }) {
  const archivo = CAPITULO_FILES[num];
  if (!archivo) {
    const err = new Error(`Capítulo inválido: ${num}. Valores soportados: 1-5`);
    err.status = 400;
    throw err;
  }
  const url = statisticsDownloadUrl({ anio, archivo });
  const { buffer, contentType, bytes, fromCache } = await downloadBinary(url, {
    ttl: CACHE_TTL.ESTATICOS,
    cacheKeyParts: ['cap', num, anio],
  });

  let parsed;
  try {
    parsed = parseXlsxBuffer(buffer, { hoja, maxFilas });
  } catch (e) {
    const err = new Error(`No se pudo parsear el Excel (¿existe el año ${anio}?): ${e.message}`);
    err.status = 502;
    err.details = { url, bytes, content_type: contentType };
    throw err;
  }

  return {
    fromCache,
    sourceUrl: url,
    data: {
      capitulo: num,
      anio,
      archivo,
      bytes,
      content_type: contentType,
      ...parsed,
    },
  };
}

router.get(
  '/sein',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.query.anio);
    const { hoja } = req.query;
    const maxFilas = parseMaxFilas(req.query.max_filas);
    const r = await fetchCapitulo({ num: 1, anio, hoja, maxFilas });
    res.json(
      envelope({
        data: r.data,
        source: r.sourceUrl,
        params: { anio, hoja: hoja || null, max_filas: maxFilas },
        fromCache: r.fromCache,
      })
    );
  })
);

router.get(
  '/generacion-anual',
  asyncHandler(async (req, res) => {
    const anio = requireYear(req.query.anio);
    const { hoja } = req.query;
    const maxFilas = parseMaxFilas(req.query.max_filas);
    const r = await fetchCapitulo({ num: 2, anio, hoja, maxFilas });
    res.json(
      envelope({
        data: r.data,
        source: r.sourceUrl,
        params: { anio, hoja: hoja || null, max_filas: maxFilas },
        fromCache: r.fromCache,
      })
    );
  })
);

router.get(
  '/capitulo/:num(\\d+)',
  asyncHandler(async (req, res) => {
    const num = parseInt(req.params.num, 10);
    if (!Number.isInteger(num) || num < 1 || num > 5) {
      const err = new Error('num debe estar entre 1 y 5');
      err.status = 400;
      throw err;
    }
    const anio = requireYear(req.query.anio);
    const { hoja } = req.query;
    const maxFilas = parseMaxFilas(req.query.max_filas);
    const r = await fetchCapitulo({ num, anio, hoja, maxFilas });
    res.json(
      envelope({
        data: r.data,
        source: r.sourceUrl,
        params: { num, anio, hoja: hoja || null, max_filas: maxFilas },
        fromCache: r.fromCache,
      })
    );
  })
);

module.exports = router;
