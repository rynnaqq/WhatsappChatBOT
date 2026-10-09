import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWebServer } from '../src/web/server.js';
import { createAuth } from '../src/web/auth.js';
import { SettingsRepo } from '../src/storage/settingsRepo.js';
import { AIService } from '../src/services/aiService.js';
import { MemoryService } from '../src/services/memoryService.js';

const password = 'test-password-with-20-characters';
const logger = { info() {}, warn() {}, error() {}, debug() {} };

async function fixture(t, { makeAIService } = {}) {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'wabot-web-'));
  const config = { port: 0, host: '127.0.0.1', dashboardPassword: password, sessionSecret: 's'.repeat(64), trustProxy: false, sessionTtlMs: 43_200_000 };
  const settingsRepo = new SettingsRepo({ storageDir, encryptionSecret: config.sessionSecret, logger });
  await settingsRepo.init();
  const state = new EventEmitter();
  let current = { state: 'disconnected' };
  state.snapshot = () => structuredClone(current);
  state.change = (value) => { current = { ...current, ...value }; state.emit('status', state.snapshot()); };
  const modes = [];
  const bot = { async restart(mode) { modes.push(mode); } };
  const aiService = makeAIService?.(settingsRepo) ?? { async testConnection() { return { ok: true, model: 'test-model', latencyMs: 1 }; } };
  const web = createWebServer({ config, settingsRepo, state, bot, aiService, logger });
  await web.listen();
  const baseURL = `http://127.0.0.1:${web.server.address().port}`;
  t.after(async () => { await web.close(); await rm(storageDir, { recursive: true, force: true }); });
  const request = (url, options = {}) => fetch(baseURL + url, options);
  const post = (url, body, cookie, origin = baseURL) => request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const login = async () => {
    const response = await post('/api/auth/login', { password });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], response };
  };
  return { ...web, baseURL, request, post, login, settingsRepo, state, modes };
}

test('health is public while the dashboard and all APIs require a session', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/healthz')).status, 200);
  const home = await f.request('/', { redirect: 'manual' });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  for (const url of ['/api/status', '/api/settings', '/api/missing']) assert.equal((await f.request(url)).status, 401);
  assert.equal((await f.post('/api/bot/restart', { mode: 'logout' })).status, 401);
  assert.equal((await f.request('/api/settings', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'unauthorized' })).status, 401);
  assert.equal((await f.request('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 401);
  assert.deepEqual(f.modes, []);
});

test('login sets a private strict cookie and logout revokes the session', async (t) => {
  const f = await fixture(t);
  const { cookie, response } = await f.login();
  const attributes = response.headers.get('set-cookie');
  assert.match(attributes, /HttpOnly/);
  assert.match(attributes, /SameSite=Strict/);
  assert.match(attributes, /Max-Age=43200/);
  assert.equal(attributes.includes(password), false);
  assert.equal((await f.request('/api/status', { headers: { cookie } })).status, 200);
  assert.equal((await f.post('/api/auth/logout', {}, cookie)).status, 200);
  assert.equal((await f.request('/api/status', { headers: { cookie } })).status, 401);
});

test('five failed logins lock the source IP including correct subsequent passwords', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i += 1) assert.equal((await f.post('/api/auth/login', { password: 'wrong' })).status, 401);
  assert.equal((await f.post('/api/auth/login', { password: 'wrong' })).status, 429);
  const locked = await f.post('/api/auth/login', { password });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('cross-origin mutations and malformed bodies are rejected', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login();
  assert.equal((await f.post('/api/bot/restart', { mode: 'logout' }, cookie, 'https://attacker.example')).status, 403);
  const badJson = await f.request('/api/settings', { method: 'POST', headers: { cookie, origin: f.baseURL, 'content-type': 'application/json' }, body: '{' });
  assert.equal(badJson.status, 400);
  assert.equal((await f.request('/api/settings', { method: 'POST', headers: { cookie, origin: f.baseURL, 'content-type': 'text/plain' }, body: 'hello' })).status, 415);
  assert.deepEqual(f.modes, []);
});

test('settings validate full payloads, mask keys, and preserve masked saved keys', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login();
  const payload = f.settingsRepo.get();
  payload.ai.apiKey = 'fake-provider-private-key';
  const saved = await f.post('/api/settings', payload, cookie);
  assert.equal(saved.status, 200);
  const publicSettings = await saved.json();
  assert.equal(publicSettings.ai.apiKey, '********');
  assert.equal(JSON.stringify(publicSettings).includes('fake-provider-private-key'), false);
  publicSettings.ai.model = 'a-new-model';
  assert.equal((await f.post('/api/settings', publicSettings, cookie)).status, 200);
  assert.equal(f.settingsRepo.get().ai.apiKey, 'fake-provider-private-key');
  assert.equal(f.settingsRepo.get().ai.model, 'a-new-model');
  publicSettings.ai.temperature = 9;
  const invalid = await f.post('/api/settings', publicSettings, cookie);
  assert.equal(invalid.status, 400);
  assert.ok((await invalid.json()).fields['ai.temperature']);
  assert.equal(f.settingsRepo.get().ai.temperature, 0.7);
});

test('AI connection tests show safe provider diagnostics using the saved configuration', async (t) => {
  const requests = [];
  const provider = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'private provider detail with private-router-key', code: 'private-code' } }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => provider.close(resolve)));
  const f = await fixture(t, {
    makeAIService: (settingsRepo) => new AIService({ settingsRepo, memory: new MemoryService(), logger }),
  });
  const { cookie } = await f.login();
  const settings = f.settingsRepo.get();
  settings.ai.baseURL = `http://127.0.0.1:${provider.address().port}/v1`;
  settings.ai.apiKey = 'private-router-key';
  settings.ai.model = 'oc/muse-spark-1.3-contributor-free';
  assert.equal((await f.post('/api/settings', settings, cookie)).status, 200);

  const result = await f.post('/api/ai/test', {}, cookie);
  const body = await result.json();

  assert.equal(result.status, 502);
  assert.equal(body.code, 'AI_REQUEST_REJECTED');
  assert.equal(body.providerStatus, 400);
  assert.match(body.error, /model|parameters/i);
  assert.equal(JSON.stringify(body).includes('private-router-key'), false);
  assert.equal(JSON.stringify(body).includes('private provider detail'), false);
  assert.equal(JSON.stringify(body).includes('private-code'), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].authorization, 'Bearer private-router-key');
  assert.equal(requests[0].body.model, 'oc/muse-spark-1.3-contributor-free');
});

test('AI connection tests keep unexpected internal errors private', async (t) => {
  const f = await fixture(t, {
    makeAIService: () => ({ async testConnection() { throw new Error('private internal error with private-router-key'); } }),
  });
  const { cookie } = await f.login();

  const result = await f.post('/api/ai/test', {}, cookie);
  const body = await result.json();

  assert.equal(result.status, 502);
  assert.equal(JSON.stringify(body).includes('private-router-key'), false);
  assert.equal(JSON.stringify(body).includes('private internal error'), false);
  assert.match(body.error, /model/i);
});

test('restart validates the mode and acknowledges an accepted lifecycle action', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.login();
  assert.equal((await f.post('/api/bot/restart', { mode: 'delete-everything' }, cookie)).status, 400);
  assert.deepEqual(f.modes, []);
  assert.equal((await f.post('/api/bot/restart', { mode: 'restart' }, cookie)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.modes, ['restart']);
});

test('session signatures, expiry, and revocation are enforced', () => {
  let time = 100;
  const auth = createAuth({ password, secret: 'x'.repeat(64), ttlMs: 1000, now: () => time });
  const token = auth.issue();
  assert.ok(auth.getSession(`wabot_session=${token}`));
  assert.equal(auth.getSession(`wabot_session=${token.slice(0, -4)}abcd`), null);
  assert.equal(auth.getSession(`wabot_session=${token.split('.')[0]}.${'é'.repeat(token.split('.')[1].length)}`), null);
  time = 1101;
  assert.equal(auth.getSession(`wabot_session=${token}`), null);
  const second = auth.issue();
  auth.revoke(auth.getSession(`wabot_session=${second}`).sid);
  assert.equal(auth.getSession(`wabot_session=${second}`), null);
});

function openSocket(url, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once('error', reject);
    socket.once('message', (buffer) => resolve({ socket, event: JSON.parse(buffer.toString()) }));
  });
}

function rejectedUpgrade(url, options) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
  });
}

test('WebSocket rejects anonymous and foreign-origin clients, replays and pushes status, and closes on logout', async (t) => {
  const f = await fixture(t);
  const url = f.baseURL.replace('http:', 'ws:') + '/ws';
  assert.equal(await rejectedUpgrade(url, { headers: { origin: f.baseURL } }), 401);
  const { cookie } = await f.login();
  assert.equal(await rejectedUpgrade(url, { headers: { cookie, origin: 'https://attacker.example' } }), 403);
  const { socket, event } = await openSocket(url, { headers: { cookie, origin: f.baseURL } });
  t.after(() => socket.terminate());
  assert.deepEqual(event, { type: 'status', payload: { state: 'disconnected' } });
  const next = once(socket, 'message');
  f.state.change({ state: 'connected', phone: '628123456789', connectedAt: '2026-10-08T12:00:00.000Z' });
  const [buffer] = await next;
  assert.equal(JSON.parse(buffer.toString()).payload.state, 'connected');
  const closed = once(socket, 'close');
  await f.post('/api/auth/logout', {}, cookie);
  const [code] = await closed;
  assert.equal(code, 1008);
});
