import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { createMessageHandler } from '../src/bot/messageHandler.js';
import { AIService } from '../src/services/aiService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { DEFAULT_SETTINGS } from '../src/storage/settingsRepo.js';

function harness({ mode = 'contextual', stickerId = 'happy', text = 'Haii, senang ketemu kamu >.< 🌸', send, downloadMedia } = {}) {
  let clock = 1_800_000_000_000;
  let active = true;
  const logs = [];
  const sent = [];
  const current = {
    ai: { timeoutSeconds: 60 },
    bot: { replyTrigger: 'mention-or-reply', typingIndicator: false, stickerReplies: mode },
  };
  const sock = {
    user: { id: '628000@s.whatsapp.net' },
    async sendMessage(jid, content, options) {
      if (send) await send(content);
      sent.push({ jid, content, options });
    },
  };
  const handler = createMessageHandler({
    settingsRepo: { get: () => structuredClone(current) },
    aiService: {
      async reply() { return text; },
      async replyWithMedia() { return { text, stickerId }; },
    },
    logger: { info: fields => logs.push(fields), warn: fields => logs.push(fields) },
    now: () => clock,
    downloadMedia,
  });
  async function message(id, input = 'Hai, apa kabar?', payload, remoteJid = 'person@s.whatsapp.net') {
    const msg = {
      key: { id, remoteJid, fromMe: false },
      messageTimestamp: Math.floor(clock / 1000),
      message: payload ?? { conversation: input },
    };
    await handler.handleUpsert(sock, { type: 'notify', messages: [msg] }, { isActive: () => active });
    return msg;
  }
  return { handler, current, sent, logs, message, advance: ms => { clock += ms; }, deactivate: () => { active = false; } };
}

test('accepted casual replies send text plus a quoted native WebP sticker without changing emoji or kaomoji', async () => {
  const h = harness();
  const msg = await h.message('casual');
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].content.text, 'Haii, senang ketemu kamu >.< 🌸');
  assert.ok(Buffer.isBuffer(h.sent[1].content.sticker));
  assert.equal(h.sent[1].content.sticker.toString('ascii', 0, 4), 'RIFF');
  assert.equal(h.sent[1].content.sticker.toString('ascii', 8, 12), 'WEBP');
  for (const sent of h.sent) {
    assert.equal(sent.jid, 'person@s.whatsapp.net');
    assert.equal(sent.options.quoted, msg);
  }
});

test('expanded reactions can be delivered as quoted native stickers', async () => {
  for (const stickerId of ['celebrate', 'thinking', 'hug', 'goodnight']) {
    const h = harness({ stickerId });
    const msg = await h.message(`expanded-${stickerId}`, 'Kirim stiker lucu dong');
    assert.equal(h.sent.length, 2, stickerId);
    assert.ok(Buffer.isBuffer(h.sent[1].content.sticker), stickerId);
    assert.equal(h.sent[1].options.quoted, msg);
  }
});

test('contextual stickers have a per-chat cooldown while ordinary replies and explicit requests continue', async () => {
  const h = harness();
  await h.message('first');
  h.advance(1_000);
  await h.message('second');
  await h.message('requested', 'Kirim stiker lucu dong');
  await h.message('other-chat', 'Hai', undefined, 'other@s.whatsapp.net');
  h.advance(120_000);
  await h.message('later');
  assert.equal(h.sent.filter(sent => sent.content.text).length, 5);
  assert.equal(h.sent.filter(sent => sent.content.sticker).length, 4);
});

test('sticker-only responses still deliver one useful message when the contextual cooldown suppresses media', async () => {
  const h = harness({ text: '' });
  await h.message('sticker-only');
  await h.message('too-soon');
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent[0].content.sticker);
  assert.ok(h.sent[1].content.text);
});

test('off and on-request sticker modes are enforced on the outgoing transport', async () => {
  const off = harness({ mode: 'off' });
  await off.message('off', 'Kirim stiker dong');
  assert.equal(off.sent.length, 1);
  assert.ok(off.sent[0].content.text);
  const requested = harness({ mode: 'on-request' });
  await requested.message('casual');
  await requested.message('request', 'Send me a cute sticker please');
  assert.equal(requested.sent.filter(sent => sent.content.sticker).length, 1);
});

test('unrecognized sticker IDs never load files or produce a native sticker', async () => {
  for (const stickerId of ['../../secrets.env', 'https://example.com/a.webp', 'unknown']) {
    const h = harness({ stickerId });
    await h.message('bad-id', 'Kirim stiker');
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0].content.text);
  }
});

test('unaddressed group messages and duplicated upserts do not produce stickers', async () => {
  const h = harness();
  await h.message('ignored', 'Halo grup', undefined, 'group@g.us');
  assert.equal(h.sent.length, 0);
  const payload = { extendedTextMessage: { text: '@628000 hai', contextInfo: { mentionedJid: ['628000@s.whatsapp.net'] } } };
  const msg = await h.message('addressed', '', payload, 'group@g.us');
  assert.equal(h.sent.length, 2);
  await h.message('addressed', '', payload, 'group@g.us');
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].options.quoted, msg);
});

test('document replies do not send spontaneous reaction stickers', async () => {
  const h = harness({ downloadMedia: async () => ({ kind: 'document', mimeType: 'text/plain', fileName: 'fixture.txt', buffer: Buffer.from('Example') }) });
  await h.message('file', '', { documentMessage: { mimetype: 'text/plain', fileName: 'fixture.txt', caption: 'Ringkas file ini' } });
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0].content.text);
});

test('a failed sticker upload retains the sent text and logs only a safe failure category', async () => {
  const h = harness({ send: async content => { if (content.sticker) throw new Error('sensitive provider or chat data'); } });
  await h.message('upload-fails');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].content.text, 'Haii, senang ketemu kamu >.< 🌸');
  assert.ok(h.logs.some(log => log.event === 'sticker_reply_failed'));
  assert.equal(JSON.stringify(h.logs).includes('sensitive'), false);
  assert.equal(h.logs.some(log => log.event === 'message_failed'), false);
});

test('sticker-only upload failure returns a single fallback response', async () => {
  const h = harness({ text: '', stickerId: 'sad', send: async content => { if (content.sticker) throw new Error('upload failed'); } });
  await h.message('sticker-fails', 'Kirim stiker');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].content.text, '😢');
});

test('a disconnected socket cannot send a sticker after its text response completes', async () => {
  let h;
  h = harness({ send: async content => { if (content.text) h.deactivate(); } });
  await h.message('disconnect');
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0].content.text);
});

test('all built-in sticker assets decode as distinct transparent 512px WebP under 100 KB', async () => {
  const { loadSticker } = await import('../src/bot/stickerService.js');
  const hashes = new Set();
  const ids = [
    'hello', 'happy', 'shy', 'love', 'sad', 'cheer',
    'laugh', 'wink', 'hug', 'thanks', 'sorry', 'thinking',
    'confused', 'surprised', 'sleepy', 'goodnight', 'coffee', 'hungry',
    'celebrate', 'yes', 'no', 'waiting', 'angry', 'bye',
  ];
  for (const id of ids) {
    const buffer = await loadSticker(id);
    assert.ok(Buffer.isBuffer(buffer), `Missing reaction asset: ${id}`);
    assert.ok(buffer.length < 100_000);
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
    hashes.add(createHash('sha256').update(buffer).digest('hex'));
    const img = await loadImage(buffer);
    assert.equal(img.width, 512);
    assert.equal(img.height, 512);
    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    assert.equal(ctx.getImageData(0, 0, 1, 1).data[3], 0);
    assert.ok(ctx.getImageData(256, 256, 1, 1).data[3] > 0);
  }
  assert.equal(hashes.size, 24);
  assert.equal(await loadSticker('../secrets.env'), null);
});

test('the real HTTP AI client and incoming handler deliver a clean reply plus native media in one model request', async t => {
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ url: req.url, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Haii, aku baik >.< 🌸\n[[sticker:hello]]' } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); }));
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.ai, { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'synthetic-sticker-test-key', model: 'local-fixture-model' });
  Object.assign(settings.bot, { replyTrigger: 'mention-or-reply', typingIndicator: false });
  const repo = { get: () => structuredClone(settings) };
  const memory = new MemoryService();
  const aiService = new AIService({ settingsRepo: repo, memory });
  const handler = createMessageHandler({ settingsRepo: repo, aiService });
  t.after(() => handler.close());
  const sent = [];
  const sock = { user: { id: 'bot@s.whatsapp.net' }, async sendMessage(jid, content, options) { sent.push({ jid, content, options }); } };
  const msg = { key: { id: 'real-model-sticker', remoteJid: 'person@s.whatsapp.net' }, message: { conversation: 'Hai, apa kabar?' } };
  await handler.handleUpsert(sock, { type: 'notify', messages: [msg] });
  await handler.handleUpsert(sock, { type: 'notify', messages: [msg] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].body.messages.at(-1).content, 'Hai, apa kabar?');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].content.text, 'Haii, aku baik >.< 🌸');
  assert.ok(Buffer.isBuffer(sent[1].content.sticker));
  assert.equal(sent[1].content.sticker.toString('ascii', 8, 12), 'WEBP');
  assert.equal(sent[1].options.quoted, msg);
  assert.deepEqual(memory.get('person@s.whatsapp.net', 6), [
    { role: 'user', content: 'Hai, apa kabar?' },
    { role: 'assistant', content: 'Haii, aku baik >.< 🌸' },
  ]);
});
