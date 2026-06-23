'use strict';

// Helpers para limpiar valores que vienen del Excel del COES.

// Convierte string "1,234.56" / "1.234,56" / "1234.56" / number → Number | null
function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === '' || s === '-' || s === 'n.d.' || s === 'N.D.' || s === '—') return null;

  // Si tiene coma decimal estilo "1.234,56" → quitar puntos, cambiar coma por punto
  const hasCommaDecimal = /,\d{1,3}$/.test(s) && !/\.\d{1,3}$/.test(s);
  if (hasCommaDecimal) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Estilo "1,234.56" → quitar comas de miles
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Normaliza nombres de central / barra: trim, colapsa espacios, uppercase
function normName(s) {
  if (!s) return null;
  return String(s)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u00A0]/g, ' ')
    .trim();
}

// Detecta el tipo de central a partir del nombre o columna 'tipo'
function detectTipoCentral(nombre, tipoCol) {
  const src = `${nombre || ''} ${tipoCol || ''}`.toUpperCase();
  if (/HIDR|H\.|CH\s|C\.H\./.test(src)) return 'hidro';
  if (/SOLAR|FOTOV|FV/.test(src)) return 'solar';
  if (/EOLIC|VIENTO|EOLO/.test(src)) return 'eolico';
  if (/BESS|BATER/.test(src)) return 'bess';
  if (/TG|TV|CICLO|GAS|DIESEL|RESIDUAL|CARBON|BIOMASA|TERMO/.test(src)) return 'termo';
  return null;
}

// SHA256 de un Buffer → hex string. Sin deps.
function sha256(buf) {
  const { createHash } = require('crypto');
  return createHash('sha256').update(buf).digest('hex');
}

module.exports = { parseNumber, normName, detectTipoCentral, sha256 };
