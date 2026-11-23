'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { CodexClient, normalizeLimits, validAuthUrl } = require('../codex-client');

test('solo permite URL seguras de autorización de OpenAI', () => {
  assert.equal(validAuthUrl('https://auth.openai.com/oauth/authorize?state=test'), true);
  assert.equal(validAuthUrl('https://chatgpt.com/auth/start'), true);
  for (const s of ['http://auth.openai.com/', 'https://auth.openai.com:444/', 'https://auth.openai.com.example.org/', 'https://auth.openai.com@evil.example/', 'file:///tmp/test', 'invalid']) assert.equal(validAuthUrl(s), false);
});
test('interpreta límites y no inventa ventanas faltantes', () => {
  const result = normalizeLimits({ rateLimits: { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: null } });
  assert.deepEqual(result, [{ etq: 'Sesión 5h', pct: 23, reset: 2000000000 }]);
  assert.deepEqual(normalizeLimits({}), []);
  assert.deepEqual(normalizeLimits({ rateLimits: { primary: { usedPercent: null } } }), []);
});
test('inicializa, consulta, inicia acceso y procesa el resultado sin entregar correo', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'medidor-codex-test-'));
  let childOptions;
  const client = new CodexClient({ home, userHome: home, executable: process.execPath,
    spawnProcess: (_exe, _args, options) => { childOptions = options; return spawn(process.execPath, [path.join(__dirname, 'mock-codex.js')], options); } });
  try {
    const data = await client.limits();
    assert.deepEqual(data.ventanas.map(w => w.pct), [23, 47]);
    assert.equal(data.source, 'Codex · cuenta conectada');
    assert.equal(JSON.stringify(data).includes('private@example.com'), false);
    assert.equal(childOptions.env.CODEX_HOME, home);
    assert.equal(childOptions.env.OPENAI_API_KEY, undefined);
    const login = await client.beginLogin();
    assert.equal(login.loginId, 'demo-login');
    const event = new Promise(resolve => client.once('loginCompleted', resolve));
    await client.request('test/complete', {});
    assert.deepEqual(await event, { loginId: 'demo-login', success: true });
    await client.cancelLogin(login.loginId);
    await client.logout();
  } finally { client.close(); fs.rmSync(home, { recursive: true, force: true }); }
});
