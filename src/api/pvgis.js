/**
 * pvgis.js
 * Cliente para PVGIS v5.2 (Joint Research Centre / EU Commission)
 * Resolución: ~1 km | Dataset: SARAH-3 (Meteosat) | Sin API key
 * Docs: https://re.jrc.ec.europa.eu/api/v5_2/
 *
 * Devuelve E_m: energía mensual en kWh por kWp instalado (NO kWh/m²),
 * ya con pérdidas aplicadas (default loss=14 %).
 */

const PVGIS_BASE = 'https://re.jrc.ec.europa.eu/api/v5_2';

// PVGIS no envía headers CORS, así que browsers bloquean fetch directo.
// Routear por proxies públicos mantiene el modelo 100% client-side sin
// necesitar infraestructura propia. Latencia ~200–600 ms por request.
//
// Estrategia de redundancia: probamos allorigins.win primero (rápido pero
// con throttling intermitente), luego cors.eu.org (más estable pero a
// veces lento). Si ambos fallan, fetchPVGIS devuelve null y el orquestador
// cae a ERA5 (Open-Meteo, que sí tiene CORS).
const CORS_PROXIES = [
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
  url => 'https://cors.eu.org/' + url,
];

/**
 * Obtiene yield PV mensual y total para una coordenada.
 *
 * @param {number} lat - Latitud decimal
 * @param {number} lng - Longitud decimal
 * @param {number} m1  - Mes inicio del período (1–12)
 * @param {number} m2  - Mes fin del período (1–12)
 * @param {object} [opts]
 * @param {number} [opts.angle]   - Tilt manual (°). Si se omite, PVGIS optimiza.
 * @param {number} [opts.aspect]  - Azimut manual (°, 0=sur, 90=oeste). Si se omite, PVGIS optimiza.
 * @param {number} [opts.loss=14] - Pérdidas del sistema (%). Default PVGIS = 14 %.
 *                                  Para costa peruana con aerosoles marinos
 *                                  recomendado 20–22 %.
 * @returns {Promise<{val: number, monthly: number[], source: string, tilt: number, aspect: number, loss: number} | null>}
 */
export async function fetchPVGIS(lat, lng, m1 = 1, m2 = 12, opts = {}) {
  try {
    const url = new URL(`${PVGIS_BASE}/PVcalc`);
    url.searchParams.set('lat', lat);
    url.searchParams.set('lon', lng);
    url.searchParams.set('peakpower', 1);
    url.searchParams.set('loss', opts.loss ?? 14);
    url.searchParams.set('outputformat', 'json');
    url.searchParams.set('browser', 0);

    const hasAngle = opts.angle != null && !isNaN(opts.angle);
    const hasAspect = opts.aspect != null && !isNaN(opts.aspect);

    if (hasAngle) url.searchParams.set('angle', opts.angle);
    if (hasAspect) url.searchParams.set('aspect', opts.aspect);

    // Si el usuario no especifica tilt ni azimut → optimizar.
    //
    // BUG conocido: PVGIS `optimalangles=1` puede devolver tilt 89–90°
    // (panel vertical) y yields ~50 % más bajos para varios puntos del
    // hemisferio sur (validado en Lima, Yurimaguas, Pucallpa, Satipo).
    //
    // Workaround: fijar aspect según hemisferio (0=sur en N, 180=norte
    // en S) y optimizar SOLO la inclinación. Comportamiento equivalente
    // al esperado pero sin el bug del optimizador.
    if (!hasAngle && !hasAspect) {
      url.searchParams.set('aspect', lat < 0 ? 180 : 0);
      url.searchParams.set('optimalinclination', 1);
    } else if (!hasAngle) {
      url.searchParams.set('optimalinclination', 1);
    }

    // Probar cada proxy en secuencia hasta que uno funcione
    let data = null;
    const target = url.toString();
    for (const buildProxy of CORS_PROXIES) {
      try {
        const res = await fetch(buildProxy(target));
        if (!res.ok) continue;
        data = await res.json();
        if (data && data.outputs) break;
        data = null;
      } catch { /* probar el siguiente */ }
    }
    if (!data) return null;
    const months = data?.outputs?.monthly?.fixed;
    if (!months || months.length !== 12) return null;

    const monthly = months.map(m => Math.round((m.E_m || 0) * 10) / 10);

    let total = 0;
    for (let i = m1 - 1; i < m2; i++) total += monthly[i] || 0;

    // Tilt y aspect efectivos (vienen en data.inputs.mounting_system.fixed)
    const inputs = data?.inputs?.mounting_system?.fixed;
    const tilt = inputs?.slope?.value ?? opts.angle ?? null;
    const aspect = inputs?.azimuth?.value ?? opts.aspect ?? null;

    return {
      val: Math.round(total * 10) / 10,
      monthly,
      source: 'PVGIS',
      resolution: '~1km',
      dataset: 'SARAH-3',
      tilt,
      aspect,
      loss: opts.loss ?? 14,
    };
  } catch (err) {
    console.warn('[PVGIS] Error:', err.message);
    return null;
  }
}
