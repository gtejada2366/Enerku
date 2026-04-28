# EnerKu — Solar Optimizer Perú

Calculadora client-side de puntos óptimos para instalación de paneles solares en proyectos
rurales / agrícolas (riego, bombeo) de Perú. Detecta la región climática automáticamente
(costa / sierra / selva), aplica un perfil de pesos calibrado por región con ajuste dinámico,
y devuelve ranking de puntos con yield (kWh/kWp/año), mes crítico y dimensionamiento off-grid.

**Calibrado y validado**: MAPE in-sample 5.7 %, MAPE LOO out-of-sample 6.5 %, sobre 30 sitios
de referencia en Perú (PVGIS / Global Solar Atlas / reportes MINEM). Detalle en
[VALIDATION.md](./VALIDATION.md) y [CALIBRATION.md](./CALIBRATION.md).

> **Para revisores**: arrancá leyendo [VALIDATION.md](./VALIDATION.md) (metodología y resultados),
> después [CALIBRATION.md](./CALIBRATION.md) (decisiones de diseño), después
> [docs/architecture.md](./docs/architecture.md) (arquitectura) y finalmente el código en `src/`.

---

## Demo en 60 segundos

```bash
# desde la raíz del proyecto
python3 -m http.server 8080
# o
npx serve .
```

Abrí en el browser:
- `http://localhost:8080/public/` — calculadora principal
- `http://localhost:8080/validation/` — página de validación + calibración

Default: análisis de Cusco (lat -13.5319, lng -71.9675, radio 3 km, grilla 4×4). Click "Analizar área".

---

## Qué hace y qué NO hace

✅ **Sirve para**
- Comparar 4–25 sitios candidatos dentro de un área pequeña (ranking relativo)
- Pre-feasibility de proyectos rurales / agrícolas <$100 k de inversión
- Dimensionamiento off-grid usando el mes crítico
- Estimar yield esperado en kWh/kWp/año con ±6.5 % de error promedio
- Exportar resultados (CSV) para reportes de proyecto

❌ **No sirve para**
- Diseño de ingeniería formal de plantas grandes (PVSyst / Solargis Pro)
- Garantías de generación financiables por bancos
- Modelado específico de paneles, inversores, baterías
- Análisis fuera de Perú (la heurística regional no aplica)

---

## Stack de datos (todo gratis, sin API keys)

| Capa | Fuente | Resolución | CORS | Notas |
|------|--------|-----------|------|-------|
| Yield PV principal | PVGIS v5.2 (JRC/EU, dataset NSRDB) | ~1 km | ❌ → proxy | `optimalinclination=1` con `aspect=180` (workaround bug PVGIS hemisferio sur) |
| Fallback yield | Open-Meteo ERA5-Land | ~9 km | ✓ | GHI raw → yield via factor 0.92 (PR × ganancia tilt) |
| Clearness index | NASA POWER ALLSKY_KT | ~50 km | ✓ | Calibra factor selva |
| Elevación / pendiente / sombras | Open-Elevation (SRTM) → fallback OpenTopoData ASTER | 30 m | ✓ | Anillo extendido fuera de grilla para sombras |
| Forecast tiempo real + temp base | Open-Meteo Forecast (GFS) | ~13 km | ✓ | Lapse rate 6.5°C/km para temp por punto |
| Score compuesto | JS client-side, 7 factores con redistribución dinámica | exacta | local | — |

PVGIS no envía headers CORS, por eso ruteamos vía `allorigins.win` con fallback a `cors.eu.org`.

---

## 7 factores del score (pesos por región)

| Factor | Sentido | Costa | Sierra | Selva |
|--------|---------|-------|--------|-------|
| Yield PV (kWh/kWp) | mayor mejor | 28 | 28 | 22 |
| Pendiente (°) | menor mejor | 10 | 18 | 8 |
| Sombras topográficas (0–100) | mayor mejor | 5 | **27** | 0 |
| Distancia a consumo (km) | menor mejor | 17 | 12 | 15 |
| Orientación / azimut (0–100) | mayor mejor | 5 | 5 | 5 |
| Estrés térmico (0–100, paneles -0.4 %/°C >25°) | mayor mejor | **22** | 5 | 15 |
| Clearness index (0–100, NASA POWER KT) | mayor mejor | 13 | 5 | **35** |

Pesos en negrita = factor dominante por región. Después del análisis, factores con baja
varianza dentro de la grilla ceden 80 % de su peso a los discriminantes (CV-redistribution).

Yield se ajusta post-fetch con factores regionales calibrados — ver [CALIBRATION.md](./CALIBRATION.md).

---

## Estructura del repo

```
EnerKu/
├── public/
│   └── index.html              # App principal (importa módulos desde ../src/)
├── validation/
│   ├── index.html              # Página de validación + calibración
│   ├── sites.json              # 30 sitios de referencia en Perú
│   └── coes-plants.json        # 8 plantas SEIN-PV con metadata real
├── src/
│   ├── api/
│   │   ├── pvgis.js            # PVGIS v5.2 (con CORS proxy)
│   │   ├── openmeteo.js        # ERA5 + Forecast
│   │   ├── elevation.js        # Open-Elevation + ASTER fallback
│   │   └── nasa-power.js       # NASA POWER (clearness index)
│   └── core/
│       ├── grid.js             # Generación de grilla N×N
│       ├── region.js           # Detección costa/sierra/selva (piecewise andes)
│       ├── weights.js          # Presets + CV-redistribution + temp + clearness
│       ├── shadows.js          # Slope/shadow/azimut + horizon ring
│       ├── score.js            # Score compuesto + score absoluto
│       ├── energy.js           # Conversión yield→energía + mes crítico + sizing
│       ├── calibration.js      # SOILING_BY_REGION + LOO + COES + retry/proxy
│       ├── cache.js            # localStorage TTL para PVGIS/ERA5/NASA
│       └── utils.js            # haversine, SEASONS
├── docs/
│   ├── architecture.md         # Decisiones de diseño + flujo de datos
│   └── data-sources.md         # Documentación detallada de APIs
├── README.md                   # Este archivo
├── VALIDATION.md               # Metodología de validación + resultados
├── CALIBRATION.md              # Justificación de SOILING_BY_REGION
├── CHANGELOG.md                # Journey de desarrollo + decisiones clave
├── LICENSE                     # MIT
└── .gitignore
```

---

## Resultados de validación (resumen)

Sobre 30 sitios de referencia (12 costa + 10 sierra + 8 selva):

| Métrica | In-sample | LOO out-of-sample |
|---|---|---|
| MAE | 107 kWh/kWp | 121 kWh/kWp |
| MAPE | **5.7 %** | **6.5 %** |
| Sesgo medio | -36 kWh/kWp | +9 kWh/kWp |
| Región acertada | 30/30 (100 %) | — |
| Ratio LOO/in-sample | — | 1.13× → **generaliza bien** |

Detalle completo: [VALIDATION.md](./VALIDATION.md).

---

## Confiabilidad por caso de uso

| Caso | Confianza |
|---|---|
| Comparación de sitios (ranking) | ★★★★★ |
| Detección de región Perú | ★★★★★ |
| Yield absoluto sitio nuevo | ★★★★ (±6.5 % medio, ±15 % per-site) |
| Mes crítico para off-grid | ★★★★ |
| Dimensionamiento kWp + margen | ★★★★ |
| Reporte técnico defendible | ★★★★ (LOO validado) |
| Diseño final planta >$500 k | ★ (usar PVSyst) |
| Garantía bancable | ✗ (usar Solargis Pro) |

---

## Workflow recomendado para usar

1. **Definir área**: lat/lng del centro, radio (3–10 km), grilla (3×3 a 5×5)
2. **Opcional**: lat/lng del punto de consumo (bomba, pozo) para incorporar distancia
3. **Configurar sistema**: kWp planeado, demanda diaria opcional (kWh/día)
4. **Click "Analizar área"** — toma ~30–60 segundos para 16 puntos
5. **Revisar**:
   - Mapa Leaflet con ranking color-coded
   - Tabla con yield, mes crítico, sombras, pendiente, temp
   - Banner de dimensionamiento si llenaste demanda
   - Pronóstico 7 días del punto óptimo
6. **Exportar CSV** para reporte
7. **Compartir**: botón "Copiar enlace" preserva todo el state en URL hash

---

## Mejoras pendientes

- [ ] Llenar `coes-plants.json` con datos del Anuario COES más reciente para anclar calibración en ground truth medido (sección 5 en `/validation/`)
- [ ] Sub-bandas regionales (costa norte / centro / sur) para reducir error a ~3 %
- [ ] Validación con datos terrestres SENAMHI (piranómetros)
- [ ] Detección de "garúa" en costa central (ajuste invierno por nubosidad costera)
- [ ] Soporte para tracking 1-eje en el cálculo principal
- [ ] Modelado de bifacialidad / temp-coef de panel específico
- [ ] Horizonte solar 360° con DEM extendido (no solo grilla)

Ver [CHANGELOG.md](./CHANGELOG.md) para el journey completo de mejoras realizadas.

---

## Contexto

Desarrollado para análisis de sitios de instalación solar en proyectos de riego/bombeo
agrícola en Perú. Prioriza datos abiertos y funcionamiento 100 % client-side
(sin backend, sin costos de infraestructura, sin API keys requeridas).

Licencia: MIT — ver [LICENSE](./LICENSE).
