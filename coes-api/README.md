# coes-api

> **Propietario — Mallku Engineering Consulting S.A.C.** Uso interno EnerKu / WaterKu. Ver [`COPYRIGHT`](./COPYRIGHT).

Wrapper REST no oficial sobre el portal del **Comité de Operación Económica del Sistema Interconectado Nacional (COES)** del Perú — `coes.org.pe`. Como el portal no expone una API pública, este servicio scrapea HTML con `axios` + `cheerio` y descarga los Excel del repositorio de Estadísticas Anuales, parseándolos con `xlsx`.

Tiene dos capas:

1. **Wrapper de scraping** (`/api/{generacion,demanda,operacion,mercado,publicaciones,estadisticas}`) — lee del portal en cada request, con cache en memoria. Útil para exploración.
2. **Pipeline EnerKu → Supabase** (`/api/enerku/*` + `scripts/ingest-anual.js`) — ingesta nocturna del SEIN a una base histórica. Esto es lo que alimenta al Digital Twin y al demo PyPSA-Peru. **Ver [`ETAPA0.md`](./ETAPA0.md) para el setup completo.**

## Instalación

```bash
npm install
cp .env.example .env
npm start
```

Por defecto escucha en `http://localhost:3000`. Ver `GET /` para el índice de endpoints.

## Headers obligatorios

Todo request sale con:

```js
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'es-PE,es;q=0.9',
  Referer: 'https://www.coes.org.pe/Portal/',
}
```

Sin esto el portal devuelve 403 o HTML vacío.

## Fechas

Input estándar: `YYYY-MM-DD`. Internamente se convierte a `DD/MM/YYYY` que es lo que el portal acepta.

## Respuesta estándar

```json
{
  "success": true,
  "timestamp": "2026-06-23T12:34:56.000Z",
  "from_cache": false,
  "source": "https://www.coes.org.pe/Portal/...",
  "params": { "...": "..." },
  "data": { "...": "..." }
}
```

Errores:

```json
{
  "success": false,
  "timestamp": "...",
  "source": "...",
  "params": {},
  "error": { "message": "...", "status": 400 }
}
```

## Fallback para vistas renderizadas con JavaScript

Varias vistas del portal (programa diario, costos marginales, demanda de barras) cargan los datos mediante Angular/DevExtreme/AJAX después de que carga el HTML. Para esos casos `axios + cheerio` no puede ver los datos. Cuando eso ocurre, el endpoint devuelve:

```json
{
  "data": {
    "rendered_by_js": true,
    "note": "El portal COES renderiza esta vista vía JavaScript ...",
    "source_url": "...",
    "download_links": [
      { "url": "https://www.coes.org.pe/Portal/browser/download?url=...", "text": "...", "type": "xlsx" }
    ],
    "download_links_count": 12
  }
}
```

Los `download_links` casi siempre incluyen los Excel/CSV reales que el portal ofrece como descarga. Si lo que necesitas son los datos tabulares en vivo, hay que correr un headless browser (Playwright/Puppeteer) — esto puede agregarse como un servicio aparte que reciba el `source_url` y devuelva el HTML ya renderizado.

## Cache

`node-cache` en memoria. TTLs por categoría:

| Categoría | TTL |
|---|---|
| Tiempo real (costos marginales del día) | 2 min |
| Generación / demanda | 5 min |
| Programa diario | 10 min |
| Programa semanal / mantenimiento mensual | 30 min |
| Publicaciones (boletines, memorias, informes) | 1 h |
| Catálogos estáticos (Características SEIN, participantes) | 24 h |
| Excel del repositorio anual (capítulos) | 24 h |

Inspección y limpieza:

- `GET /cache/stats`
- `POST /cache/flush`

## Endpoints

### Generación
- `GET /api/generacion?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD&tipo=`
- `GET /api/generacion/fuentes?fecha_inicio=&fecha_fin=` (intenta agrupar por tecnología/fuente; si la página no renderiza tablas devuelve fallback)

### Demanda
- `GET /api/demanda/maxima?anio=2025`
- `GET /api/demanda/distribuidores?fecha_inicio=&fecha_fin=` → DemandaBarras `tipo=2`
- `GET /api/demanda/usuarios-libres?fecha_inicio=&fecha_fin=` → DemandaBarras `tipo=4`

### Operación
- `GET /api/operacion/programa-diario?fecha=YYYY-MM-DD`
- `GET /api/operacion/programa-semanal?fecha=YYYY-MM-DD`
- `GET /api/operacion/mantenimiento?tipo=diario|semanal|mensual|anual&fecha=`
- `GET /api/operacion/caracteristicas-sein`

### Mercado
- `GET /api/mercado/costos-marginales?fecha=YYYY-MM-DD` (cache 2 min)
- `GET /api/mercado/costos-marginales/revisados?anio=2025&mes=03`
- `GET /api/mercado/participantes` (cache 1 h)
- `GET /api/mercado/liquidaciones?anio=2025&mes=03`

### Publicaciones
- `GET /api/publicaciones/estadisticas/:anio`
- `GET /api/publicaciones/memorias/:anio`
- `GET /api/publicaciones/boletines?anio=&mes=`
- `GET /api/publicaciones/informes?anio=`

Todos devuelven `download_links` extraídos del HTML — esto es lo más útil de estas páginas, ya que el contenido real está en PDFs/Excels descargables.

### Estadísticas (descarga + parseo de Excel)

Descarga el archivo desde
`https://www.coes.org.pe/Portal/browser/download?url=Publicaciones/Estadisticas+Anuales/{anio}/Excel/{archivo}.xlsx`
y lo convierte a JSON con `xlsx`.

- `GET /api/estadisticas/sein?anio=2024&hoja=&max_filas=500` → Capítulo 1
- `GET /api/estadisticas/generacion-anual?anio=2024&hoja=&max_filas=500` → Capítulo 2
- `GET /api/estadisticas/capitulo/3?anio=2024&hoja=&max_filas=500` → Capítulo 3 (Máxima Demanda)
- `GET /api/estadisticas/capitulo/4?anio=2024` → Capítulo 4 (Costos Marginales)
- `GET /api/estadisticas/capitulo/5?anio=2024` → Capítulo 5 (Transferencias de Energía)

Parámetros:
- `anio` (requerido): año del repositorio anual
- `hoja` (opcional): nombre exacto de la hoja a devolver. Si no se especifica, se devuelve la primera. La respuesta incluye `sheet_names` con la lista completa para iterar.
- `max_filas` (opcional, default 500, máx 10 000): trunca filas para evitar payloads gigantes.

Respuesta:

```json
{
  "data": {
    "capitulo": 1,
    "anio": 2024,
    "archivo": "Capitulo+01_Estad%C3%ADstica+Relevante+del+SEIN.xlsx",
    "bytes": 1234567,
    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "sheet_names": ["Indice", "Tabla 1", "..."],
    "sheet": "Indice",
    "total_rows": 1280,
    "returned_rows": 500,
    "truncated": true,
    "rows": [ ["...","..."], ["..."] ]
  }
}
```

## Limitaciones conocidas

1. **Renderizado JS:** muchas vistas operacionales requieren un headless browser. El fallback con links de descarga cubre casi todos los casos de uso reales (los analistas igual terminan descargando el Excel).
2. **Sin retry/backoff:** el portal a veces tira 502/504. Pensar en agregar reintentos exponenciales si se va a usar en producción.
3. **Cache en memoria:** si corres múltiples instancias detrás de un load balancer, cada una tiene su cache. Para producción seria, mover a Redis.
4. **No autenticado:** todo lo que sirve es información pública del portal.

## Arquitectura

```
src/
├── server.js                   # Express app + montaje de rutas + manejo de errores
├── utils/coesClient.js         # axios, cache, helpers de fechas, parsers HTML/Excel
├── middleware/asyncHandler.js  # wrapper para handlers async
└── routes/
    ├── generacion.js
    ├── demanda.js
    ├── operacion.js
    ├── mercado.js
    ├── publicaciones.js
    └── estadisticas.js
```

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `COES_BASE_URL` | `https://www.coes.org.pe` | Base del portal |
| `HTTP_TIMEOUT_MS` | `30000` | Timeout outbound |
| `MAX_DOWNLOAD_BYTES` | `52428800` | Límite por descarga (50 MB) |
| `CORS_ORIGINS` | `*` | Lista separada por comas, o `*` |
