import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageHandler } from '../src/bot/messageHandler.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function settings(overrides = {}) {
  return {
    ai: { visionEnabled: true, maxImageMB: 5, timeoutSeconds: 60, ...overrides.ai },
    bot: {
      commandPrefix: '',
      privateChatsOnly: false,
      groupRepliesEnabled: true,
      typingIndicator: false,
      maxMessageAgeSeconds: 120,
      markRead: false,
      rateLimitPerMinute: 20,
      ...overrides.bot,
    },
  };
}

function message(id, text, overrides = {}) {
  const remoteJid = overrides.remoteJid ?? 'person@s.whatsapp.net';
  return {
    key: { id, remoteJid, fromMe: false, ...overrides.key },
    messageTimestamp: overrides.messageTimestamp ?? Math.floor(Date.now() / 1000),
    message: overrides.payload ?? { conversation: text },
  };
}

function socket() {
  return {
    user: { id: 'bot:2@s.whatsapp.net' },
    sent: [],
    presence: [],
    read: [],
    async sendMessage(jid, content, options) { this.sent.push({ jid, content, options }); },
    async sendPresenceUpdate(value, jid) { this.presence.push([value, jid]); },
    async readMessages(keys) { this.read.push(keys); },
  };
}

function harness(overrides = {}) {
  const calls = [];
  const current = overrides.settings ?? settings();
  const aiService = overrides.aiService ?? {
    async reply(input) { calls.push(input); return `answer:${input.text}`; },
  };
  const handler = createMessageHandler({
    settingsRepo: { get: () => structuredClone(current) },
    aiService,
    logger: overrides.logger ?? logger,
    downloadImage: overrides.downloadImage,
    now: overrides.now,
  });
  return { handler, calls };
}

test('notify upserts process every eligible message and quote each original', async () => {
  const { handler, calls } = harness();
  const sock = socket();
  const first = message('one', 'first');
  const second = message('two', 'second');

  await handler.handleUpsert(sock, { type: 'notify', messages: [first, second] });

  assert.deepEqual(calls.map(({ chatId, text }) => ({ chatId, text })), [
    { chatId: 'person@s.whatsapp.net', text: 'first' },
    { chatId: 'person@s.whatsapp.net', text: 'second' },
  ]);
  assert.equal(sock.sent.length, 2);
  assert.equal(sock.sent[0].options.quoted, first);
  assert.equal(sock.sent[1].options.quoted, second);
  handler.close();
});

test('non-notify, from-me, broadcast, newsletter, self, protocol, and unsupported messages are ignored', async () => {
  const { handler, calls } = harness();
  const sock = socket();
  await handler.handleUpsert(sock, { type: 'append', messages: [message('append', 'no')] });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('mine', 'no', { key: { fromMe: true } }),
      message('status', 'no', { remoteJid: 'status@broadcast' }),
      message('broadcast', 'no', { remoteJid: 'updates@broadcast' }),
      message('news', 'no', { remoteJid: 'channel@newsletter' }),
      message('self', 'no', { remoteJid: 'bot@s.whatsapp.net' }),
      message('protocol', '', { payload: { protocolMessage: { type: 0 } } }),
      message('video', '', { payload: { videoMessage: { caption: 'no' } } }),
    ],
  });

  assert.equal(calls.length, 0);
  assert.equal(sock.sent.length, 0);
  handler.close();
});

test('privateChatsOnly overrides enabled group replies and disabled group replies skip groups', async () => {
  for (const bot of [
    { privateChatsOnly: true, groupRepliesEnabled: true },
    { privateChatsOnly: false, groupRepliesEnabled: false },
  ]) {
    const { handler, calls } = harness({ settings: settings({ bot }) });
    await handler.handleUpsert(socket(), {
      type: 'notify',
      messages: [message(`group-${String(bot.privateChatsOnly)}`, 'hello', { remoteJid: '123@g.us' })],
    });
    assert.equal(calls.length, 0);
    handler.close();
  }
});

test('group text remains eligible when Baileys retains sender-key distribution metadata', async () => {
  const { handler, calls } = harness();
  await handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [message('sender-key-with-text', '', {
      remoteJid: '123@g.us',
      payload: {
        senderKeyDistributionMessage: { groupId: '123@g.us', axolotlSenderKeyDistributionMessage: Buffer.from('key') },
        extendedTextMessage: { text: 'visible group text' },
      },
    })],
  });

  assert.deepEqual(calls.map(({ text }) => text), ['visible group text']);
  handler.close();
});

test('prefix matching is exact and strips only the leading configured prefix', async () => {
  const { handler, calls } = harness({ settings: settings({ bot: { commandPrefix: '!ask' } }) });
  const sock = socket();
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [message('no-prefix', '!Ask no'), message('prefix', '!ask   explain !ask')],
  });

  assert.deepEqual(calls.map(({ text }) => text), ['explain !ask']);
  handler.close();
});

test('wrapped text and images are unwrapped; image-only default prompt applies only without a prefix', async () => {
  const downloaded = [];
  const imageDownload = async (_sock, msg, options) => {
    downloaded.push({ msg, options });
    return { buffer: Buffer.from('png'), mimeType: 'image/png' };
  };
  const { handler, calls } = harness({ downloadImage: imageDownload });
  const sock = socket();
  const wrapped = message('wrapped', '', {
    payload: { ephemeralMessage: { message: { viewOnceMessageV2: { message: { extendedTextMessage: { text: 'inside' } } } } } },
  });
  const image = message('image', '', { payload: { imageMessage: { mimetype: 'image/png' } } });
  await handler.handleUpsert(sock, { type: 'notify', messages: [wrapped, image] });

  assert.deepEqual(calls.map(({ text }) => text), ['inside', 'Describe this image.']);
  assert.equal(calls[1].mimeType, 'image/png');
  assert.deepEqual(calls[1].imageBuffer, Buffer.from('png'));
  assert.equal(downloaded[0].options.maxBytes, 5 * 1024 * 1024);
  assert.equal(downloaded[0].options.timeoutMs, 60_000);
  handler.close();

  const prefixed = harness({ settings: settings({ bot: { commandPrefix: '!' } }), downloadImage: imageDownload });
  await prefixed.handler.handleUpsert(socket(), { type: 'notify', messages: [message('ignored-image', '', { payload: { imageMessage: {} } })] });
  assert.equal(prefixed.calls.length, 0);
  prefixed.handler.close();
});

test('closing the handler while an image downloads prevents stale AI inference', async () => {
  let releaseDownload;
  let downloadStarted = false;
  let aiCalls = 0;
  const { handler } = harness({
    downloadImage: async () => {
      downloadStarted = true;
      await new Promise((resolve) => { releaseDownload = resolve; });
      return { buffer: Buffer.from('image'), mimeType: 'image/jpeg' };
    },
    aiService: { async reply() { aiCalls += 1; return 'stale'; } },
  });
  const pending = handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [message('logout-image', '', { payload: { imageMessage: {} } })],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(downloadStarted, true);

  handler.close();
  releaseDownload();
  await pending;
  assert.equal(aiCalls, 0);
});

test('old protobuf timestamps are ignored while unknown timestamps remain eligible', async () => {
  const now = () => Date.parse('2026-10-08T10:00:00.000Z');
  const { handler, calls } = harness({ now });
  const oldSeconds = Math.floor((now() - 121_000) / 1000);
  await handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [
      message('old', 'old', { messageTimestamp: { low: oldSeconds, high: 0, unsigned: false } }),
      message('unknown', 'new', { messageTimestamp: { unexpected: true } }),
    ],
  });

  assert.deepEqual(calls.map(({ text }) => text), ['new']);
  handler.close();
});

test('deduplication is scoped by chat and suppresses redelivery', async () => {
  const { handler, calls } = harness();
  const sock = socket();
  await handler.handleUpsert(sock, { type: 'notify', messages: [message('same', 'one')] });
  await handler.handleUpsert(sock, { type: 'notify', messages: [message('same', 'duplicate')] });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [message('same', 'other chat', { remoteJid: 'other@s.whatsapp.net' })],
  });

  assert.deepEqual(calls.map(({ text }) => text), ['one', 'other chat']);
  handler.close();
});

test('one queue per chat preserves local order while allowing other chats to finish', async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const { handler } = harness({
    aiService: {
      async reply({ chatId, text }) {
        events.push(`start:${chatId}:${text}`);
        if (text === 'first') await firstGate;
        events.push(`end:${chatId}:${text}`);
        return text;
      },
    },
  });
  const sock = socket();
  const pendingA = handler.handleUpsert(sock, {
    type: 'notify',
    messages: [message('a1', 'first'), message('a2', 'second')],
  });
  const pendingB = handler.handleUpsert(sock, {
    type: 'notify',
    messages: [message('b1', 'other', { remoteJid: 'other@s.whatsapp.net' })],
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [
    'start:person@s.whatsapp.net:first',
    'start:other@s.whatsapp.net:other',
    'end:other@s.whatsapp.net:other',
  ]);
  releaseFirst();
  await Promise.all([pendingA, pendingB]);
  assert.deepEqual(events.slice(-3), [
    'end:person@s.whatsapp.net:first',
    'start:person@s.whatsapp.net:second',
    'end:person@s.whatsapp.net:second',
  ]);
  handler.close();
});

test('typing, read receipts, safe failures, and active-socket suppression apply around inference', async () => {
  const userError = Object.assign(new Error('Image messages are disabled.'), { code: 'AI_USER_FACING' });
  const failures = [userError, new Error('provider secret detail')];
  const { handler } = harness({
    settings: settings({ bot: { typingIndicator: true, markRead: true } }),
    aiService: { async reply() { throw failures.shift(); } },
  });
  const sock = socket();
  await handler.handleUpsert(sock, { type: 'notify', messages: [message('safe', 'one')] });
  await handler.handleUpsert(sock, { type: 'notify', messages: [message('generic', 'two')] });

  assert.deepEqual(sock.presence, [
    ['composing', 'person@s.whatsapp.net'], ['paused', 'person@s.whatsapp.net'],
    ['composing', 'person@s.whatsapp.net'], ['paused', 'person@s.whatsapp.net'],
  ]);
  assert.equal(sock.read.length, 2);
  assert.deepEqual(sock.sent.map(({ content }) => content.text), [
    'Image messages are disabled.',
    "Sorry, I couldn't process that request right now.",
  ]);

  const stale = harness();
  const staleSocket = socket();
  await stale.handler.handleUpsert(staleSocket, { type: 'notify', messages: [message('stale', 'hello')] }, { isActive: () => false });
  assert.equal(staleSocket.sent.length, 0);
  handler.close();
  stale.handler.close();
});

test('per-chat accepted-message rate limit is bounded to the configured minute window', async () => {
  let time = 1_000_000;
  const { handler, calls } = harness({
    settings: settings({ bot: { rateLimitPerMinute: 2 } }),
    now: () => time,
  });
  const sock = socket();
  await handler.handleUpsert(sock, { type: 'notify', messages: [message('r1', 'one'), message('r2', 'two'), message('r3', 'three')] });
  assert.deepEqual(calls.map(({ text }) => text), ['one', 'two']);

  time += 60_001;
  await handler.handleUpsert(sock, { type: 'notify', messages: [message('r4', 'four')] });
  assert.deepEqual(calls.map(({ text }) => text), ['one', 'two', 'four']);
  handler.close();
});

test('the number of simultaneously retained chat queues stays bounded', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started = 0;
  const { handler } = harness({
    aiService: { async reply() { started += 1; await gate; return 'ok'; } },
  });
  const sock = socket();
  const messages = Array.from({ length: 1_001 }, (_, index) =>
    message(`bounded-${index}`, 'hello', { remoteJid: `chat-${index}@s.whatsapp.net` }));
  const pending = handler.handleUpsert(sock, { type: 'notify', messages });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started, 1_000);
  release();
  await pending;
  handler.close();
});
