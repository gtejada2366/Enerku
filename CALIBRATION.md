# Calibración

Este documento explica las decisiones de calibración del wrapper, qué representan
los factores de [`src/core/calibration.js`](./src/core/calibration.js) y cómo se llegó
a los valores actuales.

## Valores actuales

```js
export const SOILING_BY_REGION = {
  costa:   1.19,
  sierra:  1.16,
  selva:   1.11,
  unknown: 1.10,
};
```

El nombre histórico es "soiling" pero los valores actuales **combinan dos efectos**:

1. **Soiling real** (paneles ensuciados por aerosoles, polvo, sal marina)
2. **Corrección de bias del dataset** (PVGIS NSRDB vs Global Solar Atlas Solargis)

## Por qué los valores son >1

PVGIS por default asume `loss=14 %` que ya incluye ~2 % de soiling baseline. Si los
factores fueran sólo soiling físico, deberían ser <1 (más pérdidas = factor menor):

- Costa peruana: aerosoles marinos pesados (Lima/Pisco/Ilo), debería ser ×0.92 (-8 %)
- Sierra alta: ambiente seco y limpio, ×1.00
- Selva: lluvia frecuente limpia paneles, ×1.01 (bonus leve)

Pero la validación contra Global Solar Atlas reveló que **PVGIS sub-estima
sistemáticamente en Perú** porque el dataset PVGIS-NSRDB tiene calibración limitada
para América del Sur:

| Región | Bias PVGIS vs GSA |
|---|---|
| Costa norte tropical (Tumbes/Piura) | -25 % a -27 % (más bajo) |
| Costa centro (Lima/Pisco/Ica) | -10 % a -15 % |
| Costa sur (Tacna/Majes) | -15 % a -20 % |
| Sierra | -15 % a -20 % |
| Selva | -8 % a -12 % |

El factor combinado neto:
- Costa: bias dataset (-25 %) − soiling marino (-5 %) → **+19 % neto** = 1.19
- Sierra: bias dataset (-16 %) sin soiling adicional → **+16 % neto** = 1.16
- Selva: bias dataset (-10 %) + bonus lluvia (+1 %) → **+11 % neto** = 1.11

## Cómo se derivaron los valores actuales

El procedimiento iterativo fue:

### Run 1 — completamente roto

Resultado: 30/30 sitios cayeron a regional fallback. PVGIS y ERA5 ambos fallaron
sistemáticamente. **Causa**: PVGIS no envía headers CORS, browser bloquea fetch.
**Fix**: rutear PVGIS por proxy `allorigins.win` (con fallback `cors.eu.org`).

### Run 2 — proxy funciona pero PVGIS devuelve panel vertical

Resultado: PVGIS responde, pero para muchos puntos del hemisferio sur devuelve
yields catastróficamente bajos (Lima 653, Yurimaguas 672, Pucallpa 658 kWh/kWp).
**Causa**: PVGIS `optimalangles=1` tiene un bug en hemisferio sur que devuelve
tilt = 89–90 ° (panel CASI VERTICAL).
**Fix**: forzar `aspect=180` (norte para hemisferio sur) y usar `optimalinclination=1`
solo para optimizar el tilt.

Sesgo Run 2: **-285 kWh/kWp** (calculadora subestima 14 %).
Sugerencia automática: costa ×1.19, sierra ×1.16, selva ×1.11.

### Run 3 — calibración aplicada

Resultado:
- MAE: 107 kWh/kWp (vs 285 antes)
- MAPE: **5.7 %** (vs 14.7 %)
- Sesgo: **-36 kWh/kWp** (esencialmente cero)
- 30/30 PVGIS coverage
- 30/30 región acertada

LOO confirmó MAPE 6.5 % (ratio 1.13×) → calibración generaliza, no es overfit.

## Por qué un único factor por región es la complejidad correcta

La validación muestra heterogeneidad dentro de cada región que un solo factor no
captura:

- **Lima** (costa centro con garúa) sobreestima +13.7 %
- **Tumbes** (costa norte tropical) subestima -12 %
- **Tacna** (costa sur extrema) acierta +2.6 %

Aplicar otro +5 % a costa empeoraría Lima (ya sobreestima) para mejorar Tumbes.
La elección "factor único" es deliberada:

- **Pros**: simple, defensible, generaliza bien (LOO 1.13×)
- **Cons**: error per-site irreductible ~10–15 %

Para reducir error per-site se necesitaría:

1. **Sub-bandas regionales** (costa norte / centro / sur) — implementable, ~1–2 horas
2. **Datos COES medidos** (sección 5 de `/validation/`) — requiere bajar Anuario
3. **Datos terrestres SENAMHI** — requiere scrapear pyrómetros

Ver [VALIDATION.md](./VALIDATION.md) para el detalle por sitio.

## Cómo recalibrar

Si tenés un yield medido conocido y querés recalibrar:

### Manual, un sitio

1. Abrí `/validation/` sección 2 ("Calibración manual desde sitio conocido")
2. Llená lat/lng/yield medido (kWh/kWp/año)
3. Click "Calcular factor sugerido"
4. Editá `src/core/calibration.js` con el factor sugerido

### Múltiples sitios externos

1. Preparar CSV con `name,lat,lng,elev,region,expectedYield,source` (una fila por sitio)
2. Abrí `/validation/` sección 3 ("Importar sitios adicionales")
3. Pegar CSV y click "Importar"
4. Click "Ejecutar validación" — los custom sites se incluyen automáticamente
5. Aplicar el factor sugerido del bloque verde

### Plantas COES

1. Bajar [Anuario COES](https://www.coes.org.pe/portal/publicaciones/anuario/)
   más reciente
2. Abrí `/validation/` sección 5 ("Calibración contra plantas COES")
3. Para cada planta SEIN-PV: actualizar `MWh/año` con el valor del Anuario
4. Click "Validar contra PVGIS"
5. Si hay diferencia >3 %, aplicar el factor sugerido (válido sólo para costa sur)

## Otras decisiones técnicas relevantes

### Lapse rate térmico (`src/core/weights.js`)

Temperatura por punto = `baseTemp − (elev − baseElev) × 0.0065`

Constante 6.5°C/km es el lapse rate ambiental estándar (ISA). Permite que la
temperatura discrimine puntos dentro de la grilla cuando hay variación de elevación,
incluso con forecast de resolución 13 km.

### Conversión GHI → yield para ERA5 (`src/api/openmeteo.js`)

Open-Meteo entrega `shortwave_radiation_sum` en MJ/m². Conversión:

```
yield_kWh_per_kWp ≈ (MJ/m² / 3.6) × 0.92
                  = kWh/m² × 0.92
```

Donde `0.92 ≈ tilt_gain (1.10) × performance_ratio (0.84)` para Perú con loss=14 %.
Esto hace ERA5 comparable directamente con PVGIS (kWh/kWp), no GHI raw.

### Fallback regional (`src/core/calibration.js`)

```js
FALLBACK_YIELD_BY_REGION = {
  costa: 2000, sierra: 2100, selva: 1400, unknown: 1700,
};
```

Valores anuales típicos calibrados a sistemas con tilt óptimo y losses estándar.
Se usan SOLO cuando PVGIS y ERA5 ambos fallan; **no llevan soiling adicional**
porque ya son anchored a "yield real esperado".

### Bug PVGIS hemisferio sur (`src/api/pvgis.js`)

PVGIS `optimalangles=1` retorna tilt 89–90° (panel vertical) para muchos puntos del
hemisferio sur peruano. Workaround:

```js
if (lat < 0) {
  url.searchParams.set('aspect', 180);          // norte facing
  url.searchParams.set('optimalinclination', 1); // solo optimiza tilt
} else {
  url.searchParams.set('aspect', 0);            // sur facing (norte hemisferio)
  url.searchParams.set('optimalinclination', 1);
}
```

### Anillo de horizonte (`src/core/shadows.js`)

`generateHorizonRing(centerLat, centerLng, radiusKm × 2.5, 12)` crea 12 puntos
alrededor del área para que `calcShadowScore` detecte cerros que están fuera de la
grilla pero al sur. Sin esto, una grilla 5 km × 5 km podría no ver un cerro al sur
a 8 km que bloquea el sol matinal en invierno andino.

### CV-redistribution de pesos (`src/core/weights.js`)

Si un factor tiene varianza relativa <5 % dentro de la grilla, el 80 % de su peso
se redistribuye proporcionalmente a los factores con varianza significativa. Esto
evita que sombras topográficas cuenten 25 % en una zona plana de selva donde
todos los puntos puntúan ~85.

```
discriminación = (max - min) / |center|
si discriminación < 0.05 → redistribuir 80% del peso
```
