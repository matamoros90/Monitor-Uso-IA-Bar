'use strict';
// A single representation drives the visible number, bar and accessibility.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MedidorPresentation = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function presentWindow(used, provider, stale = false) {
    if (used == null || !Number.isFinite(Number(used))) return null;
    const normalized = Math.max(0, Math.min(100, Number(used)));
    const remaining = Math.round(100 - normalized);
    const value = provider === 'chatgpt' ? remaining : Math.round(normalized);
    const kind = provider === 'chatgpt' ? 'restante' : 'usado';
    const level = stale ? 'stale' : remaining >= 50 ? 'good' : remaining >= 20 ? 'warning' : 'low';
    const status = { good: 'Disponible', warning: 'Atención', low: 'Cerca del límite', stale: 'Dato anterior' }[level];
    return { value, remaining, kind, level, status };
  }
  function isStale(info, now = Date.now()) {
    if (!info || !Array.isArray(info.windows) || !info.windows.length) return false;
    return !!info.stale || !info.updatedAt || now - info.updatedAt > 15 * 60 * 1000 ||
      info.windows.some(w => w.reset != null && w.reset * 1000 <= now);
  }
  function resetText(sec, now = Date.now()) {
    if (!sec) return 'Sin hora de reinicio';
    const remaining = sec * 1000 - now;
    if (remaining <= 0) return 'Reinicio previsto ya pasó · actualiza';
    const minutes = Math.ceil(remaining / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    const relative = days ? `${days} d ${hours} h` : hours ? `${hours} h ${mins} min` : `${mins} min`;
    const exact = new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(sec * 1000));
    return `Se restablece en ${relative} · ${exact}`;
  }
  return { presentWindow, isStale, resetText };
});
