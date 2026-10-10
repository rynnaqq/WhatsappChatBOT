import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_SETTINGS,
  MASKED_API_KEY,
  SettingsRepo,
  SettingsValidationError,
} from '../src/storage/settingsRepo.js';

const secret = 'a-session-secret-that-is-at-least-32-characters';

function validSettings(overrides = {}) {
  return {
    ai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test-secret',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 512,
      visionEnabled: true,
      timeoutSeconds: 60,
      maxImageMB: 5,
      ...overrides.ai,
    },
    bot: {
      systemPrompt: 'You are a helpful assistant.',
      commandPrefix: '!',
      memoryLimit: 6,
      privateChatsOnly: false,
      groupRepliesEnabled: true,
      typingIndicator: true,
      maxMessageAgeSeconds: 120,
      markRead: false,
      rateLimitPerMinute: 20,
      ...overrides.bot,
    },
    version: 1,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['ai', 'bot'].includes(key))),
  };
}

async function makeRepo(t, logger = { warn() {}, error() {} }) {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'wa-settings-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storageDir, { recursive: true, force: true });
  });
  const repo = new SettingsRepo({ storageDir, encryptionSecret: secret, logger });
  await repo.init();
  return { repo, storageDir };
}

test('init uses isolated defaults when the settings file is missing', async (t) => {
  const warnings = [];
  const { repo } = await makeRepo(t, { warn: (...args) => warnings.push(args), error() {} });

  const first = repo.get();
  first.ai.model = 'mutated';

  assert.deepEqual(repo.get(), DEFAULT_SETTINGS);
  assert.equal(repo.get().ai.apiKey, '');
  assert.equal(warnings.length, 1);
});

test('save encrypts the API key at rest and masks every public copy', async (t) => {
  const { repo, storageDir } = await makeRepo(t);

  const saved = await repo.save(validSettings());
  saved.ai.model = 'mutated';
  const persisted = await readFile(path.join(storageDir, 'settings.json'), 'utf8');

  assert.equal(saved.ai.apiKey, MASKED_API_KEY);
  assert.equal(repo.getPublic().ai.apiKey, MASKED_API_KEY);
  assert.equal(repo.get().ai.apiKey, 'sk-test-secret');
  assert.equal(repo.getPublic().ai.model, 'gpt-4o-mini');
  assert.equal(persisted.includes('sk-test-secret'), false);
  assert.match(persisted, /aes-256-gcm/);
});

test('reply trigger can be saved and restored while preserving the encrypted provider key', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings({ bot: { replyTrigger: 'mention-or-reply' } }));

  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();
  assert.equal(restored.getPublic().bot.replyTrigger, 'mention-or-reply');
  assert.equal(restored.getPublic().bot.commandPrefix, '!');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(restored.getPublic().ai.apiKey, MASKED_API_KEY);

  const payload = restored.getPublic();
  payload.bot.replyTrigger = 'prefix';
  await restored.save(payload);
  assert.equal(restored.get().bot.replyTrigger, 'prefix');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
});

test('reply trigger validation rejects unsupported modes without changing active settings', async (t) => {
  const { repo } = await makeRepo(t);
  await repo.save(validSettings({ bot: { replyTrigger: 'mention-or-reply' } }));

  for (const replyTrigger of ['all', '', null, 42]) {
    await assert.rejects(repo.save(validSettings({ bot: { replyTrigger } })), (error) => {
      assert.ok(error instanceof SettingsValidationError);
      assert.ok(error.fields['bot.replyTrigger']);
      return true;
    });
    assert.equal(repo.get().bot.replyTrigger, 'mention-or-reply');
  }
});

test('legacy settings retain prefix behavior when the reply trigger field is absent', async (t) => {
  const { repo } = await makeRepo(t);
  await repo.save(validSettings({ bot: { commandPrefix: '?' } }));
  assert.equal(repo.get().bot.replyTrigger, 'prefix');
  assert.equal(repo.get().bot.commandPrefix, '?');
});

test('save with the mask preserves the current key even across queued concurrent saves', async (t) => {
  const { repo } = await makeRepo(t);
  await repo.save(validSettings());

  await Promise.all([
    repo.save(validSettings({ ai: { apiKey: MASKED_API_KEY, model: 'model-a' } })),
    repo.save(validSettings({ ai: { apiKey: MASKED_API_KEY, model: 'model-b' } })),
  ]);

  assert.equal(repo.get().ai.apiKey, 'sk-test-secret');
  assert.equal(repo.get().ai.model, 'model-b');
});

test('save reports flat field errors and rejects unknown or unsafe values', async (t) => {
  const { repo } = await makeRepo(t);
  const bad = validSettings({
    ai: {
      baseURL: 'https://user:pass@example.com/v1?key=leak',
      apiKey: '',
      model: ' ',
      maxTokens: 50_000,
      maxImageMB: 21,
      surprise: true,
    },
    bot: { memoryLimit: 1.5, commandPrefix: '123456' },
    extra: true,
  });

  await assert.rejects(repo.save(bad), (error) => {
    assert.ok(error instanceof SettingsValidationError);
    assert.deepEqual(error.fields, {
      'ai.baseURL': 'Must be an http(s) URL without credentials, query, or fragment.',
      'ai.apiKey': 'Required.',
      'ai.model': 'Required.',
      'ai.maxTokens': 'Must be an integer from 1 to 32768.',
      'ai.maxImageMB': 'Must be an integer from 1 to 20.',
      'ai.surprise': 'Unknown field.',
      'bot.commandPrefix': 'Must be at most 5 characters.',
      'bot.memoryLimit': 'Must be an integer from 0 to 50.',
      extra: 'Unknown field.',
    });
    return true;
  });
});

test('legacy plaintext settings load and are encrypted on the next save', async (t) => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'wa-settings-legacy-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storageDir, { recursive: true, force: true });
  });
  await mkdir(storageDir, { recursive: true });
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(path.join(storageDir, 'settings.json'), JSON.stringify(validSettings())),
  );
  const repo = new SettingsRepo({ storageDir, encryptionSecret: secret, logger: { warn() {}, error() {} } });

  await repo.init();
  assert.equal(repo.get().ai.apiKey, 'sk-test-secret');
  await repo.save({ ...repo.get(), ai: { ...repo.get().ai, apiKey: MASKED_API_KEY } });

  const persisted = await readFile(path.join(storageDir, 'settings.json'), 'utf8');
  assert.equal(persisted.includes('sk-test-secret'), false);
});

test('invalid JSON is backed up before defaults replace in-memory state', async (t) => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'wa-settings-invalid-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storageDir, { recursive: true, force: true });
  });
  await import('node:fs/promises').then(({ writeFile }) =>
    writeFile(path.join(storageDir, 'settings.json'), '{broken-json'),
  );
  const warnings = [];
  const repo = new SettingsRepo({
    storageDir,
    encryptionSecret: secret,
    logger: { warn: (...args) => warnings.push(args), error() {} },
  });

  await repo.init();

  const files = await readdir(storageDir);
  const backup = files.find((name) => name.startsWith('settings.json.invalid-'));
  assert.ok(backup);
  assert.equal(await readFile(path.join(storageDir, backup), 'utf8'), '{broken-json');
  assert.deepEqual(repo.get(), DEFAULT_SETTINGS);
  assert.equal(warnings.length, 1);
});

test('unreadable settings paths reject init without overwriting the target', async (t) => {
  const storageDir = await mkdtemp(path.join(tmpdir(), 'wa-settings-unreadable-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(storageDir, { recursive: true, force: true });
  });
  await mkdir(path.join(storageDir, 'settings.json'));
  const repo = new SettingsRepo({ storageDir, encryptionSecret: secret, logger: { warn() {}, error() {} } });

  await assert.rejects(repo.init());
  assert.deepEqual(await readdir(path.join(storageDir, 'settings.json')), []);
});

test('subscribers receive cloned public settings after successful saves only', async (t) => {
  const { repo } = await makeRepo(t);
  const received = [];
  const unsubscribe = repo.subscribe((settings) => {
    settings.ai.model = 'listener-mutation';
    received.push(settings);
  });

  await repo.save(validSettings());
  unsubscribe();
  await repo.save(validSettings({ ai: { apiKey: MASKED_API_KEY, model: 'second' } }));

  assert.equal(received.length, 1);
  assert.equal(received[0].ai.apiKey, MASKED_API_KEY);
  assert.equal(repo.get().ai.model, 'second');
});

test('older encrypted settings gain media defaults without resetting credentials or rewriting the file', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings({ bot: { replyTrigger: 'mention-or-reply' } }));
  const file = path.join(storageDir, 'settings.json');
  const older = JSON.parse(await readFile(file, 'utf8'));
  delete older.ai.mediaEnabled;
  delete older.ai.maxFileMB;
  delete older.ai.attachmentTransport;
  const original = JSON.stringify(older);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(file, original));
  const warnings = [];
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret, logger: { warn: (...args) => warnings.push(args) } });

  await restored.init();

  assert.equal(restored.get().ai.mediaEnabled, true);
  assert.equal(restored.get().ai.maxFileMB, 10);
  assert.equal(restored.get().ai.attachmentTransport, 'auto');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(restored.get().bot.replyTrigger, 'mention-or-reply');
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(warnings, []);
});

test('media controls persist and preserve the masked API key', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings());
  const payload = repo.getPublic();
  payload.ai.mediaEnabled = false;
  payload.ai.maxFileMB = 12;
  payload.ai.attachmentTransport = '9router-gemini';
  await repo.save(payload);
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();

  assert.equal(restored.get().ai.mediaEnabled, false);
  assert.equal(restored.get().ai.maxFileMB, 12);
  assert.equal(restored.get().ai.attachmentTransport, '9router-gemini');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(restored.getPublic().ai.apiKey, MASKED_API_KEY);
});

test('invalid media controls are rejected without changing active settings', async (t) => {
  const { repo } = await makeRepo(t);
  await repo.save(validSettings());
  for (const ai of [{ mediaEnabled: 'true' }, { maxFileMB: 0 }, { maxFileMB: 21 }, { maxFileMB: 1.5 }, { attachmentTransport: 'anything' }]) {
    await assert.rejects(repo.save(validSettings({ ai })), (error) => {
      assert.ok(error instanceof SettingsValidationError);
      assert.ok(error.fields[`ai.${Object.keys(ai)[0]}`]);
      return true;
    });
    assert.equal(repo.get().ai.mediaEnabled, true);
    assert.equal(repo.get().ai.maxFileMB, 10);
  }
});
