/**
 * openmeteo.js
 * Cliente para Open-Meteo — histórico (ERA5-Land) y forecast en tiempo real
 * Resolución histórica: ~9 km | Forecast: ~13 km (GFS) | Sin API key
 * Docs: https://open-meteo.com/en/docs
 */

const OM_BASE = 'https://api.open-meteo.com/v1';

/**
 * Irradiancia histórica anual desde ERA5-Land.
 * Fallback cuando PVGIS no responde.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} m1 - Mes inicio (1–12)
 * @param {number} m2 - Mes fin (1–12)
 * @returns {Promise<{val: number, monthly: number[], source: string} | null>}
 */
export async function fetchHistorical(lat, lng, m1 = 1, m2 = 12) {
  try {
    // Usa el último año completo (ERA5-Land tiene latencia de ~3 meses)
    const year = new Date().getFullYear() - 1;
    const url = new URL(`${OM_BASE}/archive`);
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lng);
    url.searchParams.set('daily', 'shortwave_radiation_sum');
    url.searchParams.set('start_date', `${year}-01-01`);
    url.searchParams.set('end_date', `${year}-12-31`);
    url.searchParams.set('timezone', 'America/Lima');

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    const daily = data?.daily?.shortwave_radiation_sum;
    const times = data?.daily?.time;
    if (!daily || !times) return null;

    // Open-Meteo entrega shortwave_radiation_sum en MJ/m². Conversión:
    //   MJ/m² → kWh/m² (÷3.6, ya que 1 kWh = 3.6 MJ)
    // Y para que el resultado sea comparable a PVGIS (kWh/kWp/año, no kWh/m²),
    // aplicamos un factor de conversión típico para Perú:
    //   kWh/kWp ≈ GHI(kWh/m²) × 0.92
    // donde 0.92 ≈ ganancia por tilt óptimo (~+10 %) × performance ratio (~0.84,
    // con loss=14 %, igual al default de PVGIS).
    const GHI_TO_YIELD = 0.92;
    const monthly = Array(12).fill(0);
    times.forEach((t, i) => {
      const mo = parseInt(t.substring(5, 7)) - 1;
      monthly[mo] += ((daily[i] || 0) / 3.6) * GHI_TO_YIELD;
    });
    const avg = monthly.map(v => Math.round(v * 10) / 10);

    let total = 0;
    for (let i = m1 - 1; i < m2; i++) total += avg[i];

    return {
      val: Math.round(total * 10) / 10,
      monthly: avg,
      source: 'ERA5',
      resolution: '~9km',
      dataset: `ERA5-Land ${year}`
    };
  } catch (err) {
    console.warn('[OpenMeteo Historical] Error:', err.message);
    return null;
  }
}

/**
 * Velocidad de viento histórica horaria (10m y 100m) para un año completo.
 * Útil para cálculo de capacity factor eólico vía curva de potencia.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{
 *   wind10m: number[],          // 8760 valores en m/s
 *   wind100m: number[],
 *   meanWind10m: number,
 *   meanWind100m: number,
 *   year: number,
 *   source: string
 * } | null>}
 */
export async function fetchWindHistory(lat, lng) {
  try {
    const year = new Date().getFullYear() - 1;
    const url = new URL(`${OM_BASE}/archive`);
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lng);
    url.searchParams.set('hourly', 'wind_speed_10m,wind_speed_100m');
    url.searchParams.set('start_date', `${year}-01-01`);
    url.searchParams.set('end_date', `${year}-12-31`);
    url.searchParams.set('timezone', 'America/Lima');
    url.searchParams.set('wind_speed_unit', 'ms');

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const wind10m = data?.hourly?.wind_speed_10m;
    const wind100m = data?.hourly?.wind_speed_100m;
    if (!wind10m || !wind100m) return null;

    const valid10 = wind10m.filter(v => v != null && !isNaN(v));
    const valid100 = wind100m.filter(v => v != null && !isNaN(v));
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      wind10m,
      wind100m,
      meanWind10m: valid10.length ? Math.round(mean(valid10) * 100) / 100 : null,
      meanWind100m: valid100.length ? Math.round(mean(valid100) * 100) / 100 : null,
      year,
      source: 'ERA5-Land',
    };
  } catch (err) {
    console.warn('[Wind History] Error:', err.message);
    return null;
  }
}

/**
 * Condiciones actuales + pronóstico 7 días.
 * Variables: temperatura, viento, punto de rocío, radiación instantánea.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object | null>}
 */
export async function fetchForecast(lat, lng) {
  try {
    const url = new URL(`${OM_BASE}/forecast`);
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lng);
    url.searchParams.set('current', [
      'temperature_2m',
      'wind_speed_10m',
      'dew_point_2m',
      'shortwave_radiation'
    ].join(','));
    url.searchParams.set('daily', [
      'shortwave_radiation_sum',
      'temperature_2m_max',
      'temperature_2m_min'
    ].join(','));
    url.searchParams.set('timezone', 'America/Lima');
    url.searchParams.set('forecast_days', 7);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    return await res.json();
  } catch (err) {
    console.warn('[OpenMeteo Forecast] Error:', err.message);
    return null;
  }
}
