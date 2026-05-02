# Changelog

Journey del desarrollo y decisiones clave del proyecto.

## v0.6 — bombeo solar agrícola (2026-05-02)

### Calculadora completa de bombeo (`src/core/pumping.js`)

- **5 tipos de bomba** con rangos de operación, eficiencia típica y costo $/kW:
  helicoidal superficial, helicoidal sumergible, centrífuga superficial, centrífuga
  sumergible, diafragma. Sistema recomienda la mejor para Q + H del proyecto.
- **TDH (Total Dynamic Head)** = altura estática + fricción tubería + presión deseada
- **Pérdida por fricción** vía Hazen-Williams (PVC/HDPE/galvanizado)
- **Diámetro de tubería auto-recomendado** según velocidad target 1.5 m/s, snap a
  tamaños comerciales (25/32/40/50/63/75/90/110/140/160/200 mm)
- **Potencia hidráulica → eléctrica** con η_bomba × η_motor × η_controller
- **kWp requerido** dimensionado por mes crítico (del análisis solar) con
  derating 0.85 + margen 10 %
- **Almacenamiento**: tanque vs batería con costos referenciales Perú 2026
  (PE $0.12/L vs LFP $400/kWh) y recomendación automática

### Helper de cultivo → caudal

13 cultivos comunes Perú con consumo típico m³/ha/año:
- Estacionales: papa, maíz, arroz, uva
- Permanentes: alfalfa, hortalizas, café, cacao, palta, caña, pasto, espárrago
- Especial: bebedero ganado (50 L/cabeza/día)

4 sistemas de riego con factor de eficiencia: inundación (1.00), aspersión (0.75),
microaspersión (0.55), goteo (0.50).

UI: dropdown cultivo + hectáreas + sistema → click "Aplicar" auto-llena caudal.

### UI principal

- Card "Bombeo solar agrícola" con toggle, helper de cultivo expandible, 7 inputs
  técnicos (caudal, alturas, fricción, presión, horas, días autonomía, diámetro)
- 4 stat cards visibles cuando activo: TDH, kWh/día, kWp requerido, tanque vs batería
- Banner verde con recomendación de bomba (tipo, costo, alternativas)
- CSV export con metadata completa de bombeo
- URL state preserva todos los campos pump-*

---

## v0.5 — análisis económico + potencial eólico (2026-04-28)

### Análisis económico (`src/core/economics.js`)

- LCOE (Levelized Cost of Energy) con depreciación + descuento
- Simple payback (años) y discounted payback con interpolación lineal
- NPV @ vida útil (default 20 años, configurable)
- IRR (Internal Rate of Return) vía Newton-Raphson
- 3 modos: grid-tied, off-grid (reemplazo diésel), PPA
- Defaults Perú 2026: $1000/kWp residencial, $0.135/kWh tarifa BT5B, $1.35/kWh diésel
- Inflación de precio de energía configurable (default 2.5 %/año)
- Persistencia en URL state + CSV export con metadata económica

### Potencial eólico (`src/core/wind.js` + `src/api/openmeteo.js`)

- Curvas de potencia para 5 turbinas: 500 W, 2 kW, 10 kW, 100 kW, 2 MW
- Extrapolación log-law a la altura del hub (rugosidad configurable)
- Capacity factor desde serie horaria ERA5 (8760 h) o desde velocidad media
  (Rayleigh distribution, k=2)
- Open-Meteo Archive endpoint para `wind_speed_10m` y `wind_speed_100m` horarios
- Análisis híbrido: solar + eólico = energía anual total
- Toggle opcional (1 fetch extra para todo el análisis)
- Categorización cualitativa (excelente / muy bueno / bueno / marginal / no viable)

### Limitaciones honestas

- ERA5 (~9 km) sub-estima vientos en topografía compleja (sierra alta) ~10-20 %
- No modelamos densidad de aire por altitud (sub-estima sierra ~10 %)
- Las curvas de potencia son aproximadas; cada fabricante difiere
- Para diseño final de parques eólicos usar mediciones de mástil + WAsP / WindPRO

---

## v0.4 — calibración + validación + COES + LOO (2026-04-28)

### Validación riguroso

- 30 sitios de referencia distribuidos en costa, sierra y selva
- Calibración aplicada: `SOILING_BY_REGION = {costa: 1.19, sierra: 1.16, selva: 1.11}`
- MAPE in-sample: **5.7 %**, MAPE LOO: **6.5 %**, ratio 1.13× → generaliza bien
- Detección de región: **30/30** acertadas (función piecewise sobre divide andino)

### Infraestructura para calibración con ground truth

- `validation/coes-plants.json` con 8 plantas SEIN-PV pre-pobladas (Tacna, Panamericana,
  Majes, Repartición, Moquegua FV, Rubí, Intipampa, Matarani)
- Sección 5 en `/validation/`: usuario puede llenar MWh/año del Anuario COES, sistema
  normaliza por edad + tracking y compara contra PVGIS
- Helpers en `calibration.js`: `normalizePlantYield()`, `suggestFromCOES()`

### Bugs detectados y arreglados durante validación

- **PVGIS sin CORS** → routing por `allorigins.win` con fallback `cors.eu.org`
- **PVGIS `optimalangles=1` devuelve panel vertical en hemisferio sur** → workaround
  con `aspect=180 + optimalinclination=1`
- **Andes divide lineal Cajamarca→Tacna falla en costa norte y sur extrema** →
  reemplazado por interpolación piecewise con 8 puntos reales
- **ERA5 conversión MJ/m² → kWh dividía por 1000 en vez de 3.6** → 278× más bajo
  silenciosamente. Fix con factor 0.92 para que sea comparable a PVGIS

### Features de validación

- Leave-one-out cross-validation auto-ejecutado tras validación regular
- Calibración manual desde sitio conocido (sección 2)
- Importador CSV de sitios custom (sección 3)
- Historial de validaciones en localStorage (sección 4)
- Página de validación independiente con su propio dataset

### Documentación

- `VALIDATION.md` con metodología completa
- `CALIBRATION.md` con justificación de los factores
- `CHANGELOG.md` con journey de desarrollo
- `LICENSE` MIT
- `README.md` reescrito con resultados de validación

---

## v0.3 — confidence intervals + cross-source agreement (2026-04-27)

### Reliability mejorada

- Banda de incertidumbre por punto (`uncertaintyBand`): combina varianza entre fuentes
  + cobertura elevación + base residual
- Etiqueta de confianza (`alta` / `media` / `baja`)
- Cross-source agreement opt-in: corre PVGIS y ERA5 en paralelo, mide acuerdo
- Detección de elevación con NaN (no más 0 silente para fallos de API)
- Fallback regional adaptativo (no más 1700 hardcoded)

### Mejor manejo de errores

- Retry con backoff exponencial (300/600/1200 ms) en todos los fetches externos
- Bounding box validation: warning si lat/lng fuera de Perú continental
- Coverage de elevación: si <80 % falla, banner explicativo

---

## v0.2 — energía real + dimensionamiento + tilt configurable (2026-04-27)

### Dimensionamiento off-grid

- Input de potencia pico (kWp) y demanda diaria (kWh/día)
- Cálculo de mes crítico (`worstMonth`): el mes con menor yield, define dimensionamiento
- Producción diaria promedio (`dailyAverage`)
- Banner de sizing recomendado: "tu sistema cubre X % de la demanda; mínimo recomendado Y kWp"
- Soiling regional aplicado (costa -5 %, sierra 0 %, selva +1 %) — antes de calibración

### Tilt + azimut

- Auto-optimal por default (PVGIS `optimalangles`, antes de descubrir el bug)
- Override manual: tilt 0–60°, azimut -180 a 180

### Cache + UX

- Cache localStorage TTL 30 días (PVGIS, ERA5, NASA POWER)
- CSV export con metadata
- URL state encoding (compartir análisis con link)
- Mapa Leaflet con OSM/Esri/topográfico (reemplazó Canvas)

### Arquitectura

- Refactor a ES modules; `index.html` importa de `../src/`
- `calibration.js` extraído de `index.html` para reuso
- `cache.js` con cuota dinámica
- Soporte para tilt/aspect/loss en `pvgis.js`

---

## v0.1 — base + auto-detección regional (2026-04-26)

### Multi-factor scoring

- 7 factores: yield, pendiente, sombras, distancia, azimut, temp, clearness
- Score relativo (rank dentro de área) + score absoluto (vs benchmark Perú)
- CV-redistribution: factores uniformes ceden peso

### Detección regional

- Función piecewise andesDivide entre Cajamarca y Tacna (más tarde reemplazada por
  8 puntos)
- Presets de pesos por región (costa / sierra / selva)
- `region.js`, `weights.js`, `score.js`

### Datos

- Cliente PVGIS, ERA5 (Open-Meteo), NASA POWER, Open-Elevation, ASTER fallback
- Forecast 7 días + condiciones tiempo real

### UI

- Grilla configurable 3×3 a 5×5
- Mapa Canvas (después reemplazado por Leaflet)
- Tabla de ranking con badges de calidad
- Gráfico mensual de yield

---

## Mejoras pendientes (roadmap)

Ver issues en GitHub para tracking.

- [ ] Llenar `coes-plants.json` con datos del Anuario COES más reciente (anchor en ground truth medido)
- [ ] Sub-bandas regionales (costa norte / centro / sur) para reducir error per-site
- [ ] Validación con datos terrestres SENAMHI (piranómetros)
- [ ] Detección de "garúa" en costa central (ajuste invierno por nubosidad costera)
- [ ] Soporte para tracking 1-eje en cálculo principal
- [ ] Modelado de bifacialidad / temp-coef de panel específico
- [ ] Horizonte solar 360° con DEM extendido (no solo grilla + ring)
- [ ] PDF report imprimible
- [ ] Mobile-responsive
