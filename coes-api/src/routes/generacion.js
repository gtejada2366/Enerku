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
const SOURCE_PATH = '/Portal/portalinformacion/generacion';

async function fetchGeneracion({ fecha_inicio, fecha_fin, tipo }) {
  const fi = optionalIsoDate(fecha_inicio, 'fecha_inicio') || optionalIsoDate(todayIso(), 'fecha_inicio');
  const ff = optionalIsoDate(fecha_fin, 'fecha_fin') || fi;

  const params = { fechainicial: fi, fechafinal: ff };
  if (tipo) params.tipogeneracion = tipo;

  const { data: html, fromCache } = await getPortal(SOURCE_PATH, {
    params,
    ttl: CACHE_TTL.GEN_DEMANDA,
    cacheKeyParts: [fi, ff, tipo || 'todos'],
  });

  const tables = parseHtmlTables(html);
  const sourceUrl = `${BASE_URL}${SOURCE_PATH}`;

  if (tables.length === 0) {
    return {
      fromCache,
      sourceUrl,
      params: { fecha_inicio: fi, fecha_fin: ff, tipo: tipo || null },
      data: jsRenderedFallback({ html, sourceUrl }),
    };
  }

  return {
    fromCache,
    sourceUrl,
    params: { fecha_inicio: fi, fecha_fin: ff, tipo: tipo || null },
    data: { tables, table_count: tables.length },
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { fecha_inicio, fecha_fin, tipo } = req.query;
    const { fromCache, sourceUrl, params, data } = await fetchGeneracion({ fecha_inicio, fecha_fin, tipo });
    res.json(envelope({ data, source: sourceUrl, params, fromCache }));
  })
);

router.get(
  '/fuentes',
  asyncHandler(async (req, res) => {
    const { fecha_inicio, fecha_fin } = req.query;
    const { fromCache, sourceUrl, params, data } = await fetchGeneracion({
      fecha_inicio,
      fecha_fin,
      tipo: undefined,
    });

    // Si tenemos tablas, intentamos agrupar por fuente. Si no, devolvemos el fallback tal cual.
    if (data?.tables) {
      const fuentes = {};
      for (const t of data.tables) {
        for (const row of t.rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
          // heurística: una columna que contiene "tipo" o "fuente" o "tecnologia"
          const fuenteKey = Object.keys(row).find(k => /tipo|fuente|tecnolog/i.test(k));
          const valorKey = Object.keys(row).find(k => /mw|energ|generac|valor/i.test(k));
          if (!fuenteKey) continue;
          const f = String(row[fuenteKey] || '').trim();
          if (!f) continue;
          if (!fuentes[f]) fuentes[f] = { count: 0, samples: [] };
          fuentes[f].count += 1;
          if (fuentes[f].samples.length < 3) fuentes[f].samples.push({ valor: valorKey ? row[valorKey] : null, row });
        }
      }
      res.json(
        envelope({
          data: { fuentes, fuente_count: Object.keys(fuentes).length, tables_raw: data.tables },
          source: sourceUrl,
          params,
          fromCache,
        })
      );
      return;
    }

    res.json(envelope({ data, source: sourceUrl, params, fromCache }));
  })
);

module.exports = router;
