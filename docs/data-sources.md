# Fuentes de datos

## Activas

### PVGIS v5.2 — Joint Research Centre (EU)
- **URL**: `https://re.jrc.ec.europa.eu/api/v5_2/PVcalc`
- **Resolución**: ~1 km
- **Dataset usado en Perú**: PVGIS-NSRDB (NREL satellite data para América)
- **Cobertura Perú**: completa
- **API key**: no requerida
- **CORS**: ❌ no habilitado → routeamos vía `allorigins.win` (fallback `cors.eu.org`)
- **Rate limit**: sin documentar — usamos delay de 150 ms entre batches de 4
- **Cliente**: [`src/api/pvgis.js`](../src/api/pvgis.js)

**Parámetros usados**:
- `peakpower=1` — yield por kWp instalado
- `loss=14` — pérdidas DC + inversor + cableado + soiling baseline (default PVGIS)
- `aspect=180` (lat<0) o `aspect=0` (lat>0) — workaround del bug de optimización
- `optimalinclination=1` — PVGIS optimiza solo el tilt (no aspect)

**Bug conocido**: `optimalangles=1` (que optimiza tanto tilt como aspect) devuelve
tilt 89–90 ° (panel vertical) para muchos puntos del hemisferio sur peruano, dando
yields catastróficamente bajos. Por eso forzamos `aspect` y solo optimizamos el tilt.

### Open-Meteo Historical — ERA5-Land
- **URL**: `https://api.open-meteo.com/v1/archive`
- **Resolución**: ~9 km
- **Dataset**: ERA5-Land (ECMWF / Copernicus)
- **Histórico desde**: 1940
- **API key**: no requerida
- **CORS**: ✅ habilitado (`access-control-allow-origin: *`)
- **Año del request**: dinámico, último año completo (`new Date().getFullYear() - 1`)
- **Cliente**: [`src/api/openmeteo.js`](../src/api/openmeteo.js)
- **Variable**: `shortwave_radiation_sum` en MJ/m²/día
- **Conversión a yield**: `(MJ/m² ÷ 3.6) × 0.92 = kWh/kWp` (factor 0.92 ≈ tilt × PR)
- **Uso**: fallback cuando PVGIS falla

### Open-Meteo Forecast — GFS
- **URL**: `https://api.open-meteo.com/v1/forecast`
- **Modelo Perú**: GFS (~13 km)
- **Variables**: `temperature_2m`, `wind_speed_10m`, `dew_point_2m`, `shortwave_radiation`
- **Daily**: `shortwave_radiation_sum`, `temperature_2m_max`, `temperature_2m_min`
- **Forecast**: 7 días
- **API key**: no requerida
- **CORS**: ✅ habilitado

### NASA POWER — ALLSKY_KT (clearness index)
- **URL**: `https://power.larc.nasa.gov/api/temporal/monthly/point`
- **Resolución**: ~50 km
- **Variables clave**: `ALLSKY_SFC_SW_DWN`, `ALLSKY_KT`, `T2M`, `WS10M`
- **Período del request**: últimos 5 años (rolling)
- **API key**: no requerida
- **CORS**: ✅ habilitado
- **Cliente**: [`src/api/nasa-power.js`](../src/api/nasa-power.js)

`ALLSKY_KT` (clearness index) define el peso 35 % del score en selva: ratio entre
irradiancia real y teórica de cielo despejado. KT 0.65 = costa norte; KT 0.35 = selva
muy nubosa. Promedio mensual multi-año.

### Open-Elevation — SRTM 30 m
- **URL**: `https://api.open-elevation.com/api/v1/lookup`
- **Resolución**: 30 m (NASA SRTM)
- **API key**: no requerida
- **CORS**: ✅ habilitado
- **Limitación**: instancia comunitaria; con >20 puntos puede dar timeout
- **Modo**: batch hasta 100 puntos en una request
- **Cliente**: [`src/api/elevation.js`](../src/api/elevation.js)

### OpenTopoData — ASTER 30 m (fallback)
- **URL**: `https://api.opentopodata.org/v1/aster30m`
- **Resolución**: 30 m (NASA / METI ASTER GDEM)
- **API key**: no requerida
- **CORS**: ✅ habilitado
- **Rate limit**: 1 req/seg recomendado → delay de 60 ms entre puntos
- **Modo**: punto a punto
- **Uso**: fallback cuando Open-Elevation batch falla

---

## CORS proxies (para PVGIS)

PVGIS no envía headers CORS, por eso necesitamos un proxy.

### allorigins.win (primario)
- **URL**: `https://api.allorigins.win/raw?url=<encoded-target>`
- **Free**: sí, sin auth
- **Reliability**: buena pero puede tener throttling intermitente / cold start
- **Latencia**: ~200–500 ms

### cors.eu.org (fallback)
- **URL**: `https://cors.eu.org/<target>`
- **Free**: sí, sin auth
- **Reliability**: estable
- **Latencia**: ~300–600 ms

Estrategia: probar `allorigins.win` primero (más rápido cuando responde). Si falla,
caer a `cors.eu.org`. Implementación en [`src/api/pvgis.js`](../src/api/pvgis.js)
constante `CORS_PROXIES`.

---

## Pendientes de integración

### NSRDB — National Renewable Energy Laboratory (NREL)
- **URL**: `https://developer.nrel.gov/api/nsrdb/v2/solar/`
- **Resolución**: ~2 km
- **Dataset**: GOES-16 procesado, mejor para América
- **API key**: gratuita en developer.nrel.gov
- **Ventaja sobre PVGIS**: mejor corrección atmosférica para Andes y selva peruana
- **Por qué pendiente**: rompería el principio "0 API keys"

### GOES-16 / GOES-18 (AWS Open Data)
- **Bucket S3**: `s3://noaa-goes16` (US-East-1)
- **Resolución**: 2 km (infrarrojo), 0.5 km (visible)
- **Latencia**: 15 minutos
- **Caso de uso**: irradiancia casi en tiempo real a 2 km para selva
- **Por qué pendiente**: requiere procesamiento de imágenes satelitales (alta complejidad)

### SENAMHI — datos terrestres
- **URL**: `senamhi.gob.pe` y `idesep.senamhi.gob.pe`
- **Estaciones con piranómetro en Perú**: ~50 (Cajamarca, La Joya, Yauricocha, etc.)
- **Caso de uso**: validación con ground truth medido (no satelital)
- **Por qué pendiente**: datos en visor con captcha intermitente, scraping no trivial

### COES — datos de plantas SEIN
- **URL**: `coes.org.pe/portal/publicaciones/anuario/`
- **Datos**: generación anual por planta (MWh)
- **Plantas SEIN-PV**: Tacna Solar, Panamericana, Majes, Repartición, Moquegua FV, Rubí, Intipampa, Matarani
- **Estado**: infraestructura lista en `validation/coes-plants.json`; datos default
  son aproximaciones de fuentes públicas. **El usuario debe llenar con valores del
  Anuario más reciente** para anclar calibración en ground truth medido.
