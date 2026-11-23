'use strict';
// Normaliza los intervalos declarados por los proveedores; nunca infiere uso.
function etiquetaVentana(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return 'Límite';
  if (Math.abs(m - 300) < 1) return 'Sesión 5h';
  if (Math.abs(m - 10080) < 1) return 'Semana';
  return m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
function parseTs(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t / 1000;
}
module.exports = { etiquetaVentana, parseTs };
