import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';

import { ensurePrivateDirectory, SerializedQueue, writeJsonAtomic } from './jsonStore.js';

export const MASKED_API_KEY = '********';

export const DEFAULT_SETTINGS = Object.freeze({
  ai: Object.freeze({
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 512,
    visionEnabled: true,
    mediaEnabled: true,
    attachmentTransport: 'auto',
    timeoutSeconds: 60,
    maxImageMB: 5,
    maxFileMB: 10,
  }),
  bot: Object.freeze({
    systemPrompt: [
      'You are a friendly conversational assistant chatting with the user on WhatsApp.',
      "Reply directly in the user's language and match their tone. Use natural, everyday wording. For casual Indonesian, use relaxed Indonesian. For a greeting, give a short, friendly greeting or check-in. Usually keep casual replies to one to three short sentences; give more detail when requested or needed to answer.",
      'Only include the answer meant for the user. Do not append unsolicited work summaries, task statuses, skipped/done notes, internal commentary, or notes about unimplemented work. Do not assume the user wants to build software. Offer coding or project help when they ask for it.',
      'When a request is unclear, ask one relevant question. Be honest about your abilities; do not claim you ran tools, edited files, or performed actions unless those actions actually happened.',
    ].join('\n'),
    replyTrigger: 'prefix',
    commandPrefix: '!',
    memoryLimit: 6,
    privateChatsOnly: false,
    groupRepliesEnabled: true,
    typingIndicator: true,
    maxMessageAgeSeconds: 120,
    markRead: false,
    rateLimitPerMinute: 20,
  }),
  version: 1,
});

const ROOT_KEYS = new Set(['ai', 'bot', 'version']);
const AI_KEYS = new Set([
  'baseURL', 'apiKey', 'model', 'temperature', 'maxTokens', 'visionEnabled',
  'mediaEnabled', 'attachmentTransport', 'timeoutSeconds', 'maxImageMB', 'maxFileMB',
]);
const BOT_KEYS = new Set([
  'systemPrompt', 'replyTrigger', 'commandPrefix', 'memoryLimit', 'privateChatsOnly',
  'groupRepliesEnabled', 'typingIndicator', 'maxMessageAgeSeconds', 'markRead',
  'rateLimitPerMinute',
]);

export class SettingsValidationError extends Error {
  constructor(fields) {
    super('Settings validation failed.');
    this.name = 'SettingsValidationError';
    this.fields = { ...fields };
  }
}

export class SettingsRepo {
  #filePath;
  #encryptionKey;
  #logger;
  #maxTokensCeiling;
  #queue = new SerializedQueue();
  #settings = clone(DEFAULT_SETTINGS);
  #subscribers = new Set();

  constructor({ storageDir, encryptionSecret, logger, maxTokensCeiling = 32768 }) {
    if (!storageDir) throw new TypeError('storageDir is required.');
    if (typeof encryptionSecret !== 'string' || encryptionSecret.length === 0) {
      throw new TypeError('encryptionSecret is required.');
    }
    if (!Number.isInteger(maxTokensCeiling) || maxTokensCeiling < 1) {
      throw new TypeError('maxTokensCeiling must be a positive integer.');
    }
    this.#filePath = path.join(storageDir, 'settings.json');
    this.#encryptionKey = createHash('sha256').update(encryptionSecret).digest();
    this.#logger = logger ?? {};
    this.#maxTokensCeiling = maxTokensCeiling;
  }

  async init() {
    return this.#queue.run(async () => {
      await ensurePrivateDirectory(path.dirname(this.#filePath));
      let source;
      try {
        source = await readFile(this.#filePath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        this.#settings = clone(DEFAULT_SETTINGS);
        this.#logger.warn?.({ event: 'settings_missing' }, 'Settings file is missing; using defaults.');
        return this.get();
      }

      try {
        const parsed = JSON.parse(source);
        const decrypted = this.#decryptStoredKey(parsed);
        this.#settings = validateAndNormalize(decrypted, {
          maxTokensCeiling: this.#maxTokensCeiling,
          allowEmptyApiKey: true,
          additionsOptional: true,
        });
      } catch (error) {
        const backupPath = await this.#backupInvalidFile();
        this.#settings = clone(DEFAULT_SETTINGS);
        this.#logger.warn?.(
          { event: 'settings_invalid', backupPath, reason: safeReason(error) },
          'Settings file is invalid; using defaults.',
        );
      }
      return this.get();
    });
  }

  get() {
    return clone(this.#settings);
  }

  getPublic() {
    const settings = this.get();
    settings.ai.apiKey = settings.ai.apiKey ? MASKED_API_KEY : '';
    return settings;
  }

  async save(fullPayload) {
    return this.#queue.run(async () => {
      const payload = clonePayload(fullPayload);
      if (payload?.ai?.apiKey === MASKED_API_KEY) {
        payload.ai.apiKey = this.#settings.ai.apiKey;
      }
      const settings = validateAndNormalize(payload, {
        maxTokensCeiling: this.#maxTokensCeiling,
        allowEmptyApiKey: false,
        additionsOptional: true,
      });
      const persisted = clone(settings);
      persisted.ai.apiKey = this.#encryptKey(settings.ai.apiKey);
      await writeJsonAtomic(this.#filePath, persisted);
      this.#settings = settings;
      const publicSettings = this.getPublic();
      for (const subscriber of this.#subscribers) {
        try {
          subscriber(clone(publicSettings));
        } catch (error) {
          this.#logger.error?.(
            { event: 'settings_subscriber_failed', reason: safeReason(error) },
            'A settings subscriber failed.',
          );
        }
      }
      return clone(publicSettings);
    });
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function.');
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #encryptKey(apiKey) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    return {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  #decryptStoredKey(settings) {
    if (!isPlainObject(settings) || !isPlainObject(settings.ai)) return settings;
    const storedKey = settings.ai.apiKey;
    if (typeof storedKey === 'string') return settings;
    if (!isPlainObject(storedKey) || storedKey.algorithm !== 'aes-256-gcm') {
      throw new Error('Unsupported encrypted API key.');
    }
    const iv = decodeBase64(storedKey.iv);
    const tag = decodeBase64(storedKey.tag);
    const ciphertext = decodeBase64(storedKey.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', this.#encryptionKey, iv);
    decipher.setAuthTag(tag);
    const apiKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return { ...settings, ai: { ...settings.ai, apiKey } };
  }

  async #backupInvalidFile() {
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    let suffix = 0;
    while (true) {
      const unique = suffix === 0 ? '' : `-${suffix}`;
      const backupPath = `${this.#filePath}.invalid-${timestamp}${unique}`;
      try {
        await rename(this.#filePath, backupPath);
        return backupPath;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        suffix += 1;
      }
    }
  }
}

function validateAndNormalize(input, { maxTokensCeiling, allowEmptyApiKey, additionsOptional }) {
  const fields = {};
  if (!isPlainObject(input)) throw new SettingsValidationError({ settings: 'Must be an object.' });
  addUnknownFields(fields, input, ROOT_KEYS, '');

  const ai = isPlainObject(input.ai) ? input.ai : {};
  const bot = isPlainObject(input.bot) ? input.bot : {};
  if (!isPlainObject(input.ai)) fields.ai = 'Required.';
  if (!isPlainObject(input.bot)) fields.bot = 'Required.';
  addUnknownFields(fields, ai, AI_KEYS, 'ai.');
  addUnknownFields(fields, bot, BOT_KEYS, 'bot.');

  const normalized = {
    ai: {
      baseURL: ai.baseURL,
      apiKey: ai.apiKey,
      model: ai.model,
      temperature: ai.temperature,
      maxTokens: ai.maxTokens,
      visionEnabled: ai.visionEnabled,
      mediaEnabled: additionsOptional && ai.mediaEnabled === undefined ? DEFAULT_SETTINGS.ai.mediaEnabled : ai.mediaEnabled,
      attachmentTransport: additionsOptional && ai.attachmentTransport === undefined ? DEFAULT_SETTINGS.ai.attachmentTransport : ai.attachmentTransport,
      timeoutSeconds: ai.timeoutSeconds,
      maxImageMB: additionsOptional && ai.maxImageMB === undefined ? DEFAULT_SETTINGS.ai.maxImageMB : ai.maxImageMB,
      maxFileMB: additionsOptional && ai.maxFileMB === undefined ? DEFAULT_SETTINGS.ai.maxFileMB : ai.maxFileMB,
    },
    bot: {
      systemPrompt: bot.systemPrompt,
      replyTrigger: additionsOptional && bot.replyTrigger === undefined ? DEFAULT_SETTINGS.bot.replyTrigger : bot.replyTrigger,
      commandPrefix: bot.commandPrefix,
      memoryLimit: bot.memoryLimit,
      privateChatsOnly: bot.privateChatsOnly,
      groupRepliesEnabled: bot.groupRepliesEnabled,
      typingIndicator: bot.typingIndicator,
      maxMessageAgeSeconds: additionsOptional && bot.maxMessageAgeSeconds === undefined
        ? DEFAULT_SETTINGS.bot.maxMessageAgeSeconds : bot.maxMessageAgeSeconds,
      markRead: additionsOptional && bot.markRead === undefined ? DEFAULT_SETTINGS.bot.markRead : bot.markRead,
      rateLimitPerMinute: additionsOptional && bot.rateLimitPerMinute === undefined
        ? DEFAULT_SETTINGS.bot.rateLimitPerMinute : bot.rateLimitPerMinute,
    },
    version: input.version,
  };

  if (!validHttpUrl(ai.baseURL)) {
    fields['ai.baseURL'] = 'Must be an http(s) URL without credentials, query, or fragment.';
  }
  if (typeof ai.apiKey !== 'string' || (!allowEmptyApiKey && ai.apiKey.trim() === '')) {
    fields['ai.apiKey'] = 'Required.';
  }
  if (typeof ai.model !== 'string' || ai.model.trim() === '') fields['ai.model'] = 'Required.';
  else if (ai.model.length > 200) fields['ai.model'] = 'Must be at most 200 characters.';
  numberInRange(fields, 'ai.temperature', ai.temperature, 0, 2, false);
  numberInRange(fields, 'ai.maxTokens', ai.maxTokens, 1, maxTokensCeiling, true);
  booleanField(fields, 'ai.visionEnabled', ai.visionEnabled);
  booleanField(fields, 'ai.mediaEnabled', normalized.ai.mediaEnabled);
  if (!['auto', 'file', '9router-gemini'].includes(normalized.ai.attachmentTransport)) {
    fields['ai.attachmentTransport'] = 'Choose automatic, standard files, or 9Router Gemini.';
  }
  numberInRange(fields, 'ai.timeoutSeconds', ai.timeoutSeconds, 5, 300, true);
  numberInRange(fields, 'ai.maxImageMB', normalized.ai.maxImageMB, 1, 20, true);
  numberInRange(fields, 'ai.maxFileMB', normalized.ai.maxFileMB, 1, 20, true);

  if (typeof bot.systemPrompt !== 'string') fields['bot.systemPrompt'] = 'Required.';
  else if (bot.systemPrompt.length > 4000) fields['bot.systemPrompt'] = 'Must be at most 4000 characters.';
  if (!['prefix', 'mention-or-reply'].includes(normalized.bot.replyTrigger)) {
    fields['bot.replyTrigger'] = 'Choose command prefix or tags and replies only.';
  }
  if (typeof bot.commandPrefix !== 'string') fields['bot.commandPrefix'] = 'Required.';
  else if (bot.commandPrefix.length > 5) fields['bot.commandPrefix'] = 'Must be at most 5 characters.';
  numberInRange(fields, 'bot.memoryLimit', bot.memoryLimit, 0, 50, true);
  booleanField(fields, 'bot.privateChatsOnly', bot.privateChatsOnly);
  booleanField(fields, 'bot.groupRepliesEnabled', bot.groupRepliesEnabled);
  booleanField(fields, 'bot.typingIndicator', bot.typingIndicator);
  numberInRange(fields, 'bot.maxMessageAgeSeconds', normalized.bot.maxMessageAgeSeconds, 1, 3600, true);
  booleanField(fields, 'bot.markRead', normalized.bot.markRead);
  numberInRange(fields, 'bot.rateLimitPerMinute', normalized.bot.rateLimitPerMinute, 1, 120, true);
  if (input.version !== 1) fields.version = 'Must be 1.';

  if (Object.keys(fields).length > 0) throw new SettingsValidationError(fields);
  return normalized;
}

function validHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function numberInRange(fields, key, value, min, max, integer) {
  const valid = typeof value === 'number' && Number.isFinite(value)
    && (!integer || Number.isInteger(value)) && value >= min && value <= max;
  if (!valid) fields[key] = `Must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`;
}

function booleanField(fields, key, value) {
  if (typeof value !== 'boolean') fields[key] = 'Must be a boolean.';
}

function addUnknownFields(fields, object, allowed, prefix) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fields[`${prefix}${key}`] = 'Unknown field.';
  }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value === '') throw new Error('Invalid encrypted API key.');
  return Buffer.from(value, 'base64');
}

function clone(value) {
  return structuredClone(value);
}

function clonePayload(value) {
  try {
    return clone(value);
  } catch {
    throw new SettingsValidationError({ settings: 'Must be serializable.' });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeReason(error) {
  return error instanceof SettingsValidationError ? 'validation_failed' : error?.name ?? 'Error';
}
