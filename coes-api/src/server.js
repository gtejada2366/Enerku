'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const generacion = require('./routes/generacion');
const demanda = require('./routes/demanda');
const operacion = require('./routes/operacion');
const mercado = require('./routes/mercado');
const publicaciones = require('./routes/publicaciones');
const estadisticas = require('./routes/estadisticas');
const enerku = require('./routes/enerku');
const { errorEnvelope, BASE_URL, cache } = require('./utils/coesClient');

const app = express();

// CORS configurable por env (lista separada por comas, * abre todo)
const origins = (process.env.CORS_ORIGINS || '*').trim();
app.use(
  cors({
    origin: origins === '*' ? true : origins.split(',').map(s => s.trim()),
    credentials: false,
  })
);
app.use(express.json({ limit: '1mb' }));

// log minimalista
app.use((req, _res, next) => {
  const t = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[${t}] ${req.method} ${req.originalUrl}`);
  next();
});

// ---------------------------------------------------------------------------
// Health / index
// ---------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    name: 'coes-api',
    version: '0.1.0',
    upstream: BASE_URL,
    description: 'Wrapper REST no oficial del portal COES (coes.org.pe)',
    endpoints: {
      generacion: [
        'GET /api/generacion?fecha_inicio&fecha_fin&tipo',
        'GET /api/generacion/fuentes?fecha_inicio&fecha_fin',
      ],
      demanda: [
        'GET /api/demanda/maxima?anio',
        'GET /api/demanda/distribuidores?fecha_inicio&fecha_fin',
        'GET /api/demanda/usuarios-libres?fecha_inicio&fecha_fin',
      ],
      operacion: [
        'GET /api/operacion/programa-diario?fecha',
        'GET /api/operacion/programa-semanal?fecha',
        'GET /api/operacion/mantenimiento?tipo=(diario|semanal|mensual|anual)&fecha',
        'GET /api/operacion/caracteristicas-sein',
      ],
      mercado: [
        'GET /api/mercado/costos-marginales?fecha',
        'GET /api/mercado/costos-marginales/revisados?anio&mes',
        'GET /api/mercado/participantes',
        'GET /api/mercado/liquidaciones?anio&mes',
      ],
      publicaciones: [
        'GET /api/publicaciones/estadisticas/:anio',
        'GET /api/publicaciones/memorias/:anio',
        'GET /api/publicaciones/boletines?anio&mes',
        'GET /api/publicaciones/informes?anio',
      ],
      estadisticas: [
        'GET /api/estadisticas/sein?anio&hoja&max_filas',
        'GET /api/estadisticas/generacion-anual?anio&hoja&max_filas',
        'GET /api/estadisticas/capitulo/:num(1-5)?anio&hoja&max_filas',
      ],
      enerku: [
        'GET /api/enerku/health',
        'GET /api/enerku/generacion-mensual?anio&tipo&central',
        'GET /api/enerku/generacion-mensual/por-tipo?anio',
        'GET /api/enerku/cmg?desde&hasta&barra',
        'GET /api/enerku/demanda-maxima?anio&area',
        'GET /api/enerku/raw-files?anio&categoria',
      ],
      utilidades: ['GET /health', 'GET /cache/stats', 'POST /cache/flush'],
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime_s: process.uptime() });
});

app.get('/cache/stats', (_req, res) => {
  res.json({ stats: cache.getStats(), keys: cache.keys().length });
});

app.post('/cache/flush', (_req, res) => {
  cache.flushAll();
  res.json({ flushed: true, timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/generacion', generacion);
app.use('/api/demanda', demanda);
app.use('/api/operacion', operacion);
app.use('/api/mercado', mercado);
app.use('/api/publicaciones', publicaciones);
app.use('/api/estadisticas', estadisticas);
app.use('/api/enerku', enerku);

// 404
app.use((req, res) => {
  res.status(404).json(
    errorEnvelope({
      message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
      source: req.originalUrl,
      status: 404,
    })
  );
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${req.method} ${req.originalUrl} → ${status}: ${err.message}`);
  res.status(status).json(
    errorEnvelope({
      message: err.message || 'Error interno',
      source: req.originalUrl,
      status,
      details: err.details,
    })
  );
});

const PORT = parseInt(process.env.PORT || '3000', 10);

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`coes-api escuchando en http://localhost:${PORT}`);
    console.log(`upstream: ${BASE_URL}`);
  });
}

module.exports = app;
