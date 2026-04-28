/**
 * nasa-power.js
 * Cliente NASA POWER API — irradiancia + clearness index
 * Resolución: ~50 km | Sin API key | Especialmente útil para selva (nubosidad)
 * Docs: https://power.larc.nasa.gov/api/
 *
 * PENDIENTE DE INTEGRACIÓN
 *
 * Variables clave para selva peruana:
 *   ALLSKY_SFC_SW_DWN  — irradiancia global en superficie (W/m²)
 *   CLRSKY_SFC_SW_DWN  — irradiancia en cielo despejado (W/m²)
 *   ALLSKY_KT          — clearness index (0–1), ratio real/teórico
 *                        Bajo en selva lluviosa (~0.35), alto en costa (~0.65)
 *   T2M                — temperatura a 2m
 *   WS10M              — velocidad viento a 10m
 *   RH2M               — humedad relativa (proxy para punto de rocío)
 *
 * El clearness index (ALLSKY_KT) es el dato más valioso para selva:
 * permite comparar puntos por nubosidad histórica promedio, independiente
 * de la latitud. Un punto con KT=0.40 vs KT=0.45 en la misma zona
 * puede significar 12% más de energía generada anualmente.
 */

const NASA_POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/monthly/point';

/**
 * Obtiene clearness index y variables climáticas mensuales.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} startYear - ej. 2018
 * @param {number} endYear   - ej. 2023
 * @returns {Promise<{clearnessIndex: number[], irradiance: number[], source: string} | null>}
 */
export async function fetchNASAPower(lat, lng, startYear = 2018, endYear = 2023) {
  try {
    const params = new URLSearchParams({
      parameters: 'ALLSKY_SFC_SW_DWN,ALLSKY_KT,T2M,WS10M',
      community: 'RE',
      longitude: lng,
      latitude: lat,
      start: startYear,
      end: endYear,
      format: 'JSON'
    });

    const res = await fetch(`${NASA_POWER_BASE}?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const props = data?.properties?.parameter;
    if (!props) return null;

    // Promedio mensual multi-año de clearness index
    const kt = props.ALLSKY_KT;
    const irr = props.ALLSKY_SFC_SW_DWN;

    const monthlyKT = Array(12).fill(0).map((_, m) => {
      const key = String(m + 1).padStart(2, '0');
      const vals = Object.entries(kt)
        .filter(([k]) => k.endsWith(key))
        .map(([, v]) => v)
        .filter(v => v > 0);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b) / vals.length * 1000) / 1000 : null;
    });

    const monthlyIrr = Array(12).fill(0).map((_, m) => {
      const key = String(m + 1).padStart(2, '0');
      const vals = Object.entries(irr)
        .filter(([k]) => k.endsWith(key))
        .map(([, v]) => v)
        .filter(v => v > 0);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b) / vals.length * 10) / 10 : null;
    });

    return {
      clearnessIndex: monthlyKT,
      irradiance: monthlyIrr,
      source: 'NASA-POWER',
      resolution: '~50km',
      note: 'Clearness index útil para análisis de nubosidad en selva'
    };
  } catch (err) {
    console.warn('[NASA POWER] Error:', err.message);
    return null;
  }
}
