import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { zipSync } from 'fflate';

import { createMessageHandler } from '../src/bot/messageHandler.js';
import { downloadImageMessage, downloadIncomingMedia } from '../src/bot/mediaService.js';
import { AIService } from '../src/services/aiService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { DEFAULT_SETTINGS } from '../src/storage/settingsRepo.js';

const logger = { info() {}, warn() {}, error() {} };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBP');
const MP4 = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function docx() {
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>PINEAPPLE fixture text</w:t></w:r></w:p></w:body></w:document>',
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, Buffer.from(text)]))));
}

async function harness(t) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'fixture answer' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.ai, { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-key', model: 'ag/gemini-3.8-flash-high' });
  Object.assign(settings.bot, { replyTrigger: 'mention-or-reply', typingIndicator: false });
  const repo = { get: () => structuredClone(settings) };
  const memory = new MemoryService();
  const service = new AIService({ settingsRepo: repo, memory, logger });
  const buffers = new Map();
  const downloads = [];
  const fakeStream = async msg => { downloads.push(msg.key.id); return Readable.from([buffers.get(msg.key.id)]); };
  const handler = createMessageHandler({
    settingsRepo: repo, aiService: service, logger,
    downloadImage: (sock, msg, options) => downloadImageMessage(sock, msg, { ...options, downloadMediaMessage: fakeStream }),
    downloadMedia: (msg, sock, options) => downloadIncomingMedia(msg, sock, { ...options, downloadMediaMessage: fakeStream }),
  });
  t.after(() => handler.close());
  const sock = { user: { id: 'bot@s.whatsapp.net' }, sent: [], async sendMessage(chatId, content, options) { this.sent.push({ chatId, ...content, quoted: options.quoted }); } };
  function message(id, key, buffer, mimeType, fileName, { group = false, contextInfo, caption, wrapped = false } = {}) {
    buffers.set(id, buffer);
    const media = { url: 'https://mmg.whatsapp.net/media.enc', fileLength: buffer.length, mimetype: mimeType, fileName, ...(caption ? { caption } : {}), ...(contextInfo ? { contextInfo } : {}) };
    const content = { [key]: media };
    return { key: { id, remoteJid: group ? 'group@g.us' : 'person@s.whatsapp.net', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), message: wrapped ? { documentWithCaptionMessage: { message: content } } : content };
  }
  return { handler, sock, requests, downloads, memory, message };
}

test('private captionless media traverses secured download, preparation and real HTTP AI client', async t => {
  const h = await harness(t);
  const cases = [
    ['image', 'imageMessage', PNG, 'image/png', 'photo.png', 'image_url'],
    ['sticker', 'stickerMessage', WEBP, 'image/webp', 'sticker.webp', 'image_url'],
    ['voice', 'audioMessage', Buffer.from('OggS fixture voice'), 'audio/ogg', 'voice.ogg', 'audio_url'],
    ['video', 'videoMessage', MP4, 'video/mp4', 'clip.mp4', 'image_url'],
    ['pdf', 'documentMessage', Buffer.from('%PDF-1.7\nfixture'), 'application/pdf', 'paper.pdf', 'image_url'],
    ['text', 'documentMessage', Buffer.from('PINEAPPLE fixture text'), 'text/plain', 'notes.txt', 'text'],
    ['office', 'documentMessage', docx(), DOCX_MIME, 'notes.docx', 'text'],
  ];
  for (const [id, key, bytes, mime, name, partType] of cases) {
    const msg = h.message(id, key, bytes, mime, name);
    await h.handler.handleUpsert(h.sock, { type: 'notify', messages: [msg] });
    const body = h.requests.at(-1);
    assert.equal(body.messages.at(-1).content[1].type, partType, id);
    assert.equal(h.sock.sent.at(-1).text, 'fixture answer', id);
    assert.equal(h.sock.sent.at(-1).quoted, msg);
  }
  assert.equal(h.requests.length, cases.length);
  assert.equal(h.downloads.length, cases.length);
  const history = JSON.stringify(h.memory.get('person@s.whatsapp.net', 6));
  assert.equal(history.includes('PINEAPPLE fixture text'), false);
  assert.equal(history.includes('base64'), false);
});

test('group documents require a bot tag or same-chat reply before download and provider dispatch', async t => {
  const h = await harness(t);
  const bytes = docx();
  const unaddressed = h.message('ordinary', 'documentMessage', bytes, DOCX_MIME, 'notes.docx', { group: true });
  const otherReply = h.message('other', 'documentMessage', bytes, DOCX_MIME, 'notes.docx', { group: true, contextInfo: { stanzaId: 'other-message', participant: 'other@s.whatsapp.net' } });
  const tagged = h.message('tagged', 'documentMessage', bytes, DOCX_MIME, 'notes.docx', { group: true, wrapped: true, caption: '@bot summarize', contextInfo: { mentionedJid: ['bot@s.whatsapp.net'] } });
  const replied = h.message('replied', 'audioMessage', Buffer.from('OggS fixture'), 'audio/ogg', 'voice.ogg', { group: true, contextInfo: { stanzaId: 'bot-message', participant: 'bot@s.whatsapp.net', remoteJid: 'group@g.us' } });
  await h.handler.handleUpsert(h.sock, { type: 'notify', messages: [unaddressed, otherReply, tagged, replied] });

  assert.deepEqual(h.downloads, ['tagged', 'replied']);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].messages.at(-1).content[0].text, 'summarize');
  assert.match(h.requests[0].messages.at(-1).content[1].text, /PINEAPPLE fixture text/);
  assert.equal(h.requests[1].messages.at(-1).content[1].type, 'audio_url');
  assert.equal(h.sock.sent.length, 2);
});

test('unsupported binary files produce a clear quoted response without contacting the AI', async t => {
  const h = await harness(t);
  const msg = h.message('unsupported', 'documentMessage', Buffer.from('MZ executable fixture'), 'application/octet-stream', 'program.exe');
  await h.handler.handleUpsert(h.sock, { type: 'notify', messages: [msg] });
  assert.equal(h.requests.length, 0);
  assert.equal(h.sock.sent.length, 1);
  assert.match(h.sock.sent[0].text, /executable.*cannot be processed/i);
  assert.equal(h.sock.sent[0].quoted, msg);
  assert.deepEqual(h.memory.get('person@s.whatsapp.net', 6), []);
});
