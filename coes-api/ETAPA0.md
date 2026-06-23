# Etapa 0 — Pipeline COES → Supabase → API

Esta etapa convierte el wrapper de scraping en una base de datos histórica del SEIN. Después de correr esto, el demo de Caravelí no depende del portal estando vivo: todo se sirve desde Supabase.

## Qué hace

1. Descarga los Capítulos 1-5 del repositorio de Estadísticas Anuales del SEIN para los años elegidos (default: año en curso).
2. Guarda cada archivo completo en `enerku.raw_files` como JSONB (todas las hojas, todas las filas).
3. Corre extractores que pueblan tablas estructuradas: `generacion_mensual`, `demanda_maxima`, `cmg_horario` (este último todavía pendiente de afinar viendo Excel reales).
4. Expone endpoints REST que consultan Supabase directamente (`/api/enerku/*`) — sin scraping en cada request.

## Setup (una vez)

### 1. Crear schema en Supabase

En el proyecto de WaterKu (mismo proyecto, schema separado), ir a **SQL Editor** y ejecutar:

```bash
cat sql/001_init_schema.sql
```

Después: **Settings → API → Exposed schemas** → agregar `enerku` a la lista. Sin este paso PostgREST no responde.

### 2. Variables de entorno

```bash
cp .env.example .env
# editar .env con:
#   SUPABASE_URL=https://<proyecto>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service_role key, NO la anon key>
```

La **service role key** la sacan de Supabase → Settings → API → "service_role secret". No la suban a Git ni la usen en frontend.

### 3. Backfill histórico

```bash
node scripts/ingest-anual.js --desde=2022 --hasta=2025
```

Esto descarga ~5 años × 5 capítulos = 25 archivos Excel. Dura entre 2 y 10 minutos según red.

Verificar:

```bash
npm start
# en otra terminal:
curl http://localhost:3000/api/enerku/health
curl http://localhost:3000/api/enerku/raw-files
curl "http://localhost:3000/api/enerku/generacion-mensual?anio=2024&tipo=hidro"
```

### 4. Activar el cron diario

En GitHub:
- **Settings → Secrets and variables → Actions**
- Agregar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`

El workflow `.github/workflows/ingest-nightly.yml` corre a las 06:00 UTC todos los días. También se puede disparar manualmente desde la pestaña Actions con parámetros (anio, desde/hasta, caps).

## Endpoints disponibles

| Endpoint | Qué devuelve |
|---|---|
| `GET /api/enerku/health` | Estado del pipeline + últimas 5 corridas |
| `GET /api/enerku/generacion-mensual?anio=&tipo=&central=` | Generación por central, mes a mes |
| `GET /api/enerku/generacion-mensual/por-tipo?anio=` | Agregado por tipo (hidro/solar/eólico/termo) |
| `GET /api/enerku/cmg?desde=&hasta=&barra=` | CMg horarios (pendiente de poblar) |
| `GET /api/enerku/demanda-maxima?anio=&area=` | Demanda máxima mensual |
| `GET /api/enerku/raw-files?anio=&categoria=` | Inventario de archivos descargados |

## Estado de los extractores

| Capítulo | Extractor | Estado |
|---|---|---|
| 1 — Estadística Relevante | — | Solo raw_files (heterogéneo, ver caso por caso) |
| 2 — Generación de Energía | `generacion_mensual` | Best-effort. Refinar viendo Excel real. |
| 3 — Máxima Demanda | `demanda_maxima` | Best-effort. Refinar. |
| 4 — Costos Marginales | — | **TODO**. Estructura muy variable, requiere ver archivos. |
| 5 — Transferencias | — | TODO |

**Cómo refinar un extractor sin re-descargar:**

```js
// scripts/refine-extractor.js (ejemplo)
const supa = require('./lib/supabase');
const file = await supa.selectOne('raw_files', { match: { id: 42 } });
// file.parsed_data tiene todas las hojas como matrices
console.log(Object.keys(file.parsed_data));        // nombres de hojas
console.log(file.parsed_data['Tabla 2.1'].slice(0, 10));  // primeras 10 filas
// → diseñar el extractor mirando filas reales, después actualizarlo en
//   scripts/lib/extractors.js y correr una re-extracción
```

## Decisiones de diseño

- **`raw_files` es el ground truth.** Si un extractor falla o queda mal, el archivo crudo sigue ahí para reprocesar. No perdemos información.
- **Idempotencia por SHA256.** Si re-corremos sobre un archivo ya descargado, no se duplica.
- **Tablas estructuradas tienen `UNIQUE` constraints** sobre (anio, mes, central) o equivalente. El upsert con `on_conflict` deja correr el ingest tantas veces como sea necesario.
- **GitHub Actions, no Railway.** Cero infra, logs visibles para todo el equipo, fácil migrar después. El job dura <10 min, muy debajo del free tier.
- **Schema `enerku` separado de `public`.** WaterKu sigue en su esquina, EnerKu en la suya, una sola base de datos.

## Próximos pasos lógicos (cuando esto esté corriendo en verde)

1. **Llenar el catálogo `enerku.centrales`** con los datos de Caravelí, Wayra Solar y las plantas de los warm contacts (Celsia, Ferrenergy, Orygen). Eso desbloquea joins en los queries.
2. **Refinar el extractor de Capítulo 4 (CMg)** viendo el Excel real del 2024. Una tarde de trabajo.
3. **Agregar un job de "CMg diario"** que baje los costos ejecutados del día anterior (cuando se identifique el endpoint XHR del portal — ver Etapa 2 de la nota de roadmap).
4. **Endpoint exportador para PyPSA**: `GET /api/enerku/pypsa/snapshot?desde=&hasta=&barra=` que devuelva el CSV en formato directo para Luis.
