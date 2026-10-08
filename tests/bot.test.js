import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BotState } from '../src/bot/botState.js';
import { WhatsAppBot } from '../src/bot/socket.js';

const quietLogger = {
  child() { return this; },
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function fakeSocket(id) {
  const ev = new EventEmitter();
  return {
    id,
    ev,
    user: undefined,
    ended: 0,
    loggedOut: 0,
    sent: [],
    end() { this.ended += 1; },
    async logout() { this.loggedOut += 1; },
    async sendMessage(jid, content, options) { this.sent.push({ jid, content, options }); },
    async sendPresenceUpdate() {},
  };
}

function testSettings() {
  return {
    ai: { maxImageMB: 5 },
    bot: {
      commandPrefix: '',
      privateChatsOnly: false,
      groupRepliesEnabled: true,
      typingIndicator: false,
      maxMessageAgeSeconds: 120,
      markRead: false,
      rateLimitPerMinute: 20,
    },
  };
}

function createHarness(overrides = {}) {
  const sockets = [];
  const authCalls = [];
  const saved = [];
  const delays = [];
  const aiCalls = [];
  const state = new BotState();
  const bot = new WhatsAppBot({
    storageDir: overrides.storageDir ?? path.join(tmpdir(), 'whatsapp-bot-test'),
    state,
    settingsRepo: overrides.settingsRepo ?? { get: () => testSettings() },
    aiService: overrides.aiService ?? { reply: async (input) => { aiCalls.push(input); return 'ok'; } },
    logger: quietLogger,
    authStateFactory: overrides.authStateFactory ?? (async (directory) => {
      authCalls.push(directory);
      return { state: { creds: {}, keys: {} }, saveCreds: async () => saved.push('saved') };
    }),
    socketFactory: overrides.socketFactory ?? (() => {
      const socket = fakeSocket(`socket-${sockets.length + 1}`);
      sockets.push(socket);
      return socket;
    }),
    qrRenderer: overrides.qrRenderer ?? (async (value) => `data:image/png;base64,${value}`),
    sleep: overrides.sleep ?? (async (milliseconds) => delays.push(milliseconds)),
    random: overrides.random ?? (() => 0),
  });
  return { bot, state, sockets, authCalls, saved, delays, aiCalls };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

async function waitFor(predicate, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for asynchronous bot work');
}

test('BotState emits immutable snapshots and expires QR data', async () => {
  const state = new BotState();
  const statuses = [];
  const qrs = [];
  state.on('status', (snapshot) => statuses.push(snapshot));
  state.on('qr', (payload) => qrs.push(payload));

  state.setQR('data:image/png;base64,qr', 15);
  const first = state.snapshot();
  first.state = 'connected';

  assert.equal(state.snapshot().state, 'qr_required');
  assert.equal(state.snapshot().qr, 'data:image/png;base64,qr');
  assert.deepEqual(qrs, [{ dataUrl: 'data:image/png;base64,qr', expiresInMs: 15 }]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(state.snapshot().state, 'disconnected');
  assert.equal('qr' in state.snapshot(), false);
  assert.equal(statuses.at(-1).state, 'disconnected');
});

test('BotState clears QR fields whenever state leaves qr_required', () => {
  const state = new BotState();
  state.setQR('data:image/png;base64,qr', 10_000);
  state.update({ state: 'connected', phone: '15551234567', connectedAt: '2026-10-08T00:00:00.000Z' });

  assert.deepEqual(state.snapshot(), {
    state: 'connected',
    phone: '15551234567',
    connectedAt: '2026-10-08T00:00:00.000Z',
  });
});

test('start wires credentials, QR rendering, and connected identity', async () => {
  const { bot, state, sockets, authCalls, saved } = createHarness();
  await bot.start();
  assert.equal(sockets.length, 1);
  assert.equal(state.snapshot().state, 'connecting');
  assert.equal(path.basename(authCalls[0]), 'auth_info');

  sockets[0].ev.emit('creds.update', { registered: true });
  sockets[0].ev.emit('connection.update', { qr: 'pairing-value' });
  await settle();
  assert.equal(saved.length, 1);
  assert.equal(state.snapshot().qr, 'data:image/png;base64,pairing-value');

  sockets[0].user = { id: '15551234567:4@s.whatsapp.net' };
  sockets[0].ev.emit('connection.update', { connection: 'open' });
  await settle();
  assert.equal(state.snapshot().state, 'connected');
  assert.equal(state.snapshot().phone, '15551234567');
  assert.ok(Date.parse(state.snapshot().connectedAt));
});

test('credentials updates are saved serially and save failures stay contained', async () => {
  let active = 0;
  let maximum = 0;
  let releaseFirst;
  let calls = 0;
  const authStateFactory = async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: async () => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      if (calls === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      active -= 1;
      if (calls === 2) throw new Error('disk secret detail');
    },
  });
  const { bot, sockets } = createHarness({ authStateFactory });
  await bot.start();
  sockets[0].ev.emit('creds.update', {});
  sockets[0].ev.emit('creds.update', {});
  await settle();
  assert.equal(calls, 1);
  releaseFirst();
  await waitFor(() => calls === 2);
  assert.equal(maximum, 1);
});

test('active socket consumes message events and restart suppresses an in-flight stale reply', async () => {
  let releaseReply;
  const replyGate = new Promise((resolve) => { releaseReply = resolve; });
  const aiService = { async reply() { await replyGate; return 'late answer'; } };
  const { bot, sockets } = createHarness({ aiService });
  await bot.start();
  sockets[0].ev.emit('messages.upsert', {
    type: 'notify',
    messages: [{
      key: { id: 'in-flight', remoteJid: 'person@s.whatsapp.net', fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'hello' },
    }],
  });
  await settle();
  await bot.restart();
  releaseReply();
  await settle();

  assert.equal(sockets[0].sent.length, 0);
  assert.equal(sockets[0].ev.listenerCount('messages.upsert'), 0);

  sockets[1].ev.emit('messages.upsert', {
    type: 'notify',
    messages: [{
      key: { id: 'current', remoteJid: 'person@s.whatsapp.net', fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'current' },
    }],
  });
  await settle();
  assert.deepEqual(sockets[1].sent.map(({ content }) => content.text), ['late answer']);
});

test('a slow obsolete QR render cannot overwrite a newer pairing code', async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const qrRenderer = async (value) => {
    if (value === 'first') await firstGate;
    return `data:image/png;base64,${value}`;
  };
  const { bot, state, sockets } = createHarness({ qrRenderer });
  await bot.start();
  sockets[0].ev.emit('connection.update', { qr: 'first' });
  sockets[0].ev.emit('connection.update', { qr: 'second' });
  await settle();
  assert.equal(state.snapshot().qr, 'data:image/png;base64,second');

  releaseFirst();
  await settle();
  assert.equal(state.snapshot().qr, 'data:image/png;base64,second');
});

test('reconnect backoff doubles with jitter and caps at sixty seconds', async () => {
  const { bot, sockets, delays } = createHarness({ random: () => 0.5 });
  await bot.start();
  for (let index = 0; index < 7; index += 1) {
    sockets[index].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });
    await settle();
  }
  assert.deepEqual(delays, [1_100, 2_200, 4_400, 8_800, 17_600, 35_200, 60_000]);
});

test('transient closes reconnect once with exponential delay and stale events cannot create sockets', async () => {
  const { bot, sockets, delays } = createHarness();
  await bot.start();

  sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } });
  await settle();
  assert.deepEqual(delays, [1000]);
  assert.equal(sockets.length, 2);

  sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } });
  await settle();
  assert.equal(sockets.length, 2);
});

test('repeated restart serializes replacement and detaches the prior socket', async () => {
  const { bot, sockets } = createHarness();
  await bot.start();

  await Promise.all([bot.restart(), bot.restart(), bot.restart()]);

  assert.equal(sockets.length, 4);
  assert.equal(sockets.filter((socket) => socket.ended === 0).length, 1);
  sockets[0].ev.emit('connection.update', { qr: 'stale' });
  await settle();
  assert.equal(sockets.length, 4);
});

test('socket startup failures leave an accurate disconnected state', async () => {
  const { bot, state } = createHarness({
    socketFactory: async () => { throw new Error('internal transport detail'); },
  });

  await assert.rejects(bot.start(), /internal transport detail/);
  assert.equal(state.snapshot().state, 'disconnected');
  assert.equal(state.snapshot().lastError, 'Unable to start WhatsApp connection.');
});

test('asynchronous socket close failures are contained during restart', async () => {
  const sockets = [];
  const socketFactory = () => {
    const sock = fakeSocket(`reject-close-${sockets.length}`);
    sock.end = async () => { throw new Error('close detail'); };
    sockets.push(sock);
    return sock;
  };
  const { bot } = createHarness({ socketFactory });
  await bot.start();

  await bot.restart();
  await settle();
  assert.equal(sockets.length, 2);
});

test('remote logout clears credentials and stops reconnect until an operator action', async () => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'whatsapp-logout-'));
  const authDir = path.join(storageDir, 'auth_info');
  await mkdir(authDir);
  await writeFile(path.join(authDir, 'creds.json'), 'secret');
  const { bot, state, sockets, delays } = createHarness({ storageDir });
  await bot.start();

  sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await settle();

  assert.equal(state.snapshot().state, 'disconnected');
  assert.equal(delays.length, 0);
  assert.equal(sockets.length, 1);
  await waitFor(async () => access(authDir).then(() => false, () => true));

  await bot.restart();
  assert.equal(sockets.length, 2);
});

test('explicit logout calls remote logout, clears auth, and immediately starts fresh pairing', async () => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'whatsapp-explicit-'));
  const authDir = path.join(storageDir, 'auth_info');
  await mkdir(authDir);
  await writeFile(path.join(authDir, 'creds.json'), 'secret');
  const { bot, sockets } = createHarness({ storageDir });
  await bot.start();
  const first = sockets[0];
  first.user = { id: '15551234567:4@s.whatsapp.net' };
  first.ev.emit('connection.update', { connection: 'open' });
  await settle();

  await bot.restart('logout');

  assert.equal(first.loggedOut, 1);
  assert.equal(sockets.length, 2);
  assert.equal('phone' in bot.state.snapshot(), false);
  assert.equal('connectedAt' in bot.state.snapshot(), false);
  await assert.rejects(access(path.join(authDir, 'creds.json')));
});

test('explicit and fatal logout reset AI memory while same-account restart preserves it', async () => {
  let resets = 0;
  const aiService = { reply: async () => 'ok', resetMemory() { resets += 1; } };
  const { bot, sockets } = createHarness({ aiService });
  await bot.start();
  await bot.restart('restart');
  assert.equal(resets, 0);

  await bot.restart('logout');
  assert.equal(resets, 1);
  sockets[2].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } },
  });
  await waitFor(() => resets === 2);
});

test('an unresolved remote logout cannot block local logout and fresh pairing', async () => {
  const sockets = [];
  const socketFactory = () => {
    const sock = fakeSocket(`hanging-logout-${sockets.length}`);
    sock.logout = () => new Promise(() => {});
    sockets.push(sock);
    return sock;
  };
  const { bot } = createHarness({ socketFactory });
  await bot.start();
  let completed = false;
  void bot.restart('logout').then(() => { completed = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(completed, true);
  assert.equal(sockets.length, 2);
});

test('logout waits for an in-flight credential save before deleting authentication data', async () => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'whatsapp-save-logout-'));
  const authDir = path.join(storageDir, 'auth_info');
  await mkdir(authDir);
  let releaseSave;
  let saveStarted = false;
  const authStateFactory = async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: async () => {
      saveStarted = true;
      await new Promise((resolve) => { releaseSave = resolve; });
      await mkdir(authDir, { recursive: true });
      await writeFile(path.join(authDir, 'late-creds.json'), 'late');
    },
  });
  const { bot, sockets } = createHarness({ storageDir, authStateFactory });
  await bot.start();
  sockets[0].ev.emit('creds.update', {});
  await waitFor(() => saveStarted);

  let restarted = false;
  const pendingRestart = bot.restart('logout').then(() => { restarted = true; });
  await settle();
  assert.equal(restarted, false);

  releaseSave();
  await pendingRestart;
  await assert.rejects(access(path.join(authDir, 'late-creds.json')));
});

test('stop waits for every credential update accepted before shutdown', async () => {
  let releaseSave;
  let saveStarted = false;
  let saveFinished = false;
  const authStateFactory = async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: async () => {
      saveStarted = true;
      await new Promise((resolve) => { releaseSave = resolve; });
      saveFinished = true;
    },
  });
  const { bot, sockets } = createHarness({ authStateFactory });
  await bot.start();
  sockets[0].ev.emit('creds.update', {});
  await waitFor(() => saveStarted);

  let stopped = false;
  const pendingStop = bot.stop().then(() => { stopped = true; });
  await settle();
  assert.equal(stopped, false);

  releaseSave();
  await pendingStop;
  assert.equal(saveFinished, true);
});

test('stop aborts an outstanding reconnect delay', async () => {
  let reconnectSignal;
  let sleepCalled = false;
  let releaseSleep;
  const sleep = (_milliseconds, signal) => new Promise((resolve) => {
    sleepCalled = true;
    reconnectSignal = signal;
    releaseSleep = resolve;
  });
  const { bot, sockets } = createHarness({ sleep });
  await bot.start();
  sockets[0].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 500 } } },
  });
  await waitFor(() => sleepCalled);

  await bot.stop();
  assert.equal(reconnectSignal?.aborted, true);
  releaseSleep();
});

test('fatal logout cleanup finishes before a status-triggered operator restart opens auth', async () => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'whatsapp-fatal-order-'));
  const authDir = path.join(storageDir, 'auth_info');
  await mkdir(authDir);
  await Promise.all(Array.from({ length: 500 }, (_, index) =>
    writeFile(path.join(authDir, `credential-${index}.json`), 'secret')));
  let authCalls = 0;
  let authExistedAtRestart;
  const authStateFactory = async () => {
    authCalls += 1;
    if (authCalls === 2) authExistedAtRestart = existsSync(authDir);
    return { state: { creds: {}, keys: {} }, saveCreds: async () => {} };
  };
  const { bot, state, sockets } = createHarness({ storageDir, authStateFactory });
  await bot.start();
  let operatorRestart;
  state.on('status', (snapshot) => {
    if (snapshot.lastError === 'WhatsApp session logged out.' && !operatorRestart) {
      operatorRestart = bot.restart();
    }
  });

  sockets[0].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 401 } } },
  });
  await waitFor(() => operatorRestart !== undefined);
  await operatorRestart;

  assert.equal(authCalls, 2);
  assert.equal(authExistedAtRestart, false);
});

test('transient reconnect retries when rebuilding auth state fails', async () => {
  let authCalls = 0;
  const authStateFactory = async () => {
    authCalls += 1;
    if (authCalls === 2) throw new Error('temporary auth read failure');
    return { state: { creds: {}, keys: {} }, saveCreds: async () => {} };
  };
  const { bot, sockets, delays } = createHarness({ authStateFactory });
  await bot.start();
  sockets[0].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 500 } } },
  });
  await settle();

  assert.equal(sockets.length, 2);
  assert.equal(authCalls, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});

test('deduplication survives transient reconnect and same-account restart', async () => {
  const { bot, sockets, aiCalls } = createHarness();
  const replay = {
    type: 'notify',
    messages: [{
      key: { id: 'replayed-id', remoteJid: 'person@s.whatsapp.net', fromMe: false },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'hello' },
    }],
  };
  await bot.start();
  sockets[0].ev.emit('messages.upsert', replay);
  await waitFor(() => aiCalls.length === 1);

  sockets[0].ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 500 } } },
  });
  await waitFor(() => sockets.length === 2);
  sockets[1].ev.emit('messages.upsert', replay);
  await settle();
  assert.equal(aiCalls.length, 1);

  await bot.restart('restart');
  sockets[2].ev.emit('messages.upsert', replay);
  await settle();
  assert.equal(aiCalls.length, 1);
});

test('stop closes the active socket and suppresses delayed reconnects', async () => {
  let releaseSleep;
  const sleep = () => new Promise((resolve) => { releaseSleep = resolve; });
  const { bot, state, sockets } = createHarness({ sleep });
  await bot.start();
  sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } });
  await settle();

  await bot.stop();
  releaseSleep();
  await settle();

  assert.equal(sockets.length, 1);
  assert.equal(state.snapshot().state, 'disconnected');
});
