import assert from 'node:assert/strict';
import test from 'node:test';

let AttachmentContext;
try {
  ({ AttachmentContext } = await import('../src/services/attachmentContext.js'));
} catch {
  // The first TDD run intentionally exercises the contract before the module exists.
}

const PARTS = [{ type: 'text', text: 'bounded extracted contents' }];
const MEMORY = '[document sent: notes.txt (text/plain, 26 bytes)]';

function options(overrides = {}) {
  return {
    history: [{ role: 'user', content: MEMORY }],
    scope: 'account-a',
    visionEnabled: true,
    mediaEnabled: true,
    ...overrides,
  };
}

test('constructor validates cache bounds and the injected clock', () => {
  assert.equal(typeof AttachmentContext, 'function');
  for (const config of [
    { maxBytes: 0 }, { maxBytes: 1.5 }, { maxChats: 0 }, { maxChats: 1.5 }, { ttlMs: 0 }, { ttlMs: Number.POSITIVE_INFINITY },
    { now: 1 }, { now: () => Number.NaN }, { now: () => -1 },
  ]) {
    assert.throws(() => new AttachmentContext(config), TypeError);
  }
});

test('set and get use defensive copies and count UTF-8 metadata bytes', () => {
  assert.equal(typeof AttachmentContext, 'function');
  const cache = new AttachmentContext();
  const parts = structuredClone(PARTS);
  assert.equal(cache.set('chat-a', { parts, memoryText: MEMORY, scope: 'account-a', control: 'media' }), true);
  parts[0].text = 'mutated after set';

  const first = cache.get('chat-a', options());
  assert.deepEqual(first, { parts: PARTS, memoryText: MEMORY });
  first.parts[0].text = 'mutated after get';
  assert.deepEqual(cache.get('chat-a', options()).parts, PARTS);
  assert.equal(cache.size, 1);
  assert.equal(cache.byteLength > Buffer.byteLength(MEMORY, 'utf8'), true);

  const ascii = new AttachmentContext();
  ascii.set('chat', { parts: [{ type: 'text', text: 'a' }], memoryText: 'm', scope: 's', control: 'media' });
  const unicode = new AttachmentContext();
  unicode.set('chat', { parts: [{ type: 'text', text: 'é' }], memoryText: 'm', scope: 's', control: 'media' });
  assert.equal(unicode.byteLength > ascii.byteLength, true);
});

test('get requires an exact user message in the current history window and invalidates misses', () => {
  const cache = new AttachmentContext();
  cache.set('chat-role', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.equal(cache.get('chat-role', options({ history: [{ role: 'assistant', content: MEMORY }] })), undefined);
  assert.equal(cache.size, 0);

  cache.set('chat-window', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.equal(cache.get('chat-window', options({ history: [{ role: 'user', content: `${MEMORY} old caption` }] })), undefined);
  assert.equal(cache.get('chat-window', options()), undefined);
});

test('expiry is measured from upload time and successful lookup does not extend TTL', () => {
  let time = 100;
  const cache = new AttachmentContext({ ttlMs: 10, now: () => time });
  cache.set('chat-a', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  time = 109;
  assert.deepEqual(cache.get('chat-a', options()).parts, PARTS);
  time = 110;
  assert.equal(cache.get('chat-a', options()), undefined);
  assert.equal(cache.size, 0);
});

test('scope and current feature controls invalidate inaccessible attachments', () => {
  const cache = new AttachmentContext();
  cache.set('scope', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.equal(cache.get('scope', options({ scope: 'account-b' })), undefined);

  cache.set('vision', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'vision' });
  assert.equal(cache.get('vision', options({ visionEnabled: false })), undefined);

  cache.set('media-default', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.deepEqual(cache.get('media-default', options({ mediaEnabled: undefined })).parts, PARTS);
  cache.set('media-off', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.equal(cache.get('media-off', options({ mediaEnabled: false })), undefined);
});

test('maxChats uses LRU order and total bytes evict the least recently used entry', () => {
  const byChats = new AttachmentContext({ maxChats: 2 });
  for (const chatId of ['a', 'b']) byChats.set(chatId, { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  byChats.get('a', options());
  byChats.set('c', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.equal(byChats.get('b', options()), undefined);
  assert.deepEqual(byChats.get('a', options()).parts, PARTS);
  assert.deepEqual(byChats.get('c', options()).parts, PARTS);

  const probeA = new AttachmentContext();
  probeA.set('a', { parts: [{ type: 'text', text: 'A'.repeat(40) }], memoryText: 'memory-a', scope: 'account-a', control: 'media' });
  const bytesA = probeA.byteLength;
  const probeB = new AttachmentContext();
  probeB.set('b', { parts: [{ type: 'text', text: 'B'.repeat(40) }], memoryText: 'memory-b', scope: 'account-a', control: 'media' });
  const bytesB = probeB.byteLength;
  const byBytes = new AttachmentContext({ maxBytes: bytesA + bytesB - 1 });
  assert.equal(byBytes.set('a', { parts: [{ type: 'text', text: 'A'.repeat(40) }], memoryText: 'memory-a', scope: 'account-a', control: 'media' }), true);
  assert.equal(byBytes.set('b', { parts: [{ type: 'text', text: 'B'.repeat(40) }], memoryText: 'memory-b', scope: 'account-a', control: 'media' }), true);
  assert.equal(byBytes.size, 1);
  assert.equal(byBytes.byteLength <= bytesA + bytesB - 1, true);
});

test('oversize replacement drops the prior chat entry and clear methods isolate chats', () => {
  const probe = new AttachmentContext();
  probe.set('chat-a', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  const cache = new AttachmentContext({ maxBytes: probe.byteLength });
  assert.equal(cache.set('chat-a', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' }), true);
  assert.equal(cache.set('chat-a', { parts: [{ type: 'text', text: 'x'.repeat(10_000) }], memoryText: MEMORY, scope: 'account-a', control: 'media' }), false);
  assert.equal(cache.get('chat-a', options()), undefined);

  const isolated = new AttachmentContext();
  isolated.set('chat-a', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  isolated.set('chat-b', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' });
  assert.equal(isolated.clear('chat-a'), true);
  assert.equal(isolated.get('chat-a', options()), undefined);
  assert.deepEqual(isolated.get('chat-b', options()).parts, PARTS);
  isolated.clearAll();
  assert.equal(isolated.size, 0);
  assert.equal(isolated.byteLength, 0);
});

test('set rejects non-JSON parts and invalid cache metadata', () => {
  const cache = new AttachmentContext();
  assert.throws(() => cache.set('', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'media' }), TypeError);
  assert.throws(() => cache.set('chat', { parts: [{ type: 'text', text: undefined }], memoryText: MEMORY, scope: 'account-a', control: 'media' }), TypeError);
  assert.throws(() => cache.set('chat', { parts: PARTS, memoryText: '', scope: 'account-a', control: 'media' }), TypeError);
  assert.throws(() => cache.set('chat', { parts: PARTS, memoryText: MEMORY, scope: '', control: 'media' }), TypeError);
  assert.throws(() => cache.set('chat', { parts: PARTS, memoryText: MEMORY, scope: 'account-a', control: 'other' }), TypeError);
});
