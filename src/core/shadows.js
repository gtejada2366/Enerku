/**
 * shadows.js
 * Cálculo de sombras topográficas y pendiente desde DEM.
 *
 * En el hemisferio sur, el sol se mueve por el norte.
 * Los obstáculos relevantes son los que están al SUR del punto —
 * pueden bloquear el sol en las horas centrales del día.
 *
 * Para selva peruana (latitud ~5°–15°S):
 * - El sol es casi cenital — ángulo de elevación solar al mediodía > 60°
 * - Las sombras topográficas importan menos que en los Andes
 * - La nubosidad domina → usar clearness index (NASA POWER) en su lugar
 *
 * Para Andes (latitud ~10°–18°S, altitud > 2500m):
 * - Ángulo solar más bajo en invierno (jun–ago)
 * - Cerros al sur pueden bloquear sol de mañana y tarde
 * - Este cálculo es crítico
 */

import { haversine } from './utils.js';

/**
 * Genera un anillo de puntos alrededor del centro del análisis para muestrear
 * el horizonte fuera de la grilla. Sin estos, las sombras topográficas solo
 * detectan obstáculos dentro del área analizada — un cerro a 2 km al sur
 * pasaría invisible.
 *
 * Los puntos generados NO tienen `row` ni `col`, así que `calcSlope` y
 * `calcAzimutScore` los ignoran automáticamente (sus filtros por row/col
 * fallan con NaN). Solo `calcShadowScore` los considera.
 *
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusKm - Distancia del anillo (recomendado: radio_grilla × 2.5)
 * @param {number} n - Número de puntos en el anillo (default 12)
 * @returns {{ lat: number, lng: number, horizon: true }[]}
 */
export function generateHorizonRing(centerLat, centerLng, radiusKm, n = 12) {
  const dLatPerKm = 1 / 111;
  const dLngPerKm = 1 / (111 * Math.cos(centerLat * Math.PI / 180));
  const ring = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    ring.push({
      lat: +(centerLat + radiusKm * dLatPerKm * Math.cos(angle)).toFixed(5),
      lng: +(centerLng + radiusKm * dLngPerKm * Math.sin(angle)).toFixed(5),
      horizon: true,
    });
  }
  return ring;
}

/**
 * Calcula score de sombra topográfica (0–100, mayor = menos sombra = mejor).
 *
 * Algoritmo:
 * 1. Busca todos los puntos de la grilla al sur del punto analizado
 * 2. Para cada uno calcula el ángulo de elevación del obstáculo
 *    ángulo = arctan(ΔElevación / distancia_horizontal)
 * 3. El ángulo máximo define cuántos grados de cielo sur están bloqueados
 * 4. Score = 100 - (ángulo_máximo * factor_penalización)
 *
 * @param {{ lat: number, lng: number, row: number, col: number }} pt
 * @param {{ lat: number, lng: number, row: number, col: number }[]} pts
 * @param {number[]} elevs - Elevaciones en metros (mismo orden que pts)
 * @returns {number} Score 0–100
 */
export function calcShadowScore(pt, pts, elevs) {
  const idx = pts.indexOf(pt);
  const myElev = elevs[idx];
  if (myElev == null || isNaN(myElev)) return 70; // sin elev → neutro pesimista

  const southPoints = pts.filter((p, i) => p.lat < pt.lat && i !== idx);
  if (!southPoints.length) return 85; // sin datos al sur = neutro

  let maxBlockAngle = 0;
  for (const sp of southPoints) {
    const si = pts.indexOf(sp);
    const sElev = elevs[si];
    if (sElev == null || isNaN(sElev)) continue; // sin elev del obstáculo → ignorar
    const dElev = sElev - myElev;
    if (dElev <= 0) continue; // obstáculo más bajo = no bloquea

    const distM = haversine(pt.lat, pt.lng, sp.lat, sp.lng) * 1000;
    const angle = Math.atan(dElev / Math.max(distM, 1)) * (180 / Math.PI);
    if (angle > maxBlockAngle) maxBlockAngle = angle;
  }

  // Penalización: cada grado de ángulo bloqueado = -8 puntos
  // Un cerro a 12° bloquea ~1.5h de sol al día en invierno andino
  const score = Math.max(0, Math.round(100 - maxBlockAngle * 8));
  return score;
}

/**
 * Calcula pendiente mínima en grados desde un punto hacia sus vecinos.
 * Menor pendiente = mejor para instalación de paneles.
 *
 * @param {{ row: number, col: number }} pt
 * @param {{ lat: number, lng: number, row: number, col: number }[]} pts
 * @param {number[]} elevs
 * @returns {number} Pendiente en grados (0 = plano)
 */
export function calcSlope(pt, pts, elevs) {
  const idx = pts.indexOf(pt);
  const myElev = elevs[idx];
  if (myElev == null || isNaN(myElev)) return 5; // default moderado si no hay elev

  const neighbors = pts.filter((p, i) =>
    Math.abs(p.row - pt.row) <= 1 &&
    Math.abs(p.col - pt.col) <= 1 &&
    i !== idx
  );

  if (!neighbors.length) return 0;

  const slopes = neighbors.map(n => {
    const ni = pts.indexOf(n);
    const ne = elevs[ni];
    if (ne == null || isNaN(ne)) return null; // vecino sin elev → ignorar
    const distM = haversine(pt.lat, pt.lng, n.lat, n.lng) * 1000;
    const dElev = Math.abs(ne - myElev);
    return distM > 0 ? Math.atan(dElev / distM) * (180 / Math.PI) : 0;
  }).filter(s => s !== null);

  if (!slopes.length) return 5;
  return Math.round(Math.min(...slopes) * 10) / 10;
}

/**
 * Score de orientación cardinal (0–100).
 * En hemisferio sur: terreno que desciende hacia el norte = cara norte libre = mejor.
 *
 * @param {{ lat: number, lng: number }} pt
 * @param {{ lat: number, lng: number, row: number, col: number }[]} pts
 * @param {number[]} elevs
 * @returns {number} Score 0–100
 */
export function calcAzimutScore(pt, pts, elevs) {
  const idx = pts.findIndex(p => p.lat === pt.lat && p.lng === pt.lng);
  const myElev = elevs?.[idx];
  if (myElev == null || isNaN(myElev)) return 50;

  const southPoints = pts.filter(p =>
    p.lat < pt.lat &&
    Math.abs(p.col - (pts[idx]?.col ?? 0)) <= 1
  );

  if (!southPoints.length) return 70;

  const si = pts.indexOf(southPoints[0]);
  const sElev = elevs[si];
  if (sElev == null || isNaN(sElev)) return 60; // sin dato → neutro

  if (sElev < myElev) return 100;       // terreno desciende al sur → cara norte libre
  if (sElev > myElev + 50) return 20;   // cerro significativo al sur
  return 60;                             // neutro
}
