'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot } = require('../panel-state');
const P = require('../providers');

const now = Date.UTC(2026, 10, 22, 20);
const blank = () => ({ claude: { status: 'nosession' }, gpt: { status: 'nosession' } });

test('ventanas conectadas muestran porcentaje usado y origen sin enviar secretos', () => {
  const s = blank();
  s.claude = { status: 'ok', t: now, data: { cuenta: 'privado@example.com', raw: { token: 'secreto' }, ventanas: [{ etq: 'Semana', pct: 83, reset: now / 1000 + 1000 }] } };
  const result = snapshot(s, now);
  assert.equal(result.claude.windows[0].used, 83);
  assert.equal(result.claude.stale, false);
  assert.equal(result.claude.source, 'Cuenta conectada');
  assert.ok(!JSON.stringify(result).includes('secreto'));
  assert.ok(!JSON.stringify(result).includes('privado@example.com'));
});

test('los registros antiguos de Codex no se muestran como cuenta conectada', () => {
  const s = blank();
  s.logsLimites = { ts: now / 1000 - 1800, ventanas: [{ etq: 'Sesión 5h', pct: 27, reset: now / 1000 + 3600 }] };
  const g = snapshot(s, now).chatgpt;
  assert.deepEqual(g.windows, []);
  assert.equal(g.status, 'nosession');
});

test('rechaza porcentajes no numéricos y limita valores fuera de rango', () => {
  const s = blank();
  s.claude = { status: 'ok', t: now, data: { ventanas: [{ pct: 'no' }, { pct: null }, { pct: 120 }, { pct: -1 }] } };
  assert.deepEqual(snapshot(s, now).claude.windows.map(x => x.used), [100, 0]);
});

test('cuando pasa la fecha de reinicio no inventa un uso de cero', () => {
  const s = blank();
  s.gpt = { status: 'ok', t: now - 100, data: { ventanas: [{ etq: 'Sesión 5h', pct: 74, reset: now / 1000 - 1 }] } };
  assert.equal(snapshot(s, now).chatgpt.windows[0].used, 74);
  assert.equal(snapshot(s, now).chatgpt.stale, true);
});

test('si falla la consulta conserva dato anterior y lo marca como tal', () => {
  const s = blank();
  s.claude = { status: 'error', err: 'sin conexión', t: now - 100, data: { ventanas: [{ etq: 'Sesión', pct: 19 }] } };
  const c = snapshot(s, now).claude;
  assert.equal(c.windows[0].used, 19);
  assert.equal(c.stale, true);
  assert.equal(c.error, 'sin conexión');
});

test('sin cuenta ni respaldo no presenta porcentaje inventado', () => {
  const g = snapshot(blank(), now).chatgpt;
  assert.equal(g.status, 'nosession');
  assert.deepEqual(g.windows, []);
  assert.equal(g.updatedAt, null);
});

test('interpreta las respuestas de ejemplo sin consultar cuentas', () => {
  const c = P.parseClaudeUsage({ five_hour: { utilization: 37, resets_at: '2026-11-22T22:00:00Z' } });
  assert.equal(c[0].pct, 37);
});
