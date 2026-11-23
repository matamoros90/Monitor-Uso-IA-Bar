'use strict';
const cards = document.getElementById('cards');
let lastState = null;
const node = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
function age(ts) {
  if (!ts) return 'Sin actualización';
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return 'Actualizado ahora';
  if (mins < 60) return `Actualizado hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `Actualizado hace ${hrs} h` : `Actualizado hace ${Math.floor(hrs / 24)} d`;
}
function renderCard(info, kind) {
  const stale = MedidorPresentation.isStale(info);
  const card = node('article', `card ${kind}`);
  const head = node('div', 'card-head');
  const title = node('div', 'card-title');
  title.append(node('span', 'provider-icon', kind === 'claude' ? '✳' : '◉'));
  const identity = node('div');
  identity.append(node('div', 'provider-name', info.name));
  identity.append(node('div', 'provider-sub', kind === 'claude' ? 'Uso de tu cuenta' : 'ChatGPT · límites de Codex / Work'));
  title.append(identity);
  const badgeText = info.status === 'connecting' ? 'Conectando' : info.windows.length ? (stale ? 'Dato anterior' : 'Conectado') : (info.status === 'init' ? 'Cargando' : info.status === 'error' ? 'Sin datos' : 'Sin conectar');
  const badgeClass = info.windows.length ? (stale ? 'warning' : '') : (info.status === 'error' ? 'warning' : 'muted');
  head.append(title, node('span', `badge ${badgeClass}`, badgeText));
  card.append(head);
  if (!info.windows.length) {
    card.append(node('p', 'empty', info.status === 'connecting' ? 'Completa el inicio de sesión en tu navegador y vuelve a Medidor.' : info.status === 'init' ? 'Buscando datos disponibles…' : info.status === 'error' ? `No se pudieron consultar los límites${info.error ? ': ' + info.error : '.'}` : 'Conecta tu cuenta para consultar los límites disponibles.'));
  } else {
    const limits = node('div', 'limits');
    for (const w of info.windows) {
      const presentation = MedidorPresentation.presentWindow(w.used, kind, stale);
      if (!presentation) continue;
      const group = node('div', `limit level-${presentation.level}`);
      const top = node('div', 'row-top');
      top.append(node('span', 'label', w.label), node('span', 'pct', `${presentation.value}% ${presentation.kind}`));
      const track = node('div', 'track');
      track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', `${info.name} ${w.label} ${presentation.kind}`);
      track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(presentation.value));
      track.setAttribute('aria-valuetext', `${presentation.value}% ${presentation.kind}; ${presentation.status}`);
      const fill = node('div', 'fill'); fill.style.width = `${presentation.value}%`; track.append(fill);
      const details = node('div', 'limit-details');
      details.append(node('span', 'reset', MedidorPresentation.resetText(w.reset)), node('span', 'limit-status', presentation.status));
      group.append(top, track, details); limits.append(group);
    }
    card.append(limits);
  }
  const bottom = node('div', 'card-bottom');
  const origin = info.windows.length ? `${info.source} · ${age(info.updatedAt)}` : 'Sin datos disponibles';
  bottom.append(node('span', '', origin));
  const action = node('button', 'action', info.status === 'connecting' ? 'En curso' : info.status === 'ok' && !info.fallback ? 'Cuenta' : 'Conectar');
  action.disabled = info.status === 'connecting';
  action.type = 'button'; action.addEventListener('click', () => window.medidorPanel.act(info.status === 'ok' && !info.fallback ? 'accounts' : (kind === 'claude' ? 'login-claude' : 'login-chatgpt')));
  bottom.append(action); card.append(bottom);
  return card;
}
function render(state) {
  if (!state || !state.claude || !state.chatgpt) return;
  lastState = state;
  cards.replaceChildren(renderCard(state.claude, 'claude'), renderCard(state.chatgpt, 'chatgpt'));
  renderAccounts(state);
  document.getElementById('refresh').disabled = state.refreshing;
  const updated = Math.max(state.claude.updatedAt || 0, state.chatgpt.updatedAt || 0);
  document.getElementById('last-check').textContent = state.refreshing ? 'Actualizando…' : updated ? age(updated) : 'Sin datos consultados';
}
const byId = id => document.getElementById(id);
let currentPage = 'home';
let settingsLoaded = false;
let settingsRequest = 0;
function showPage(page) {
  currentPage = page;
  for (const name of ['home', 'settings', 'accounts', 'about']) byId(`${name}-view`).hidden = name !== page;
  document.title = page === 'home' ? 'Medidor' : page === 'settings' ? 'Configuración de Medidor' : page === 'accounts' ? 'Tus cuentas' : 'Acerca de Medidor';
  if (page === 'settings') byId('settings-back').focus();
  if (page === 'about') byId('about-back').focus();
  if (page === 'accounts') byId('accounts-back').focus();
  if (page === 'home') byId('settings').focus();
}
async function openSettings(reload = true) {
  showPage('settings');
  if (!reload && settingsLoaded) return;
  const request = ++settingsRequest;
  settingsLoaded = false;
  byId('settings-error').hidden = true;
  byId('settings-save').disabled = true;
  try {
    const s = await window.medidorPanel.settingsRead();
    if (request !== settingsRequest) return;
    if (!s) throw new Error('No fue posible leer los ajustes.');
    byId('launch').checked = !!s.abrirAlIniciar;
    byId('about-version').textContent = 'Versión ' + (s.version || '—');
    settingsLoaded = true;
  } catch (_) {
    byId('settings-error').textContent = 'No se pudo cargar la configuración. Inténtalo de nuevo.';
    byId('settings-error').hidden = false;
  } finally {
    if (request === settingsRequest) byId('settings-save').disabled = !settingsLoaded;
  }
}
function goHome() {
  settingsRequest++;
  settingsLoaded = false;
  byId('claude-confirm').hidden = true;
  byId('chatgpt-confirm').hidden = true;
  showPage('home');
}
byId('settings').addEventListener('click', () => openSettings());
byId('settings-back').addEventListener('click', goHome);
byId('about-open').addEventListener('click', () => showPage('about'));
byId('about-back').addEventListener('click', () => openSettings(false));
byId('about-done').addEventListener('click', () => openSettings(false));
byId('settings-save').addEventListener('click', async () => {
  if (!settingsLoaded) return;
  const button = byId('settings-save');
  button.disabled = true;
  byId('settings-error').hidden = true;
  try {
    const result = await window.medidorPanel.settingsSave({
      abrirAlIniciar: byId('launch').checked,
    });
    if (!result || !result.ok) throw new Error(result?.error || 'No se pudieron guardar los cambios.');
    goHome();
  } catch (e) {
    byId('settings-error').textContent = e.message || 'No se pudieron guardar los cambios.';
    byId('settings-error').hidden = false;
  } finally { button.disabled = false; }
});
function renderAccounts(state) {
  for (const [name, info] of [['claude', state.claude], ['chatgpt', state.chatgpt]]) {
    const label = byId(`account-${name}-state`);
    const button = byId(`account-${name}`);
    const connected = info.status === 'ok' && !info.fallback;
    label.textContent = info.status === 'connecting' ? 'Completa el acceso en tu navegador' : connected ? 'Conectada' : info.status === 'error' ? (info.error || 'No disponible') : 'Sin conectar';
    button.textContent = info.status === 'connecting' ? 'Cancelar' : connected ? 'Desconectar' : 'Conectar';
    button.disabled = info.status === 'init';
    button.dataset.connected = connected ? 'yes' : 'no';
    button.dataset.connecting = info.status === 'connecting' ? 'yes' : 'no';
    if (!connected) byId(`${name}-confirm`).hidden = true;
  }
}
for (const name of ['claude', 'chatgpt']) {
  byId(`account-${name}`).addEventListener('click', async () => {
    byId('accounts-error').hidden = true;
    if (name === 'chatgpt' && byId(`account-${name}`).dataset.connecting === 'yes') { await window.medidorPanel.act('cancel-chatgpt'); return; }
    if (byId(`account-${name}`).dataset.connected === 'yes') { byId(`${name}-confirm`).hidden = false; return; }
    const ok = await window.medidorPanel.act(`login-${name}`);
    if (!ok) { byId('accounts-error').textContent = 'No se pudo abrir la conexión. Inténtalo de nuevo.'; byId('accounts-error').hidden = false; }
  });
  byId(`${name}-cancel`).addEventListener('click', () => { byId(`${name}-confirm`).hidden = true; });
  byId(`${name}-logout`).addEventListener('click', async () => {
    const ok = await window.medidorPanel.act(`logout-${name}`);
    if (!ok) { byId('accounts-error').textContent = 'No se pudo cerrar la sesión. Inténtalo de nuevo.'; byId('accounts-error').hidden = false; }
    byId(`${name}-confirm`).hidden = true;
  });
}
byId('accounts-back').addEventListener('click', goHome);
byId('claude-website').addEventListener('click', () => window.medidorPanel.act('claude-website'));
window.medidorPanel.onNavigate(page => { if (page === 'settings') openSettings(); else if (page === 'accounts') { byId('accounts-error').hidden = true; showPage('accounts'); } });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (currentPage === 'about') openSettings(false);
  else if (currentPage === 'settings' || currentPage === 'accounts') goHome();
});
for (const [id, action] of [['refresh','refresh'],['accounts','accounts'],['quit','quit']]) {
  document.getElementById(id).addEventListener('click', () => window.medidorPanel.act(action));
}
window.medidorPanel.onUpdate(render);
window.medidorPanel.read().then(render).catch(() => { document.getElementById('last-check').textContent = 'No se pudo cargar el panel'; });
setInterval(() => { if (lastState) render(lastState); }, 60000);
