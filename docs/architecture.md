# Arquitectura y decisiones de diseño

## Principios

**100 % client-side**
Sin backend, sin base de datos, sin costos de infraestructura.
Todo el procesamiento ocurre en el browser del usuario.

**Datos abiertos sin API keys**
Todas las fuentes son públicas y gratuitas. Sin registros, sin tokens.

**Fallback automático**
Cada fuente de datos tiene un fallback en cascada:
- PVGIS (vía CORS proxy) → ERA5 (Open-Meteo) → fallback regional por anuario
- Open-Elevation → OpenTopoData ASTER → marca como NaN (UI advierte)
- corsproxy primario `allorigins.win` → fallback `cors.eu.org`

**Self-tuning**
La detección de región y la redistribución dinámica de pesos por varianza hacen que
el ranking sea informativo sin que el usuario tenga que elegir pesos manualmente.

**Validación rigurosa**
30 sitios de referencia + leave-one-out cross-validation + infraestructura para
calibración con generación medida COES. MAPE 5.7 % in-sample, 6.5 % LOO.

---

## Flujo de datos

```
Usuario ingresa: lat, lng, radio, grilla, kWp, demanda
        ↓
generateGrid()                                  → N×N puntos
generateHorizonRing(centerLat, centerLng,
                    radio×2.5, 12 puntos)        → anillo extendido para sombras
        ↓
fetchElevations() [batch]                       → SRTM (con fallback ASTER), NaN en fallos
        ↓
elevationCoverage() → si <80 %, banner warning UI
        ↓
detectRegion(centerLat, centerLng, centerElev)  → costa | sierra | selva + confianza
        ↓
calcSlope() + calcShadowScore() + calcAzimutScore()
  ↳ shadowScore usa el set extendido (grid + horizon ring)
        ↓
Promise.all(
  fetchForecast(centro, retry),                 → temp base + condiciones tiempo real
  cachedNASA(centro, lastYear-5..lastYear)      → clearness index estacional
)
        ↓
For batch of N puntos en paralelo (B=4):
  - cachedPVGIS(con tilt opts) → applySoiling()
  - si falla, cachedERA5() → applySoiling()
  - si falla, regionalFallback()
        ↓
estimateTemp(elev, baseTemp, baseElev) por punto → tempScore
clearnessScore(centerKT)                         → factor uniforme (CV-redistribuye)
worstMonth() + dailyAverage()                    → para sizing off-grid
absoluteScore() vs benchmark Perú                → 0–100 vs realidad
        ↓
discriminationByFactor() + adjustWeights()       → pesos efectivos por CV
        ↓
computeScores()                                  → ranking
        ↓
fetchForecast() [punto óptimo]                   → condiciones tiempo real (cached)
        ↓
Render Leaflet (OSM/Esri/topo) + tabla + chart + sizing banner
```

---

## Decisiones de diseño

### Detección regional climática (`src/core/region.js`)

Heurística:
- `elev ≥ 2500 m` → sierra (alta confianza)
- `1500 ≤ elev < 2500 m` → sierra de transición (yungas / altura occidental)
- `elev < 1500 m`, lng < divide(lat) → costa
- `elev < 1500 m`, lng > divide(lat) → selva

El **divide andino** es una función piecewise con 8 puntos de control reales:

| Latitud | Longitud divide |
|---|---|
| 0° | -78° |
| -4° | -79° |
| -7° | -78.5° |
| -10° | -77° |
| -12° | -75.5° |
| -14° | -73.5° |
| -16° | -71.5° |
| -18° | -69.5° |

La linealización original Cajamarca→Tacna fallaba en costa norte (Tumbes/Piura) y
costa sur extrema (Tacna/Mollendo/Ilo) clasificándolos incorrectamente. La piecewise
captura la curvatura de la cordillera y logró 30/30 detección en validación.

### Ajuste dinámico por discriminación (`src/core/weights.js`)

Después de calcular factores en cada punto, computamos discriminación =
`(max - min) / |center|` por factor. Factores con discriminación <5 % ceden 80 % de
su peso proporcionalmente a los factores discriminantes. Re-normalizamos a 100.

**Por qué:** un peso fijo de 27 % en sombras topográficas en zona plana de selva sería
un factor muerto (todos puntúan ~85). El ajuste dinámico convierte rigidez en decisión
inteligente sin que el usuario tenga que pensar en ello.

### Presets de pesos por región

| Factor | Costa | Sierra | Selva |
|--------|-------|--------|-------|
| Yield | 28 | 28 | 22 |
| Pendiente | 10 | 18 | 8 |
| Sombras | 5 | **27** | 0 |
| Distancia | 17 | 12 | 15 |
| Azimut | 5 | 5 | 5 |
| Estrés térmico | **22** | 5 | 15 |
| Clearness | 13 | 5 | **35** |

- **Sierra**: relieve complejo → sombras críticas. Frío = bonus para paneles.
- **Costa**: terreno plano. Calor importante (paneles -0.4 %/°C sobre 25 °C).
- **Selva**: nubosidad dominante. Sombras topográficas irrelevantes.

### Calibración SOILING_BY_REGION (`src/core/calibration.js`)

```js
SOILING_BY_REGION = { costa: 1.19, sierra: 1.16, selva: 1.11, unknown: 1.10 }
```

Aplicado post-fetch a respuestas de PVGIS y ERA5 (no al fallback). Combina dos efectos:

1. **Soiling físico real** (aerosoles marinos en costa, lluvia limpia en selva)
2. **Corrección de bias del dataset** (PVGIS NSRDB sub-estima vs Solargis GSA en Perú)

Calibración derivada de validación contra 30 sitios. Ver [CALIBRATION.md](../CALIBRATION.md).

### Bug PVGIS hemisferio sur (`src/api/pvgis.js`)

PVGIS `optimalangles=1` retorna tilt 89–90 ° (panel vertical) para muchos puntos del
hemisferio sur peruano. Workaround:

```js
if (lat < 0) {
  url.searchParams.set('aspect', 180);          // norte facing
  url.searchParams.set('optimalinclination', 1); // optimiza solo el tilt
} else {
  url.searchParams.set('aspect', 0);            // hemisferio norte
  url.searchParams.set('optimalinclination', 1);
}
```

### Estimación de temperatura por punto (`src/core/weights.js`)

```
estTemp(elev) = baseTemp - (elev - baseElev) × 0.0065
```

Lapse rate ambiental estándar (ISA, 6.5 °C/km). Permite que el factor térmico
discrimine puntos dentro de la grilla cuando hay variación de elevación, incluso con
forecast de resolución 13 km.

### Anillo de horizonte (`src/core/shadows.js`)

`generateHorizonRing(centerLat, centerLng, radiusKm × 2.5, 12)` crea 12 puntos
alrededor del área. `calcShadowScore` consume `[...gridPoints, ...horizonPoints]` para
detectar cerros que están fuera de la grilla pero al sur del punto analizado.

Los puntos del anillo no tienen `row` ni `col`, así que `calcSlope` y `calcAzimutScore`
los ignoran automáticamente (sus filtros usan row/col).

### Conversión GHI → yield (`src/api/openmeteo.js`)

ERA5 entrega irradiancia raw (kWh/m²). Para que sea comparable con PVGIS (que da yield
post-pérdidas, kWh/kWp):

```
yield_kWh_per_kWp ≈ kWh_per_m² × 0.92
                  ≈ kWh_per_m² × tilt_gain (1.10) × performance_ratio (0.84)
```

Loss baseline 14 % (igual que default PVGIS).

### CORS proxy con fallback (`src/api/pvgis.js`)

PVGIS no envía headers CORS, browser bloquea fetch directo. Estrategia:

1. Probar `allorigins.win/raw?url=...` (rápido pero throttling intermitente)
2. Si falla, probar `cors.eu.org/...` (más estable, ligeramente más lento)
3. Si ambos fallan, devolver null → orquestador cae a ERA5

### Score absoluto vs Perú (`src/core/score.js`)

```js
PERU_IRR_REF = { excellent: 2400, baseline: 750 }; // kWh/kWp/año
absoluteScore(irr, m1, m2) = ((irr - bot) / (top - bot)) × 100, clamped 0–100
```

Útil para que el usuario sepa si el "óptimo" del área es absoluto bueno o solo
"el menos malo" en una zona uniformemente mediocre.

### Mes crítico para sizing off-grid (`src/core/energy.js`)

```
worstMonth(monthlyYield, m1, m2) → { month, name, yield, dailyYield }
sizingRecommendation(worst, loadKwhPerDay, configuredKwp) → required kWp + cobertura %
```

Sistemas off-grid se dimensionan por el mes mínimo (no el promedio anual). Si la
demanda es 5 kWh/día y julio produce 3 kWh/kWp/día, necesitás ≥1.67 kWp.

### CV-redistribution + presets

```js
PRESETS[region]                                    // pesos base por región
discriminationByFactor(factorArrays)               // CV por factor
adjustWeights(weights, discrim, threshold=0.05)    // redistribuye
```

Combina prior conocimiento (presets) con observación local (varianza dentro de la
grilla). Si shadow tiene CV bajo en el área, su peso va a irradiancia.

---

## Por qué cada decisión de stack

### Por qué PVGIS y no Solargis Pro

- PVGIS: gratis, sin API key, cobertura mundial, dataset NSRDB para América
- Solargis Pro: pago, mejor calibración para Perú, datasets propietarios

Para una herramienta de pre-feasibility gratuita y client-side, PVGIS es la elección
correcta. El bias vs Solargis se compensa con `SOILING_BY_REGION`.

### Por qué Leaflet y no Canvas custom

Inicialmente Canvas para "0 dependencias". Después de validación, Leaflet con OSM/Esri
mejoró drasticamente la usabilidad — el usuario puede ver caminos, ríos, settlements
real-world en lugar de un cuadrado verde abstracto.

Tiles de OSM y Esri World Imagery son gratis sin API key.

### Por qué módulos ES y no inline

La arquitectura previa duplicaba la lógica entre `src/` (documentación) y
`public/index.html` (canónico). Ahora `index.html` importa directamente desde
`../src/`, eliminando duplicación.

Costo: requiere servir desde la raíz del proyecto, no desde `public/`.
Beneficio: un solo source of truth, reusable entre app y página de validación.

---

## Limitaciones conocidas

| Limitación | Impacto | Mitigación / Pendiente |
|-----------|---------|----------------------|
| PVGIS resolución ~1 km | Puntos <1 km dan mismo yield | OK para grillas chicas; cache lo absorbe |
| Forecast GFS ~13 km | Condiciones RT no varían dentro del área | Aceptable; lapse rate compensa el factor temp |
| NASA POWER ~50 km | Clearness uniforme en toda la grilla | Funciona como bias regional, no diferenciador |
| Sombras solo en grilla + ring | No detecta obstáculos a >2.5× radio | Horizonte 360° con DEM completo (pendiente) |
| Detección regional sólo Perú | Heurística no aplica en otros países | Generalizar con Köppen-Geiger (pendiente) |
| 1 factor regional para toda costa | Heterogeneidad costa norte/centro/sur ±15 % | Sub-bandas regionales (pendiente) |
| Sin tracking 1-eje en cálculo principal | yields ~20 % subestimados para sistemas con tracker | Toggle UI + factor 1.20 (pendiente) |
| Sin modelado de panel específico | ±5 % por elección de panel | Dropdown con multiplicadores (pendiente) |
| Dependencia CORS proxy | Si ambos proxies caen, fallback a ERA5 | Auto-redundancia ya implementada |
