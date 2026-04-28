/**
 * grid.js
 * Generación de grilla uniforme de puntos sobre un área circular.
 *
 * La grilla es un bounding box cuadrado inscritto en el círculo de radio dado.
 * Para análisis en selva con terreno plano, una grilla regular es suficiente.
 * Para zonas andinas con topografía compleja, considerar grilla adaptativa
 * basada en varianza de elevación (TODO).
 */

/**
 * Genera una grilla N×N de puntos centrada en (lat, lng).
 *
 * @param {number} lat       - Latitud del centro
 * @param {number} lng       - Longitud del centro
 * @param {number} radiusKm  - Radio del área en kilómetros
 * @param {number} n         - Dimensión de la grilla (ej. 4 → 16 puntos)
 * @returns {{ lat: number, lng: number, row: number, col: number }[]}
 */
export function generateGrid(lat, lng, radiusKm, n) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const points = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const s = n === 1 ? 0.5 : j / (n - 1);
      points.push({
        lat: +(lat - dLat + 2 * dLat * t).toFixed(5),
        lng: +(lng - dLng + 2 * dLng * s).toFixed(5),
        row: i,
        col: j
      });
    }
  }
  return points;
}

/**
 * Separación real entre puntos vecinos de la grilla en metros.
 * Útil para validar si la resolución de la grilla tiene sentido
 * vs la resolución de la fuente de datos (~1km para PVGIS).
 *
 * @param {number} radiusKm
 * @param {number} n
 * @returns {number} Separación en metros
 */
export function gridSpacingMeters(radiusKm, n) {
  if (n <= 1) return radiusKm * 2 * 1000;
  return Math.round((radiusKm * 2 * 1000) / (n - 1));
}
