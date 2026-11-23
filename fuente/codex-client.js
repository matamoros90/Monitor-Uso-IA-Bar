'use strict';
// Codex app-server handles OAuth and account data. Medidor never reads or
// copies ChatGPT cookies, auth.json, API keys or bearer tokens.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { etiquetaVentana } = require('./usage');

class CodexError extends Error {
  constructor(code, message) { super(message); this.name = 'CodexError'; this.code = code; }
}
function findCodex(home) {
  const paths = [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
    path.join(home, '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
  ];
  return paths.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { return false; } }) || null;
}
function normalizeLimits(result) {
  const data = result && (result.rateLimitsByLimitId?.codex || result.rateLimits);
  if (!data) return [];
  return ['primary', 'secondary'].map(k => data[k]).filter(w => w && w.usedPercent != null && Number.isFinite(Number(w.usedPercent)))
    .map(w => ({ etq: etiquetaVentana(w.windowDurationMins), pct: Number(w.usedPercent), reset: Number.isFinite(Number(w.resetsAt)) && Number(w.resetsAt) > 0 ? Number(w.resetsAt) : null }));
}
function validAuthUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ['auth.openai.com', 'chatgpt.com'].includes(u.hostname);
  } catch (_) { return false; }
}

class CodexClient extends EventEmitter {
  constructor({ home, userHome, executable, spawnProcess = spawn }) {
    super();
    this.home = home;
    this.userHome = userHome;
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.process = null;
    this.starting = null;
    this.pending = new Map();
    this.sequence = 0;
    this.buffer = '';
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.process) return;
    this.starting = this._start();
    try { await this.starting; } finally { this.starting = null; }
  }
  async _start() {
    const executable = this.executable || findCodex(this.userHome);
    if (!executable) throw new CodexError('missing', 'No se encontró Codex. Instala o actualiza la aplicación de ChatGPT o Codex CLI.');
    fs.mkdirSync(this.home, { recursive: true, mode: 0o700 });
    const env = { ...process.env };
    // The user's shell may have another provider or token configured. Use only
    // this app's isolated account and preserve ordinary OS/network variables.
    for (const k of Object.keys(env)) if (/^(CODEX_|OPENAI_|CHATGPT_|ANTHROPIC_)/.test(k)) delete env[k];
    env.CODEX_HOME = this.home;
    const child = this.spawnProcess(executable, ['app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="keyring"'], {
      cwd: this.home, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.process = child;
    this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => this.onData(data));
    // Ignore stderr: it can contain account or authorization details.
    child.stderr.resume();
    child.on('error', () => this.onExit(child));
    child.on('exit', () => this.onExit(child));
    try {
      await this.request('initialize', { clientInfo: { name: 'medidor', title: 'Medidor', version: '1.4.0' } }, 20000);
      this.notify('initialized', {});
    } catch (e) { this.close(); throw e; }
  }
  onExit(child) {
    if (this.process !== child) return;
    this.process = null;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new CodexError('unavailable', 'Codex se cerró o no está disponible.')); }
    this.pending.clear();
    this.emit('closed');
  }
  onData(data) {
    this.buffer += data;
    if (this.buffer.length > 2 * 1024 * 1024) { this.close(); return; }
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      let m; try { m = JSON.parse(line); } catch (_) { continue; }
      if (m.id != null && this.pending.has(m.id)) {
        const entry = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(entry.timer);
        if (m.error) entry.reject(new CodexError('rpc', 'Codex no pudo completar la solicitud.'));
        else entry.resolve(m.result);
      } else if (m.method === 'account/login/completed') {
        this.emit('loginCompleted', { loginId: m.params?.loginId, success: m.params?.success === true });
      }
    }
  }
  notify(method, params) { if (this.process?.stdin.writable) this.process.stdin.write(JSON.stringify({ method, params }) + '\n'); }
  request(method, params, timeoutMs = 15000) {
    if (!this.process?.stdin.writable) return Promise.reject(new CodexError('unavailable', 'Codex no está disponible.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CodexError('timeout', 'La consulta tardó demasiado.')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (!error || !this.pending.has(id)) return;
        this.pending.delete(id); clearTimeout(timer); reject(new CodexError('unavailable', 'No se pudo comunicar con Codex.'));
      });
    });
  }
  async limits() {
    await this.start();
    const { account } = await this.request('account/read', { refreshToken: false });
    if (!account || account.type !== 'chatgpt') throw new CodexError('nosession', 'Conecta tu cuenta de ChatGPT.');
    const data = await this.request('account/rateLimits/read', {});
    const ventanas = normalizeLimits(data);
    if (!ventanas.length) throw new CodexError('nodata', 'La cuenta no proporciona límites para Codex.');
    return { ventanas, plan: account.planType || null, source: 'Codex · cuenta conectada' };
  }
  async beginLogin() {
    await this.start();
    const result = await this.request('account/login/start', { type: 'chatgpt' }, 20000);
    if (!result || result.type !== 'chatgpt' || !result.loginId || !validAuthUrl(result.authUrl)) {
      throw new CodexError('auth', 'No se pudo iniciar el acceso seguro.');
    }
    return result;
  }
  async cancelLogin(loginId) { if (this.process && loginId) await this.request('account/login/cancel', { loginId }).catch(() => {}); }
  async logout() { await this.start(); await this.request('account/logout', {}); }
  close() {
    const p = this.process;
    if (!p) return;
    this.onExit(p);
    p.kill();
  }
}
module.exports = { CodexClient, CodexError, findCodex, normalizeLimits, validAuthUrl };
