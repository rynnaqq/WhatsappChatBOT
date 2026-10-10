const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_CHATS = 100;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const CONTROLS = new Set(['vision', 'media', 'vision-and-media']);

export class AttachmentContext {
  #maxBytes;
  #maxChats;
  #ttlMs;
  #now;
  #entries = new Map();
  #byteLength = 0;

  constructor({ maxBytes = DEFAULT_MAX_BYTES, maxChats = DEFAULT_MAX_CHATS, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
    assertPositiveInteger(maxBytes, 'maxBytes');
    assertPositiveInteger(maxChats, 'maxChats');
    assertPositiveInteger(ttlMs, 'ttlMs');
    if (typeof now !== 'function') throw new TypeError('now must be a function.');
    this.#maxBytes = maxBytes;
    this.#maxChats = maxChats;
    this.#ttlMs = ttlMs;
    this.#now = now;
    this.#time();
  }

  set(chatId, { parts, memoryText, scope, control } = {}) {
    const id = assertNonemptyString(chatId, 'chatId');
    if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('parts must be a nonempty JSON-compatible array.');
    const clonedParts = cloneJson(parts, 'parts');
    const remembered = assertNonemptyString(memoryText, 'memoryText');
    const scopedTo = assertNonemptyString(scope, 'scope');
    if (!CONTROLS.has(control)) throw new TypeError('control must be vision, media, or vision-and-media.');
    const createdAt = this.#time();
    const bytes = Buffer.byteLength(JSON.stringify({ chatId: id, parts: clonedParts, memoryText: remembered, scope: scopedTo, control }), 'utf8');

    this.#sweep(createdAt);
    this.#remove(id);
    if (bytes > this.#maxBytes) return false;

    while (this.#entries.size >= this.#maxChats || this.#byteLength + bytes > this.#maxBytes) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#remove(oldest);
    }

    this.#entries.set(id, {
      parts: clonedParts,
      memoryText: remembered,
      scope: scopedTo,
      control,
      createdAt,
      expiresAt: createdAt + this.#ttlMs,
      bytes,
    });
    this.#byteLength += bytes;
    return true;
  }

  get(chatId, { history, scope, visionEnabled, mediaEnabled } = {}) {
    const id = assertNonemptyString(chatId, 'chatId');
    const currentTime = this.#time();
    this.#sweep(currentTime);
    const entry = this.#entries.get(id);
    if (!entry) return undefined;

    const presentInWindow = Array.isArray(history) && history.some((message) => (
      isPlainObject(message) && message.role === 'user' && message.content === entry.memoryText
    ));
    const controlEnabled = (entry.control === 'media' || visionEnabled === true)
      && (entry.control === 'vision' || mediaEnabled !== false);
    if (scope !== entry.scope || !presentInWindow || !controlEnabled) {
      this.#remove(id);
      return undefined;
    }

    this.#entries.delete(id);
    this.#entries.set(id, entry);
    return { parts: cloneJson(entry.parts, 'parts'), memoryText: entry.memoryText };
  }

  clear(chatId) {
    return this.#remove(assertNonemptyString(chatId, 'chatId'));
  }

  clearAll() {
    this.#entries.clear();
    this.#byteLength = 0;
  }

  get size() {
    this.#sweep(this.#time());
    return this.#entries.size;
  }

  get byteLength() {
    this.#sweep(this.#time());
    return this.#byteLength;
  }

  #sweep(currentTime) {
    for (const [chatId, entry] of this.#entries) {
      if (currentTime >= entry.expiresAt) this.#remove(chatId);
    }
  }

  #remove(chatId) {
    const entry = this.#entries.get(chatId);
    if (!entry) return false;
    this.#entries.delete(chatId);
    this.#byteLength -= entry.bytes;
    return true;
  }

  #time() {
    const value = this.#now();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('now must return a finite nonnegative number.');
    return value;
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
}

function assertNonemptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a nonempty string.`);
  return value;
}

function cloneJson(value, name) {
  validateJson(value, name, new Set());
  return JSON.parse(JSON.stringify(value));
}

function validateJson(value, name, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new TypeError(`${name} must contain only finite JSON numbers.`);
  }
  if (typeof value !== 'object') throw new TypeError(`${name} must be JSON-compatible.`);
  if (ancestors.has(value)) throw new TypeError(`${name} must not contain cycles.`);
  const plain = Array.isArray(value) || isPlainObject(value);
  if (!plain || Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${name} must be JSON-compatible.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, name, ancestors);
  } else {
    for (const item of Object.values(value)) validateJson(item, name, ancestors);
  }
  ancestors.delete(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
