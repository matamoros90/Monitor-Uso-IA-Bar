'use strict';
const readline = require('readline');
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') out({ id: m.id, result: {} });
  else if (m.method === 'account/read') out({ id: m.id, result: { account: { type: 'chatgpt', email: 'private@example.com', planType: 'plus' } } });
  else if (m.method === 'account/rateLimits/read') out({ id: m.id, result: { rateLimits: { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: { usedPercent: 47, windowDurationMins: 10080, resetsAt: 2000300000 } } } });
  else if (m.method === 'account/login/start') out({ id: m.id, result: { type: 'chatgpt', loginId: 'demo-login', authUrl: 'https://auth.openai.com/authorize?state=test' } });
  else if (m.method === 'test/complete') { out({ method: 'account/login/completed', params: { loginId: 'demo-login', success: true } }); out({ id: m.id, result: {} }); }
  else if (['account/login/cancel', 'account/logout'].includes(m.method)) out({ id: m.id, result: {} });
});
