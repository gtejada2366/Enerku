-- ============================================================================
-- EnerKu — schema de ingesta de datos COES
-- Se ejecuta sobre el mismo proyecto Supabase de WaterKu, en schema separado.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS enerku;

-- Logs de cada corrida del scheduler. Útil para debugging y métricas.
CREATE TABLE IF NOT EXISTS enerku.ingest_runs (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  job_name        TEXT NOT NULL,                -- 'anual_capitulos', 'cmg_diario', etc.
  params          JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'running', -- running | ok | error | partial
  files_processed INTEGER NOT NULL DEFAULT 0,
  rows_inserted   INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS ingest_runs_started_idx ON enerku.ingest_runs (started_at DESC);

-- Archivos descargados del repositorio. Almacenamos metadatos y un hash para
-- idempotencia. El parsed_data tiene TODAS las hojas como matrices JSON — esto
-- nos permite re-extraer sin descargar.
CREATE TABLE IF NOT EXISTS enerku.raw_files (
  id              BIGSERIAL PRIMARY KEY,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url      TEXT NOT NULL,
  category        TEXT NOT NULL,                -- 'anual_capitulo', 'cmg_diario', etc.
  anio            INTEGER,
  capitulo        INTEGER,                      -- 1..5 para los capítulos anuales
  archivo         TEXT NOT NULL,                -- nombre del archivo en el portal
  bytes           INTEGER NOT NULL,
  content_type    TEXT,
  sha256          TEXT NOT NULL,                -- hash del binario
  sheet_names     TEXT[] NOT NULL DEFAULT '{}',
  parsed_data     JSONB,                        -- { sheet_name: [[row], [row], ...] }
  ingest_run_id   BIGINT REFERENCES enerku.ingest_runs(id) ON DELETE SET NULL,
  UNIQUE (source_url, sha256)
);
CREATE INDEX IF NOT EXISTS raw_files_category_idx ON enerku.raw_files (category, anio);
CREATE INDEX IF NOT EXISTS raw_files_fetched_idx ON enerku.raw_files (fetched_at DESC);

-- ============================================================================
-- Tablas estructuradas. Estas se llenan desde extractores específicos por
-- capítulo. Empezamos con las que sí podemos modelar a ciegas; el resto se
-- refina iterando sobre raw_files.
-- ============================================================================

-- Catálogo de centrales del SEIN. Llenado manual al inicio, después actualizado
-- desde Capítulo 02 o Características SEIN.
CREATE TABLE IF NOT EXISTS enerku.centrales (
  id              BIGSERIAL PRIMARY KEY,
  codigo_coes     TEXT UNIQUE,                  -- código que usa COES
  nombre          TEXT NOT NULL,
  tipo            TEXT,                         -- 'hidro' | 'termo' | 'solar' | 'eolico' | 'bess'
  subtipo         TEXT,                         -- 'GN' | 'diesel' | 'pasada' | 'embalse' | etc.
  empresa         TEXT,
  potencia_mw     NUMERIC,
  region          TEXT,
  zona_operativa  TEXT,                         -- 'norte' | 'centro' | 'sur'
  ubicacion_lat   NUMERIC,
  ubicacion_lon   NUMERIC,
  fecha_pio       DATE,                         -- puesta en operación
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS centrales_tipo_idx ON enerku.centrales (tipo);
CREATE INDEX IF NOT EXISTS centrales_zona_idx ON enerku.centrales (zona_operativa);

-- Generación horaria por central. Granularidad: 1 hora.
-- Si solo tenemos dato mensual, se agrega a otra tabla (ver abajo).
CREATE TABLE IF NOT EXISTS enerku.generacion_horaria (
  id              BIGSERIAL PRIMARY KEY,
  fecha           DATE NOT NULL,
  hora            SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
  central_id      BIGINT REFERENCES enerku.centrales(id) ON DELETE SET NULL,
  central_nombre  TEXT NOT NULL,                -- denormalizado para evitar lookups
  energia_mwh     NUMERIC,
  source_file_id  BIGINT REFERENCES enerku.raw_files(id) ON DELETE SET NULL,
  UNIQUE (fecha, hora, central_nombre)
);
CREATE INDEX IF NOT EXISTS gen_horaria_fecha_idx ON enerku.generacion_horaria (fecha);
CREATE INDEX IF NOT EXISTS gen_horaria_central_idx ON enerku.generacion_horaria (central_id);

-- Generación mensual agregada (de los capítulos anuales típicamente).
CREATE TABLE IF NOT EXISTS enerku.generacion_mensual (
  id              BIGSERIAL PRIMARY KEY,
  anio            INTEGER NOT NULL,
  mes             SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  central_id      BIGINT REFERENCES enerku.centrales(id) ON DELETE SET NULL,
  central_nombre  TEXT NOT NULL,
  tipo            TEXT,                         -- replica de centrales.tipo cuando se conoce
  energia_gwh     NUMERIC,
  source_file_id  BIGINT REFERENCES enerku.raw_files(id) ON DELETE SET NULL,
  UNIQUE (anio, mes, central_nombre)
);
CREATE INDEX IF NOT EXISTS gen_mensual_periodo_idx ON enerku.generacion_mensual (anio, mes);
CREATE INDEX IF NOT EXISTS gen_mensual_tipo_idx ON enerku.generacion_mensual (tipo);

-- Costos marginales horarios por barra del sistema.
CREATE TABLE IF NOT EXISTS enerku.cmg_horario (
  id              BIGSERIAL PRIMARY KEY,
  fecha           DATE NOT NULL,
  hora            SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
  barra           TEXT NOT NULL,                -- nombre de la barra (e.g. 'SANTA ROSA 220')
  nivel_tension   TEXT,                         -- '220 kV', '500 kV', etc.
  cmg_usd_mwh     NUMERIC,
  tipo            TEXT NOT NULL DEFAULT 'ejecutado', -- 'ejecutado' | 'revisado' | 'programado'
  source_file_id  BIGINT REFERENCES enerku.raw_files(id) ON DELETE SET NULL,
  UNIQUE (fecha, hora, barra, tipo)
);
CREATE INDEX IF NOT EXISTS cmg_fecha_idx ON enerku.cmg_horario (fecha);
CREATE INDEX IF NOT EXISTS cmg_barra_idx ON enerku.cmg_horario (barra);
CREATE INDEX IF NOT EXISTS cmg_fecha_barra_idx ON enerku.cmg_horario (fecha, barra);

-- Demanda máxima del sistema (mensual / anual).
CREATE TABLE IF NOT EXISTS enerku.demanda_maxima (
  id              BIGSERIAL PRIMARY KEY,
  anio            INTEGER NOT NULL,
  mes             SMALLINT CHECK (mes BETWEEN 1 AND 12),   -- NULL = anual
  area            TEXT NOT NULL,                -- 'SEIN' | 'norte' | 'centro' | 'sur'
  demanda_mw      NUMERIC,
  fecha_ocurrencia DATE,
  hora_ocurrencia SMALLINT,
  source_file_id  BIGINT REFERENCES enerku.raw_files(id) ON DELETE SET NULL,
  UNIQUE (anio, mes, area)
);
CREATE INDEX IF NOT EXISTS demanda_periodo_idx ON enerku.demanda_maxima (anio, mes);

-- ============================================================================
-- Vistas de conveniencia para el endpoint REST y para PyPSA-Peru
-- ============================================================================

CREATE OR REPLACE VIEW enerku.v_cmg_diario_promedio AS
SELECT
  fecha,
  barra,
  tipo,
  AVG(cmg_usd_mwh)::NUMERIC(10,2) AS cmg_promedio_usd_mwh,
  MIN(cmg_usd_mwh) AS cmg_min,
  MAX(cmg_usd_mwh) AS cmg_max,
  COUNT(*) AS horas
FROM enerku.cmg_horario
GROUP BY fecha, barra, tipo;

CREATE OR REPLACE VIEW enerku.v_generacion_mensual_por_tipo AS
SELECT
  anio, mes, tipo,
  SUM(energia_gwh) AS energia_gwh_total,
  COUNT(DISTINCT central_nombre) AS num_centrales
FROM enerku.generacion_mensual
WHERE tipo IS NOT NULL
GROUP BY anio, mes, tipo;

-- ============================================================================
-- Permisos. La service_role key del backend tendrá acceso total. La anon key
-- (frontend público) NO debe leer estas tablas hasta que decidamos qué exponer.
-- ============================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA enerku FROM PUBLIC;
REVOKE ALL ON SCHEMA enerku FROM PUBLIC;
GRANT USAGE ON SCHEMA enerku TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA enerku TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA enerku TO service_role;
