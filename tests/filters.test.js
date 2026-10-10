import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageHandler } from '../src/bot/messageHandler.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function settings(overrides = {}) {
  return {
    ai: {
      visionEnabled: true,
      mediaEnabled: true,
      maxImageMB: 5,
      maxFileMB: 10,
      timeoutSeconds: 60,
      ...overrides.ai,
    },
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

function socket(overrides = {}) {
  const sock = {
    user: { id: 'bot:2@s.whatsapp.net' },
    sent: [],
    presence: [],
    read: [],
    async sendMessage(jid, content, options) { this.sent.push({ jid, content, options }); },
    async sendPresenceUpdate(value, jid) { this.presence.push([value, jid]); },
    async readMessages(keys) { this.read.push(keys); },
  };
  return Object.assign(sock, overrides);
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
    downloadMedia: overrides.downloadMedia,
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
      message('contact', '', { payload: { contactMessage: { displayName: 'no' } } }),
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

test('mention-or-reply mode ignores ordinary and prefixed group text while legacy prefix mode remains available', async () => {
  const mentionMode = harness({
    settings: settings({ bot: { commandPrefix: '!', replyTrigger: 'mention-or-reply' } }),
  });
  await mentionMode.handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [
      message('ordinary', 'hello', { remoteJid: 'group-1@g.us' }),
      message('prefixed', '!hello', { remoteJid: 'group-1@g.us' }),
    ],
  });
  assert.equal(mentionMode.calls.length, 0);
  mentionMode.handler.close();

  for (const replyTrigger of [undefined, 'unexpected']) {
    const prefixMode = harness({
      settings: settings({ bot: { commandPrefix: '!', replyTrigger } }),
    });
    await prefixMode.handler.handleUpsert(socket(), {
      type: 'notify',
      messages: [message(`legacy-${String(replyTrigger)}`, '!hello')],
    });
    assert.deepEqual(prefixMode.calls.map(({ text }) => text), ['hello']);
    prefixMode.handler.close();
  }
});

test('mention-or-reply mode answers plain PN and LID private messages without a prefix or reply metadata', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { commandPrefix: '!', replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket();
  const incoming = [
    message('plain-private', 'hello'),
    message('lid-private', 'apa kabar?', { remoteJid: '70000001@lid' }),
    message('extended-private', '', { payload: { extendedTextMessage: { text: 'tell me more' } } }),
    message('literal-prefix-private', '!hello'),
    message('other-author-private', '', {
      payload: {
        extendedTextMessage: {
          text: 'explain this message',
          contextInfo: { stanzaId: 'other-message', participant: 'other@s.whatsapp.net' },
        },
      },
    }),
  ];
  await handler.handleUpsert(sock, { type: 'notify', messages: incoming });

  assert.deepEqual(calls.map(({ chatId, text }) => ({ chatId, text })), [
    { chatId: 'person@s.whatsapp.net', text: 'hello' },
    { chatId: '70000001@lid', text: 'apa kabar?' },
    { chatId: 'person@s.whatsapp.net', text: 'tell me more' },
    { chatId: 'person@s.whatsapp.net', text: '!hello' },
    { chatId: 'person@s.whatsapp.net', text: 'explain this message' },
  ]);
  assert.equal(sock.sent.length, 5);
  assert.deepEqual(new Set(sock.sent.map(({ options }) => options.quoted.key.id)), new Set(incoming.map(({ key }) => key.id)));
  handler.close();
});

test('plain private text does not need a linked identity while groups still fail closed without one', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket({ user: undefined });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('private-no-identity', 'hello'),
      message('group-no-identity', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: { text: '@bot hello', contextInfo: { mentionedJid: ['bot@s.whatsapp.net'] } },
        },
      }),
    ],
  });

  assert.deepEqual(calls.map(({ chatId, text }) => ({ chatId, text })), [
    { chatId: 'person@s.whatsapp.net', text: 'hello' },
  ]);
  assert.equal(sock.sent.length, 1);
  handler.close();
});

test('private captioned and captionless images need no trigger while unaddressed group images are ignored', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { commandPrefix: '!', replyTrigger: 'mention-or-reply' } }),
    downloadImage: async () => ({ buffer: Buffer.from('image'), mimeType: 'image/jpeg' }),
  });
  await handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [
      message('private-caption', '', { payload: { imageMessage: { caption: 'what is this?' } } }),
      message('private-no-caption', '', { payload: { imageMessage: {} } }),
      message('group-no-caption', '', { remoteJid: 'group-1@g.us', payload: { imageMessage: {} } }),
    ],
  });

  assert.deepEqual(calls.map(({ text, mimeType }) => ({ text, mimeType })), [
    { text: 'what is this?', mimeType: 'image/jpeg' },
    { text: 'Describe this image.', mimeType: 'image/jpeg' },
  ]);
  handler.close();
});

test('private audio, video, PTV, document, and sticker messages reach AI as bounded attachments', async () => {
  const attachments = {
    audio: { kind: 'audio', buffer: Buffer.from('audio'), mimeType: 'audio/ogg', fileName: 'voice.ogg' },
    video: { kind: 'video', buffer: Buffer.from('video'), mimeType: 'video/mp4', fileName: 'video.mp4' },
    ptv: { kind: 'video', buffer: Buffer.from('ptv'), mimeType: 'video/mp4', fileName: 'video.mp4' },
    document: { kind: 'document', buffer: Buffer.from('document'), mimeType: 'application/pdf', fileName: 'report.pdf' },
    sticker: { kind: 'sticker', buffer: Buffer.from('sticker'), mimeType: 'image/webp', fileName: 'sticker.webp' },
  };
  const downloaded = [];
  const { handler, calls } = harness({
    settings: settings({ ai: { maxImageMB: 4, maxFileMB: 7 } }),
    downloadMedia: async (msg, _sock, options) => {
      downloaded.push({ id: msg.key.id, options });
      return attachments[msg.key.id];
    },
  });
  await handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [
      message('audio', '', { payload: { audioMessage: { ptt: true } } }),
      message('video', '', { payload: { videoMessage: { caption: 'review this clip' } } }),
      message('ptv', '', { payload: { ptvMessage: {} } }),
      message('document', '', { payload: { documentMessage: { caption: 'summarize the report' } } }),
      message('sticker', '', { payload: { stickerMessage: {} } }),
    ],
  });

  assert.deepEqual(calls.map(({ text, attachment }) => ({ text, attachment })), [
    { text: 'Transcribe this audio.', attachment: attachments.audio },
    { text: 'review this clip', attachment: attachments.video },
    { text: 'Describe this video.', attachment: attachments.ptv },
    { text: 'summarize the report', attachment: attachments.document },
    { text: 'Describe this sticker.', attachment: attachments.sticker },
  ]);
  assert.deepEqual(downloaded.map(({ id, options }) => ({ id, maxBytes: options.maxBytes })), [
    { id: 'audio', maxBytes: 7 * 1024 * 1024 },
    { id: 'video', maxBytes: 7 * 1024 * 1024 },
    { id: 'ptv', maxBytes: 7 * 1024 * 1024 },
    { id: 'document', maxBytes: 7 * 1024 * 1024 },
    { id: 'sticker', maxBytes: 4 * 1024 * 1024 },
  ]);
  assert.equal(downloaded.every(({ options }) => options.timeoutMs === 60_000), true);
  handler.close();
});

test('all attachment contexts route addressed groups and skip unaddressed media before download', async () => {
  const downloaded = [];
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
    downloadMedia: async (msg) => {
      downloaded.push(msg.key.id);
      const kind = msg.key.id.startsWith('document') ? 'document'
        : msg.key.id.startsWith('sticker') ? 'sticker'
          : msg.key.id.startsWith('audio') ? 'audio' : 'video';
      return { kind, buffer: Buffer.from(kind), mimeType: kind === 'document' ? 'application/pdf' : `${kind}/test`, fileName: `${kind}.bin` };
    },
  });
  const sock = socket({ user: { id: '15550001@s.whatsapp.net' } });
  const addressed = { mentionedJid: ['15550001@s.whatsapp.net'] };
  const payloads = [
    ['audio-tagged', { audioMessage: { contextInfo: addressed } }],
    ['video-tagged', { videoMessage: { contextInfo: addressed } }],
    ['video-ptv-tagged', { ptvMessage: { contextInfo: addressed } }],
    ['document-tagged', { documentWithCaptionMessage: { message: { documentMessage: { contextInfo: addressed } } } }],
    ['sticker-tagged', { ephemeralMessage: { message: { stickerMessage: { contextInfo: addressed } } } }],
    ['audio-unaddressed', { audioMessage: {} }],
  ];
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: payloads.map(([id, payload]) => message(id, '', { remoteJid: 'group-1@g.us', payload })),
  });

  assert.deepEqual(downloaded, ['audio-tagged', 'video-tagged', 'video-ptv-tagged', 'document-tagged', 'sticker-tagged']);
  assert.equal(calls.length, 5);
  assert.equal(sock.sent.length, 5);
  handler.close();
});

test('disabled media settings reject before download or AI inference', async () => {
  let downloads = 0;
  const { handler, calls } = harness({
    settings: settings({ ai: { visionEnabled: false, mediaEnabled: false } }),
    downloadImage: async () => { downloads += 1; throw new Error('must not run'); },
    downloadMedia: async () => { downloads += 1; throw new Error('must not run'); },
  });
  const sock = socket();
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('disabled-image', '', { payload: { imageMessage: {} } }),
      message('disabled-sticker', '', { payload: { stickerMessage: {} } }),
      message('disabled-audio', '', { payload: { audioMessage: {} } }),
      message('disabled-document', '', { payload: { documentMessage: {} } }),
    ],
  });

  assert.equal(downloads, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(sock.sent.map(({ content }) => content.text), [
    'Image messages are disabled.',
    'Image messages are disabled.',
    'File messages are disabled.',
    'File messages are disabled.',
  ]);
  handler.close();
});

test('image documents use vision enablement and the image byte limit', async () => {
  const attachment = {
    kind: 'document', buffer: Buffer.from('png'), mimeType: 'image/png', fileName: 'diagram.png',
  };
  let downloadOptions;
  const { handler, calls } = harness({
    settings: settings({
      ai: { visionEnabled: true, mediaEnabled: false, maxImageMB: 2, maxFileMB: 9 },
    }),
    downloadMedia: async (_msg, _sock, options) => { downloadOptions = options; return attachment; },
  });

  await handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [message('image-document', '', {
      payload: { documentMessage: { mimetype: 'image/png', fileName: 'diagram.png' } },
    })],
  });

  assert.equal(downloadOptions.maxBytes, 2 * 1024 * 1024);
  assert.deepEqual(calls.map(({ attachment: value }) => value), [attachment]);
  handler.close();
});

test('disabled vision rejects image documents before download even when general media is enabled', async () => {
  let downloaded = false;
  const { handler, calls } = harness({
    settings: settings({ ai: { visionEnabled: false, mediaEnabled: true } }),
    downloadMedia: async () => { downloaded = true; throw new Error('must not run'); },
  });
  const sock = socket();

  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [message('disabled-image-document', '', {
      payload: { documentMessage: { mimetype: 'image/png', fileName: 'diagram.png' } },
    })],
  });

  assert.equal(downloaded, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(sock.sent.map(({ content }) => content.text), ['Image messages are disabled.']);
  handler.close();
});

test('document-with-caption preserves prefix compatibility and its caption text', async () => {
  const attachment = { kind: 'document', buffer: Buffer.from('doc'), mimeType: 'application/pdf', fileName: 'doc.pdf' };
  const downloaded = [];
  const { handler, calls } = harness({
    settings: settings({ bot: { commandPrefix: '!ask' } }),
    downloadMedia: async (msg) => { downloaded.push(msg.key.id); return attachment; },
  });
  await handler.handleUpsert(socket(), {
    type: 'notify',
    messages: [
      message('no-prefix-document', '', { payload: { documentMessage: { caption: 'ignore' } } }),
      message('prefixed-document', '', {
        payload: { documentWithCaptionMessage: { message: { documentMessage: { caption: '!ask summarize this' } } } },
      }),
    ],
  });

  assert.deepEqual(downloaded, ['prefixed-document']);
  assert.deepEqual(calls.map(({ text, attachment: value }) => ({ text, attachment: value })), [
    { text: 'summarize this', attachment },
  ]);
  handler.close();
});

test('automatic private replies still ignore empty text, self messages, history, and stale messages', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket();
  await handler.handleUpsert(sock, { type: 'append', messages: [message('private-history', 'hello')] });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('private-empty', ''),
      message('private-whitespace', '   '),
      message('private-from-me', 'hello', { key: { fromMe: true } }),
      message('private-self', 'hello', { remoteJid: 'bot@s.whatsapp.net' }),
      message('private-stale', 'hello', { messageTimestamp: Math.floor(Date.now() / 1000) - 180 }),
    ],
  });

  assert.equal(calls.length, 0);
  assert.equal(sock.sent.length, 0);
  handler.close();
});

test('group bot PN and LID mentions accept device variants and remove only exact bot mention tokens', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket({
    user: { id: '15550001:2@s.whatsapp.net', lid: '99880001:7@lid', phoneNumber: '15550001@s.whatsapp.net' },
  });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('pn-tag', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: '@15550001 explain this to @22220000 and keep @155500012',
            contextInfo: { mentionedJid: ['15550001:9@s.whatsapp.net', '22220000@s.whatsapp.net'] },
          },
        },
      }),
      message('lid-tag', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: 'compare this @99880001',
            contextInfo: { mentionedJid: ['99880001:4@lid'] },
          },
        },
      }),
      message('numeric-collision', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: '@15550001 should not match a LID user',
            contextInfo: { mentionedJid: ['15550001@lid'] },
          },
        },
      }),
      message('lid-meta-pn-text', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: '@15550001 bridge aliases but preserve @22220000',
            contextInfo: { mentionedJid: ['99880001@lid', '22220000@s.whatsapp.net'] },
          },
        },
      }),
      message('pn-meta-lid-text', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: 'bridge the other way @99880001',
            contextInfo: { mentionedJid: ['15550001@s.whatsapp.net'] },
          },
        },
      }),
      message('other-pn-shares-bot-lid-local', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: '@15550001 explain this to @99880001',
            contextInfo: { mentionedJid: ['15550001@s.whatsapp.net', '99880001@s.whatsapp.net'] },
          },
        },
      }),
      message('other-lid-shares-bot-pn-local', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: '@99880001 explain this to @15550001',
            contextInfo: { mentionedJid: ['99880001@lid', '15550001@lid'] },
          },
        },
      }),
    ],
  });

  assert.deepEqual(calls.map(({ text }) => text), [
    'explain this to @22220000 and keep @155500012',
    'compare this',
    'bridge aliases but preserve @22220000',
    'bridge the other way',
    'explain this to @99880001',
    'explain this to @15550001',
  ]);
  handler.close();
});

test('replies to bot messages work in groups and direct chats without requiring quotedMessage', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket({ user: { id: '15550001:2@s.whatsapp.net', lid: '99880001@lid' } });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('group-reply', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          extendedTextMessage: {
            text: 'group question',
            contextInfo: {
              stanzaId: 'bot-group-message',
              participant: '99880001:3@lid',
              remoteJid: 'group-1@g.us',
            },
          },
        },
      }),
      message('direct-reply', '', {
        remoteJid: 'person@s.whatsapp.net',
        payload: {
          extendedTextMessage: {
            text: 'direct question',
            contextInfo: {
              stanzaId: 'bot-direct-message',
              participant: '15550001@s.whatsapp.net',
              remoteJid: 'person:8@c.us',
            },
          },
        },
      }),
      message('plain-reply-keeps-tag-looking-text', '', {
        payload: {
          extendedTextMessage: {
            text: 'keep @15550001 because this is not a mention',
            contextInfo: {
              stanzaId: 'bot-plain-reply',
              participant: '15550001@s.whatsapp.net',
            },
          },
        },
      }),
    ],
  });

  assert.deepEqual(calls.map(({ chatId, text }) => ({ chatId, text })), [
    { chatId: 'group-1@g.us', text: 'group question' },
    { chatId: 'person@s.whatsapp.net', text: 'direct question' },
    { chatId: 'person@s.whatsapp.net', text: 'keep @15550001 because this is not a mention' },
  ]);
  handler.close();
});

test('private replies stay eligible across incoming PN and LID addressing aliases', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket({ user: { id: '15550001@s.whatsapp.net', lid: '99880001@lid' } });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('lid-chat-pn-quote', '', {
        remoteJid: '70000001@lid',
        key: { remoteJidAlt: '17770000001@s.whatsapp.net' },
        payload: {
          extendedTextMessage: {
            text: 'PN quote metadata in a LID chat',
            contextInfo: {
              stanzaId: 'bot-pn-quote',
              participant: '15550001@s.whatsapp.net',
              remoteJid: '17770000001@s.whatsapp.net',
            },
          },
        },
      }),
      message('pn-chat-lid-quote', '', {
        remoteJid: '17770000002@s.whatsapp.net',
        key: { remoteJidAlt: '70000002@lid' },
        payload: {
          extendedTextMessage: {
            text: 'LID quote metadata in a PN chat',
            contextInfo: {
              stanzaId: 'bot-lid-quote',
              participant: '99880001@lid',
              remoteJid: '70000002@lid',
            },
          },
        },
      }),
    ],
  });

  assert.deepEqual(calls.map(({ chatId, text }) => ({ chatId, text })), [
    { chatId: '70000001@lid', text: 'PN quote metadata in a LID chat' },
    { chatId: '17770000002@s.whatsapp.net', text: 'LID quote metadata in a PN chat' },
  ]);
  handler.close();
});

test('group reply metadata fails closed for other authors, incoming participantAlt, cross-chat quotes, and malformed context', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket({ user: { id: '15550001@s.whatsapp.net', lid: '99880001@lid' } });
  const reply = (contextInfo) => ({ extendedTextMessage: { text: 'ignore me', contextInfo } });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('other-author', '', { remoteJid: 'group-1@g.us', payload: reply({ stanzaId: 'quoted', participant: 'other@s.whatsapp.net' }) }),
      message('participant-alt', '', {
        remoteJid: 'group-1@g.us',
        payload: reply({ stanzaId: 'quoted', participant: 'other@s.whatsapp.net', participantAlt: '15550001@s.whatsapp.net' }),
      }),
      message('reply-numeric-collision', '', {
        remoteJid: 'group-1@g.us',
        payload: reply({ stanzaId: 'quoted', participant: '15550001@lid' }),
      }),
      message('cross-chat', '', {
        remoteJid: 'group-1@g.us',
        key: { remoteJidAlt: 'group-2@g.us' },
        payload: reply({ stanzaId: 'quoted', participant: '15550001@s.whatsapp.net', remoteJid: 'group-2@g.us' }),
      }),
      message('missing-stanza', '', { remoteJid: 'group-1@g.us', payload: reply({ participant: '15550001@s.whatsapp.net' }) }),
      message('missing-participant', '', { remoteJid: 'group-1@g.us', payload: reply({ stanzaId: 'quoted' }) }),
    ],
  });

  assert.equal(calls.length, 0);
  handler.close();
});

test('linked bot aliases can come from persisted auth credentials when socket.user is unavailable', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const sock = socket({
    user: undefined,
    authState: {
      creds: { me: { id: '15550001:2@s.whatsapp.net', lid: '99880001:7@lid' } },
    },
  });
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [message('auth-state-tag', '', {
      remoteJid: 'group-1@g.us',
      payload: {
        extendedTextMessage: {
          text: '@99880001 use saved identity',
          contextInfo: { mentionedJid: ['99880001@lid'] },
        },
      },
    })],
  });

  assert.deepEqual(calls.map(({ text }) => text), ['use saved identity']);
  handler.close();
});

test('group tag-only text is ignored but addressed captionless images use the image default', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
    downloadImage: async () => ({ buffer: Buffer.from('image'), mimeType: 'image/jpeg' }),
  });
  const sock = socket({ user: { id: '15550001@s.whatsapp.net' } });
  const taggedContext = { mentionedJid: ['15550001@s.whatsapp.net'] };
  await handler.handleUpsert(sock, {
    type: 'notify',
    messages: [
      message('tag-only', '', {
        remoteJid: 'group-1@g.us',
        payload: { extendedTextMessage: { text: '@15550001', contextInfo: taggedContext } },
      }),
      message('wrapped-image', '', {
        remoteJid: 'group-1@g.us',
        payload: {
          ephemeralMessage: {
            message: { viewOnceMessageV2: { message: { imageMessage: { contextInfo: taggedContext } } } },
          },
        },
      }),
    ],
  });

  assert.deepEqual(calls.map(({ text, mimeType }) => ({ text, mimeType })), [
    { text: 'Describe this image.', mimeType: 'image/jpeg' },
  ]);
  handler.close();
});

test('group addressing fails closed when the linked bot identity is absent or malformed', async () => {
  const { handler, calls } = harness({
    settings: settings({ bot: { replyTrigger: 'mention-or-reply' } }),
  });
  const payload = {
    extendedTextMessage: {
      text: '@15550001 hello',
      contextInfo: { mentionedJid: ['15550001@s.whatsapp.net'] },
    },
  };
  await handler.handleUpsert(socket({ user: undefined }), {
    type: 'notify',
    messages: [message('no-identity', '', { remoteJid: 'group-1@g.us', payload })],
  });
  await handler.handleUpsert(socket({ user: { id: 'malformed' } }), {
    type: 'notify',
    messages: [message('bad-identity', '', { remoteJid: 'group-1@g.us', payload })],
  });

  assert.equal(calls.length, 0);
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
