'use strict';
const { app, Tray, BrowserWindow, nativeImage, ipcMain, session, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const P = require('./providers');
const { snapshot } = require('./panel-state');
const { CodexClient, CodexError } = require('./codex-client');

const DEMO = process.env.MEDIDOR_DEMO === '1';
if (DEMO) app.setPath('userData', path.join(app.getPath('temp'), 'medidor-demo-' + process.pid));
if (!app.requestSingleInstanceLock()) app.quit();
if (app.dock) app.dock.hide();
app.on('window-all-closed', () => {});

const UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const REFRESH_MS = 5 * 60 * 1000;
const state = { refreshing: false, claude: { status: 'init' }, gpt: { status: 'init' } };
let tray = null;
let panelWin = null;
let claudeLoginWindow = null;
let codex = null;
let codexLoginId = null;
let codexStartingLogin = false;
let codexLoginTimer = null;
let codexRevision = 0;
let codexBeforeLogin = null;
let demoSettings = { abrirAlIniciar: false };
const userFile = name => path.join(app.getPath('userData'), name);
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJson(file, data) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 }); return true; }
  catch (_) { return false; }
}
const msg = e => e && e.message ? e.message : String(e);
function rebuild() {
  if (tray) tray.setTitle('IA');
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('panel:update', snapshot(state));
}

// Existing Claude session stays in the same Electron partition as before.
function claudeSession() {
  const s = session.fromPartition('persist:medidor-claude');
  s.setUserAgent(UA);
  return s;
}
async function refreshClaude() {
  const previous = state.claude;
  try { state.claude = { status: 'ok', data: await P.claudeLimits(claudeSession()), t: Date.now() }; }
  catch (e) {
    state.claude = e instanceof P.NoSession ? { status: 'nosession' } : { status: 'error', err: msg(e), data: previous.data, t: previous.t };
  }
}
function openClaudeLogin() {
  if (claudeLoginWindow && !claudeLoginWindow.isDestroyed()) { claudeLoginWindow.focus(); return; }
  const win = new BrowserWindow({ width: 520, height: 780, title: 'Iniciar sesión en Claude',
    webPreferences: { partition: 'persist:medidor-claude', contextIsolation: true, sandbox: true, nodeIntegration: false } });
  claudeLoginWindow = win;
  win.webContents.setUserAgent(UA);
  win.loadURL('https://claude.ai/login');
  app.focus({ steal: true });
  const timer = setInterval(async () => {
    await refreshClaude(); rebuild();
    if (state.claude.status === 'ok' && !win.isDestroyed()) win.close();
  }, 4000);
  win.on('closed', () => { clearInterval(timer); claudeLoginWindow = null; refresh(); });
}

// ChatGPT uses the official Codex app-server in an isolated local profile.
// The separate profile prevents changing the user's existing Codex login.
async function refreshCodex() {
  if (codexStartingLogin || codexLoginId) return;
  const revision = codexRevision;
  const previous = state.gpt;
  try {
    const data = await codex.limits();
    if (revision === codexRevision) state.gpt = { status: 'ok', data, t: Date.now() };
  } catch (e) {
    if (revision !== codexRevision) return;
    state.gpt = e instanceof CodexError && e.code === 'nosession'
      ? { status: 'nosession' }
      : { status: 'error', err: msg(e), data: previous.data, t: previous.t };
  }
}
async function startCodexLogin() {
  if (codexStartingLogin || codexLoginId) return;
  codexStartingLogin = true; const revision = ++codexRevision;
  const previous = state.gpt;
  codexBeforeLogin = previous;
  state.gpt = { status: 'connecting', data: previous.data, t: previous.t }; rebuild();
  try {
    const login = await codex.beginLogin();
    if (revision !== codexRevision) { await codex.cancelLogin(login.loginId); return; }
    codexLoginId = login.loginId;
    codexStartingLogin = false;
    codexLoginTimer = setTimeout(async () => {
      const id = codexLoginId; codexLoginId = null; codexRevision++;
      if (id) await codex.cancelLogin(id);
      codexBeforeLogin = null;
      state.gpt = { status: 'error', err: 'El acceso tardó demasiado. Inténtalo de nuevo.' }; rebuild();
    }, 5 * 60 * 1000);
    await shell.openExternal(login.authUrl);
  } catch (e) {
    if (revision !== codexRevision) return;
    if (codexLoginId) await codex.cancelLogin(codexLoginId);
    codexLoginId = null; codexStartingLogin = false; clearTimeout(codexLoginTimer); codexRevision++;
    codexBeforeLogin = null;
    state.gpt = { status: 'error', err: e.code === 'missing' ? msg(e) : 'No se pudo iniciar el acceso en el navegador. Inténtalo de nuevo.', data: previous.data, t: previous.t };
    rebuild();
  }
}
async function finishCodexLogin(event) {
  if (!codexLoginId || event.loginId !== codexLoginId) return;
  clearTimeout(codexLoginTimer); codexLoginId = null; codexBeforeLogin = null; codexRevision++;
  if (!event.success) { state.gpt = { status: 'error', err: 'No se completó el acceso. Inténtalo de nuevo.' }; rebuild(); return; }
  state.gpt = { status: 'init' }; rebuild();
  await refreshCodex(); rebuild();
}
async function cancelCodexLogin() {
  const id = codexLoginId;
  codexLoginId = null; codexStartingLogin = false; codexRevision++; clearTimeout(codexLoginTimer);
  state.gpt = codexBeforeLogin || { status: 'nosession' }; codexBeforeLogin = null;
  rebuild();
  if (id) await codex.cancelLogin(id);
}
async function logout(provider) {
  if (provider === 'claude') {
    const s = claudeSession(); await s.clearStorageData(); await s.clearCache();
    state.claude = { status: 'nosession' };
  } else if (provider === 'chatgpt') {
    codexRevision++;
    if (codexLoginId) await codex.cancelLogin(codexLoginId);
    codexLoginId = null; clearTimeout(codexLoginTimer);
    await codex.logout(); state.gpt = { status: 'nosession' };
  }
  rebuild();
}
async function refresh() {
  if (state.refreshing || DEMO) return;
  state.refreshing = true; rebuild();
  await Promise.allSettled([refreshClaude().then(rebuild), refreshCodex().then(rebuild)]);
  state.refreshing = false; rebuild();
}

function createPanel() {
  const availableHeight = screen.getPrimaryDisplay().workArea.height;
  panelWin = new BrowserWindow({ width: 414, height: Math.min(710, Math.max(500, availableHeight - 16)),
    show: false, frame: false, resizable: false, movable: false, fullscreenable: false, skipTaskbar: true,
    transparent: true, vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true,
    webPreferences: { preload: path.join(__dirname, 'panel-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  panelWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panelWin.webContents.on('will-navigate', event => event.preventDefault());
  panelWin.on('blur', () => { if (panelWin && !panelWin.isDestroyed()) panelWin.hide(); });
  panelWin.on('closed', () => { panelWin = null; });
  panelWin.loadFile(path.join(__dirname, 'panel.html'));
}
function showPanel() {
  if (!panelWin || panelWin.isDestroyed()) createPanel();
  const bounds = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: Math.round(bounds.x), y: Math.round(bounds.y) }).workArea;
  const [w, h] = panelWin.getSize();
  panelWin.setPosition(Math.max(area.x + 6, Math.min(Math.round(bounds.x + bounds.width / 2 - w / 2), area.x + area.width - w - 6)),
    Math.max(area.y, Math.min(Math.round(bounds.y + bounds.height + 5), area.y + area.height - h)), false);
  panelWin.show(); panelWin.focus(); panelWin.webContents.send('panel:update', snapshot(state));
}
function togglePanel() {
  if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) { panelWin.hide(); return; }
  showPanel();
}
function navigate(page) {
  showPanel(); const target = panelWin;
  const send = () => { if (target && !target.isDestroyed()) target.webContents.send('panel:navigate', page); };
  if (target.webContents.isLoadingMainFrame()) target.webContents.once('did-finish-load', send); else send();
}
function fromPanel(e) { return panelWin && !panelWin.isDestroyed() && e.sender.id === panelWin.webContents.id; }
ipcMain.handle('panel:read', e => fromPanel(e) ? snapshot(state) : null);
ipcMain.handle('panel:action', async (e, action) => {
  if (!fromPanel(e) || typeof action !== 'string') return false;
  try {
    switch (action) {
      case 'refresh': await refresh(); return true;
      case 'settings': navigate('settings'); return true;
      case 'accounts': navigate('accounts'); return true;
      case 'login-claude': if (!DEMO) { panelWin.hide(); openClaudeLogin(); } return true;
      case 'login-chatgpt': if (!DEMO) await startCodexLogin(); return true;
      case 'cancel-chatgpt': if (!DEMO) await cancelCodexLogin(); else { state.gpt = { status: 'nosession' }; rebuild(); } return true;
      case 'logout-claude': if (!DEMO) await logout('claude'); else state.claude = { status: 'nosession' }; rebuild(); return true;
      case 'logout-chatgpt': if (!DEMO) await logout('chatgpt'); else state.gpt = { status: 'nosession' }; rebuild(); return true;
      case 'claude-website': await shell.openExternal('https://claude.ai/settings/usage'); return true;
      case 'quit': app.quit(); return true;
      default: return false;
    }
  } catch (_) { return false; }
});
ipcMain.handle('panel:settings-read', e => {
  if (!fromPanel(e)) return null;
  return { abrirAlIniciar: DEMO ? demoSettings.abrirAlIniciar : app.getLoginItemSettings().openAtLogin, version: app.getVersion() };
});
ipcMain.handle('panel:settings-save', (e, d) => {
  if (!fromPanel(e) || !d || typeof d.abrirAlIniciar !== 'boolean') return { ok: false, error: 'Revisa los datos de configuración.' };
  if (DEMO) { demoSettings.abrirAlIniciar = d.abrirAlIniciar; return { ok: true }; }
  try { app.setLoginItemSettings({ openAtLogin: d.abrirAlIniciar }); }
  catch (_) { return { ok: false, error: 'No se pudo cambiar el inicio automático.' }; }
  const cfg = readJson(userFile('config.json'), {}); cfg.abrirAlIniciar = d.abrirAlIniciar;
  if (!writeJson(userFile('config.json'), cfg)) return { ok: false, error: 'No se pudieron guardar los ajustes.' };
  return { ok: true };
});

app.whenReady().then(async () => {
  if (DEMO) {
    const now = Date.now();
    state.claude = { status: 'ok', t: now, data: { ventanas: [
      { etq: 'Sesión de 5 horas', pct: 32, reset: now / 1000 + 9800 }, { etq: 'Límite semanal', pct: 58, reset: now / 1000 + 230000 }] } };
    state.gpt = { status: 'nosession' };
  } else {
    codex = new CodexClient({ home: userFile('codex-medidor'), userHome: app.getPath('home') });
    codex.on('loginCompleted', finishCodexLogin);
    codex.on('closed', () => {
      if (codexLoginId || codexStartingLogin) {
        codexLoginId = null; codexStartingLogin = false; clearTimeout(codexLoginTimer); codexRevision++;
        state.gpt = { status: 'error', err: 'Se interrumpió la conexión con Codex.' }; rebuild();
      }
    });
  }
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('IA · uso de Claude y ChatGPT'); tray.setTitle('IA');
  tray.on('click', togglePanel);
  // Both mouse buttons open the same panel; no legacy menu with estimates.
  tray.on('right-click', togglePanel);
  createPanel(); rebuild();
  if (DEMO) { setTimeout(togglePanel, 300); return; }
  await refresh(); setInterval(refresh, REFRESH_MS);
});
app.on('before-quit', () => { clearTimeout(codexLoginTimer); if (codex) codex.close(); });
process.on('unhandledRejection', () => {});
