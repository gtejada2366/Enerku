'use strict';

// Endpoints que consultan la base EnerKu (Supabase) en vez de scrapear COES.
// Estos son los endpoints "rápidos y confiables" para alimentar el demo,
// PyPSA-Peru, y eventualmente el Digital Twin.

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { envelope, requireYear } = require('../utils/coesClient');
const supa = require('../../scripts/lib/supabase');

const router = express.Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    if (!supa.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: { message: 'Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      });
    }
    const runs = await supa.select('ingest_runs', { order: 'started_at.desc', limit: 5 });
    res.json(envelope({
      data: { connected: true, recent_runs: runs },
      source: 'supabase://enerku',
      params: {},
    }));
  })
);

router.get(
  '/generacion-mensual',
  asyncHandler(async (req, res) => {
    const anio = req.query.anio ? requireYear(req.query.anio) : null;
    const tipo = req.query.tipo || null;
    const central = req.query.central || null;

    const match = {};
    if (anio) match.anio = anio;
    if (tipo) match.tipo = tipo;
    if (central) match.central_nombre = central;

    const rows = await supa.select('generacion_mensual', {
      match,
      order: 'anio.asc,mes.asc,central_nombre.asc',
      limit: parseInt(req.query.limit || '5000', 10),
    });
    res.json(envelope({
      data: { rows, row_count: rows.length },
      source: 'supabase://enerku.generacion_mensual',
      params: { anio, tipo, central },
    }));
  })
);

router.get(
  '/generacion-mensual/por-tipo',
  asyncHandler(async (req, res) => {
    const anio = req.query.anio ? requireYear(req.query.anio) : null;
    const match = {};
    if (anio) match.anio = anio;
    const rows = await supa.select('v_generacion_mensual_por_tipo', {
      match,
      order: 'anio.asc,mes.asc,tipo.asc',
      limit: 1000,
    });
    res.json(envelope({
      data: { rows, row_count: rows.length },
      source: 'supabase://enerku.v_generacion_mensual_por_tipo',
      params: { anio },
    }));
  })
);

router.get(
  '/cmg',
  asyncHandler(async (req, res) => {
    const desde = req.query.desde || null; // YYYY-MM-DD
    const hasta = req.query.hasta || null;
    const barra = req.query.barra || null;

    const opts = { order: 'fecha.asc,hora.asc', limit: parseInt(req.query.limit || '10000', 10) };
    if (barra) opts.match = { barra };
    if (desde) opts.gte = { fecha: desde };
    if (hasta) opts.lte = { fecha: hasta };

    const rows = await supa.select('cmg_horario', opts);
    res.json(envelope({
      data: { rows, row_count: rows.length },
      source: 'supabase://enerku.cmg_horario',
      params: { desde, hasta, barra },
    }));
  })
);

router.get(
  '/demanda-maxima',
  asyncHandler(async (req, res) => {
    const anio = req.query.anio ? requireYear(req.query.anio) : null;
    const area = req.query.area || null;
    const match = {};
    if (anio) match.anio = anio;
    if (area) match.area = area;
    const rows = await supa.select('demanda_maxima', {
      match,
      order: 'anio.asc,mes.asc',
      limit: 1000,
    });
    res.json(envelope({
      data: { rows, row_count: rows.length },
      source: 'supabase://enerku.demanda_maxima',
      params: { anio, area },
    }));
  })
);

router.get(
  '/raw-files',
  asyncHandler(async (req, res) => {
    const anio = req.query.anio ? requireYear(req.query.anio) : null;
    const categoria = req.query.categoria || null;
    const match = {};
    if (anio) match.anio = anio;
    if (categoria) match.category = categoria;
    const rows = await supa.select('raw_files', {
      match,
      columns: 'id,fetched_at,category,anio,capitulo,archivo,bytes,sheet_names',
      order: 'fetched_at.desc',
      limit: 100,
    });
    res.json(envelope({
      data: { rows, row_count: rows.length },
      source: 'supabase://enerku.raw_files',
      params: { anio, categoria },
    }));
  })
);

module.exports = router;
