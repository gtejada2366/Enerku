# Validación

Este documento explica cómo se validó la herramienta y qué tan confiable es.

## TL;DR

- **30 sitios de referencia** distribuidos en costa (12), sierra (10) y selva (8) de Perú
- **MAPE in-sample: 5.7 %** (error medio absoluto vs valores esperados)
- **MAPE leave-one-out: 6.5 %** (error esperado en sitios nuevos no usados para calibrar)
- **Ratio LOO / in-sample: 1.13×** → la calibración generaliza bien (no es overfit)
- **Detección de región: 30/30** sitios clasificados correctamente
- Validado con yield directo de PVGIS, comparado contra valores publicados de
  Global Solar Atlas (Solargis), reportes MINEM y datos contractuales de plantas SEIN

## Fuentes de los valores esperados

Los `expectedAnnualYield` en [`validation/sites.json`](./validation/sites.json) provienen de:

1. **Global Solar Atlas (GSA, Banco Mundial / Solargis)** — base satelital con resolución
   ~250 m, considerada referencia internacional para Perú. Disponible en
   [globalsolaratlas.info](https://globalsolaratlas.info).
2. **PVGIS direct queries** para sitios donde el dato GSA no está documentado públicamente.
3. **Reportes MINEM y Energía Estratégica** para plantas SEIN-PV operativas.

**Tolerancia esperada**: ±10 % en sitios típicos de su región, ±15 % en zonas de transición.
Una desviación dentro de ese rango indica wrapper bien calibrado; sesgo sistemático grande
(>5 %) indica que `SOILING_BY_REGION` necesita ajuste.

## Metodología

### Validación principal (sección 1 en `/validation/`)

Para cada sitio:

1. Obtener elevación (Open-Elevation → fallback ASTER)
2. Detectar región (función piecewise sobre el divide andino)
3. Pedir yield a PVGIS con `optimalinclination=1` y `aspect=180` (norte para hemisferio sur)
4. Si PVGIS falla (después de 4 retries con backoff): fallback ERA5
5. Si ERA5 falla: regional fallback (valor anual típico por región)
6. Aplicar `SOILING_BY_REGION[region]` post-fetch
7. Comparar contra `expectedAnnualYield`

Se computan métricas agregadas:
- **MAE** = mean(|delta|)
- **Sesgo** = mean(delta) (positivo = sobreestima, negativo = subestima)
- **MAPE** = mean(|delta| / expected) × 100
- **Region accuracy** = sitios con `regionInfo.region == site.expectedRegion` / total

### Leave-one-out cross-validation (sección 1 en `/validation/`, auto)

Para cada sitio i en [0..N-1]:

1. Quitar el sitio i del dataset
2. Calibrar `SOILING_BY_REGION` óptimo desde los otros N-1 sitios
   (mean ratio `expected / pvgis_raw` por región)
3. Aplicar el factor entrenado al PVGIS raw del sitio i
4. Registrar el error de la predicción

LOO mide si la calibración generaliza:
- **Ratio LOO/in-sample ~1.0×**: sin overfit (test ≈ train)
- **Ratio 1.0–1.3×**: generaliza bien
- **Ratio 1.3–1.7×**: aceptable
- **Ratio >1.7×**: overfit serio (calibración curve-fitting al ruido)

Implementación: [`validation/index.html`](./validation/index.html) función `runLeaveOneOut()`.

### Calibración manual (sección 2 en `/validation/`)

Para cada sitio del que el usuario tiene yield medido:

1. Lat/lng/yield medido como input
2. Sistema fetcha PVGIS para ese punto
3. Calcula factor sugerido = `medido / pvgis_calculado × current_factor`
4. Sugiere edición de `SOILING_BY_REGION[region]`

Útil para ajustar la calibración con datos privados del usuario.

### Calibración contra plantas COES (sección 5 en `/validation/`)

8 plantas SEIN-PV pre-pobladas con metadata real (capacidad kWp DC, COD year, tipo de
montaje). Para cada planta el usuario puede actualizar `MWh/año` desde el último
[Anuario COES](https://www.coes.org.pe/portal/publicaciones/anuario/).

Sistema computa:

```
yield_medido = (MWh × 1000) / kWp_DC                    # bruto
trackingGain = 1.20 si tracking-1axis, sino 1.00
degradationFactor = 1 - LID(1%) - 0.5%/año × edad
yield_normalizado = yield_medido / trackingGain / degradationFactor
```

`yield_normalizado` es directamente comparable con la salida de PVGIS (sistema fijo,
módulos nuevos). Se compara contra `pvgis_raw × SOILING_BY_REGION.costa` y se sugiere
factor anclado en ground truth medido.

**Limitación**: las plantas SEIN-PV están casi todas en costa sur extrema (Moquegua /
Tacna / Arequipa). Esto valida costa pero no sierra ni selva.

## Resultados

### Run de validación 2026-04-28 (después de calibración aplicada)

| Métrica | Valor |
|---|---|
| Sitios procesados | 30 / 30 |
| Sitios "OK" (≤10 % err) | 24 |
| Sitios "aceptable" (10–15 % err) | 5 |
| Sitios "desviado" (>15 % err) | 1 (Mollendo, -22 % por valor esperado posiblemente sobreestimado) |
| MAE | 107 kWh/kWp |
| MAPE | 5.7 % |
| Sesgo medio | -36 kWh/kWp |
| Región acertada | 30 / 30 (100 %) |
| Source PVGIS real | 30 / 30 |

### LOO sobre el mismo run

| Métrica | Valor |
|---|---|
| Sitios LOO | 30 |
| MAE LOO | 121 kWh/kWp |
| MAPE LOO | 6.5 % |
| Sesgo LOO | +9 kWh/kWp |
| Ratio LOO / in-sample | 1.13× |
| Verdict | **generaliza bien** |

## Sitios con desvío residual (>10 %)

Estos casos NO son errores de la calculadora — son heterogeneidad real dentro de cada
región que un solo factor de calibración no captura.

| Sitio | Coords | Región | Δ | % err | Causa probable |
|---|---|---|---|---|---|
| Mollendo | -17.02, -72.01 | costa | -464 | -22 % | Posiblemente `expectedAnnualYield` GSA sobreestimado para costa con neblina |
| Tumbes | -3.57, -80.46 | costa | -243 | -12 % | Costa norte tropical con NSRDB underestimating |
| Ilo | -17.65, -71.34 | costa | -248 | -11.5 % | Costa sur extrema, similar a Tacna |
| Lima | -12.10, -76.99 | costa | +205 | +13.7 % | Sobreestima — garúa de invierno parcialmente capturada |
| Chachapoyas | -6.23, -77.87 | sierra | -225 | -12.9 % | Yungas, frontera sierra-selva |
| Bagua | -5.64, -78.53 | selva | -205 | -12 % | Selva alta de transición |

Estas son 4 microrregiones distintas de costa que un solo factor `costa = 1.19` no
captura perfectamente. Para reducir error a <5 % se necesitaría sub-banding regional
(costa norte / centro / sur) o anclaje en ground truth COES por sub-región.

## Cómo reproducir

1. Iniciá el servidor estático desde la raíz: `python3 -m http.server 8080`
2. Abrí `http://localhost:8080/validation/`
3. Click "Ejecutar validación" — toma ~1.5–2 min para los 30 sitios
4. El sistema corre LOO automáticamente al final

Resultados se guardan en `localStorage` (`solar-validation-history` con últimas 20 corridas).

## Lo que esto NO valida

- Predicciones mensuales / estacionales (solo total anual)
- Generación de plantas con tracking (los factores son para fijo)
- Yield en climas extremos (frío sierra alta, calor selva)
- Incertidumbre individual por sitio (sigue siendo ±10–15 %)
- Sitios fuera de Perú continental (heurística regional no aplica)

Para cualquiera de los anteriores hay que extender la metodología o usar herramientas
profesionales (PVSyst / Solargis Pro).
