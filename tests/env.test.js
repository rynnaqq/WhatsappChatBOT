import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadEnv } from '../src/config/env.js';

const valid = { DASHBOARD_PASSWORD: 'operator-password-123', SESSION_SECRET: 'a'.repeat(64) };

test('environment resolves defaults and a relative storage directory', () => {
  const config = loadEnv(valid);
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.trustProxy, false);
  assert.equal(config.storageDir, path.resolve('storage'));
  assert.equal(config.sessionTtlMs, 43_200_000);
});

test('environment rejects weak credentials without reflecting their values', () => {
  for (const patch of [{ DASHBOARD_PASSWORD: '' }, { DASHBOARD_PASSWORD: 'short' }, { SESSION_SECRET: 'secret' }]) {
    assert.throws(() => loadEnv({ ...valid, ...patch }), (error) => {
      assert.match(error.message, /DASHBOARD_PASSWORD|SESSION_SECRET/);
      assert.equal(error.message.includes('operator-password-123'), false);
      return true;
    });
  }
});

test('environment refuses invalid ports, limits, log levels and proxy flags', () => {
  for (const patch of [{ PORT: '0' }, { PORT: '3000abc' }, { PORT: '65536' }, { MAX_TOKENS_CEILING: '-1' }, { LOG_LEVEL: 'verbose' }, { TRUST_PROXY: 'yes' }]) {
    assert.throws(() => loadEnv({ ...valid, ...patch }));
  }
});
