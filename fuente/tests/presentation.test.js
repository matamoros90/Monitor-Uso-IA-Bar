'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { presentWindow, isStale, resetText } = require('../panel-presentation');

test('ChatGPT muestra el porcentaje restante igual que la página del plan', () => {
  const session = presentWindow(64, 'chatgpt');
  const weekly = presentWindow(27, 'chatgpt');
  assert.deepEqual([session.value, session.kind, session.level], [36, 'restante', 'warning']);
  assert.deepEqual([weekly.value, weekly.kind, weekly.level], [73, 'restante', 'good']);
});

test('Claude conserva su porcentaje usado y el estado depende de lo que queda', () => {
  assert.deepEqual(presentWindow(36, 'claude'), { value: 36, remaining: 64, kind: 'usado', level: 'good', status: 'Disponible' });
  assert.deepEqual(presentWindow(83, 'claude'), { value: 83, remaining: 17, kind: 'usado', level: 'low', status: 'Cerca del límite' });
});

test('los umbrales son consistentes en los bordes y no dependen solo del color', () => {
  for (const [remaining, level, status] of [[100, 'good', 'Disponible'], [50, 'good', 'Disponible'], [49, 'warning', 'Atención'], [20, 'warning', 'Atención'], [19, 'low', 'Cerca del límite'], [0, 'low', 'Cerca del límite']]) {
    const gpt = presentWindow(100 - remaining, 'chatgpt');
    const claude = presentWindow(100 - remaining, 'claude');
    assert.deepEqual([gpt.value, gpt.level, gpt.status], [remaining, level, status]);
    assert.deepEqual([claude.remaining, claude.level, claude.status], [remaining, level, status]);
  }
});

test('un dato desactualizado se presenta neutro y conserva la última cifra', () => {
  const now = Date.UTC(2026, 10, 22, 20);
  assert.equal(isStale({ stale: false, updatedAt: now - 16 * 60000, windows: [{ reset: now / 1000 + 30 }] }, now), true);
  assert.equal(isStale({ stale: false, updatedAt: now, windows: [{ reset: now / 1000 - 1 }] }, now), true);
  assert.equal(isStale({ stale: false, updatedAt: now, windows: [{ reset: now / 1000 + 1 }] }, now), false);
  assert.deepEqual(presentWindow(64, 'chatgpt', true), { value: 36, remaining: 36, kind: 'restante', level: 'stale', status: 'Dato anterior' });
});

test('no inventa datos no numéricos ni reinicios ya ocurridos', () => {
  const now = Date.UTC(2026, 10, 22, 20);
  assert.equal(presentWindow(null, 'chatgpt'), null);
  assert.equal(presentWindow('x', 'chatgpt'), null);
  assert.equal(resetText(null, now), 'Sin hora de reinicio');
  assert.equal(resetText(now / 1000 - 1, now), 'Reinicio previsto ya pasó · actualiza');
  assert.match(resetText(now / 1000 + 21 * 60, now), /^Se restablece en 21 min/);
  assert.match(resetText(now / 1000 + 5 * 86400, now), /^Se restablece en 5 d 0 h/);
});
