'use strict';
// Los datos enviados a la vista nunca incluyen cookies, claves, respuestas
// completas de proveedores, nombres de proyectos ni direcciones de correo.
function safeWindow(v) {
  if (!v || v.pct == null || !Number.isFinite(Number(v.pct))) return null;
  const reset = Number(v.reset);
  return {
    label: String(v.etq || 'Límite').slice(0, 80),
    used: Math.max(0, Math.min(100, Number(v.pct))),
    reset: Number.isFinite(reset) && reset > 0 ? reset : null,
  };
}
function provider(s, name, now) {
  s = s || { status: 'init' };
  const current = s.data && Array.isArray(s.data.ventanas) && s.data.ventanas.length ? s.data : null;
  const data = current;
  const ts = Number(s.t);
  const windows = data ? (data.ventanas || []).map(safeWindow).filter(Boolean) : [];
  const resetExpired = windows.some(w => w.reset && w.reset * 1000 <= now);
  const stale = !!windows.length && (!Number.isFinite(ts) || ts <= 0 || now - ts > 15 * 60 * 1000 || resetExpired || s.status !== 'ok');
  return {
    name, status: String(s.status || 'init'),
    windows, updatedAt: Number.isFinite(ts) && ts > 0 ? ts : null, stale,
    source: data && data.source ? String(data.source).slice(0, 80) : 'Cuenta conectada',
    fallback: false,
    plan: data && data.plan ? String(data.plan).slice(0, 30) : null,
    error: s.status === 'error' && s.err ? String(s.err).slice(0, 160) : null,
  };
}
function snapshot(state, now = Date.now()) {
  return {
    refreshing: !!state.refreshing,
    claude: provider(state.claude, 'Claude', now),
    chatgpt: provider(state.gpt, 'ChatGPT', now),
  };
}
module.exports = { snapshot, safeWindow };
