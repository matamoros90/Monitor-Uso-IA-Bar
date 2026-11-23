'use strict';
// Claude: conserva la sesión y el método del proyecto original. Los endpoints
// de claude.ai no son una API pública y pueden cambiar.
const { parseTs } = require('./usage');
class NoSession extends Error {
  constructor(message = 'sin sesión') { super(message); this.name = 'NoSession'; }
}
async function getJson(fetchFn, url) {
  let response;
  try { response = await fetchFn(url, { headers: { accept: 'application/json' }, credentials: 'include', signal: AbortSignal.timeout(15000) }); }
  catch (_) { throw new Error('sin conexión'); }
  if (response.status === 401 || response.status === 403) throw new NoSession();
  if (!response.ok) throw new Error('HTTP ' + response.status);
  try { return JSON.parse(await response.text()); }
  catch (_) { throw new NoSession('respuesta inesperada'); }
}
const names = { five_hour: 'Sesión 5h', seven_day: 'Semana', seven_day_opus: 'Semana Opus', seven_day_sonnet: 'Semana Sonnet', seven_day_oauth_apps: 'Semana apps' };
function parseClaudeUsage(data) {
  const keys = [...Object.keys(names), ...Object.keys(data || {}).filter(k => !(k in names) && k !== 'extra_usage')];
  const windows = [];
  for (const key of keys) {
    const value = data?.[key];
    if (value && typeof value === 'object' && value.utilization != null && Number.isFinite(Number(value.utilization)))
      windows.push({ etq: names[key] || key.replace(/_/g, ' '), pct: Number(value.utilization), reset: parseTs(value.resets_at) });
  }
  const extra = data?.extra_usage;
  if (extra && extra.is_enabled && extra.utilization != null && Number.isFinite(Number(extra.utilization)))
    windows.push({ etq: 'Uso extra', pct: Number(extra.utilization), reset: null });
  return windows;
}
async function claudeLimits(ses) {
  const fetch = (url, options) => ses.fetch(url, options);
  const orgs = await getJson(fetch, 'https://claude.ai/api/organizations');
  if (!Array.isArray(orgs) || !orgs.length) throw new NoSession();
  const org = orgs.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) || orgs[0];
  if (!org || !org.uuid) throw new Error('la cuenta no reporta organización');
  const raw = await getJson(fetch, `https://claude.ai/api/organizations/${encodeURIComponent(org.uuid)}/usage`);
  const ventanas = parseClaudeUsage(raw);
  if (!ventanas.length) throw new Error('la cuenta no reporta límites');
  return { ventanas, source: 'Cuenta conectada' };
}
module.exports = { NoSession, parseClaudeUsage, claudeLimits };
