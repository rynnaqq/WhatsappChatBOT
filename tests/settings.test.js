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

test('invalid JSON is backed up before defaults with closed access replace in-memory state', async (t) => {
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
  assert.deepEqual(repo.get(), { ...DEFAULT_SETTINGS, bot: { ...DEFAULT_SETTINGS.bot, accessMode: 'owner-only' } });
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

test('older encrypted settings gain persona and sticker defaults without replacing the custom prompt', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings({ bot: { systemPrompt: 'Keep my document instructions.', replyTrigger: 'mention-or-reply' } }));
  const file = path.join(storageDir, 'settings.json');
  const older = JSON.parse(await readFile(file, 'utf8'));
  delete older.bot.personaStyle;
  delete older.bot.stickerReplies;
  const original = JSON.stringify(older);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(file, original));
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();

  assert.equal(restored.getPublic().bot.personaStyle, 'feminine');
  assert.equal(restored.getPublic().bot.stickerReplies, 'contextual');
  assert.equal(restored.get().bot.systemPrompt, 'Keep my document instructions.');
  assert.equal(restored.get().bot.replyTrigger, 'mention-or-reply');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(await readFile(file, 'utf8'), original);
});

test('persona and sticker choices persist through masked-key saves and invalid modes leave settings intact', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings());
  const payload = repo.getPublic();
  payload.bot.personaStyle = 'custom';
  payload.bot.stickerReplies = 'on-request';
  await repo.save(payload);
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();
  assert.equal(restored.get().bot.personaStyle, 'custom');
  assert.equal(restored.get().bot.stickerReplies, 'on-request');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  for (const bot of [{ personaStyle: 'unknown' }, { stickerReplies: 'always' }]) {
    const bad = restored.getPublic();
    Object.assign(bad.bot, bot);
    await assert.rejects(restored.save(bad), error => error instanceof SettingsValidationError);
    assert.equal(restored.get().bot.personaStyle, 'custom');
    assert.equal(restored.get().bot.stickerReplies, 'on-request');
  }
});

test('Renako selection persists with encrypted credentials, custom instructions and access policy intact', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings({ bot: {
    systemPrompt: 'Keep my document instructions.',
    accessMode: 'allowlist',
    ownerNumber: '6281234567890',
    allowedNumbers: ['12025550100'],
  } }));
  const payload = repo.getPublic();
  payload.bot.personaStyle = 'renako';
  await repo.save(payload);
  const file = path.join(storageDir, 'settings.json');
  const savedBytes = await readFile(file, 'utf8');
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();
  assert.equal(restored.getPublic().bot.personaStyle, 'renako');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(restored.get().bot.systemPrompt, 'Keep my document instructions.');
  assert.equal(restored.get().bot.accessMode, 'allowlist');
  assert.equal(restored.get().bot.ownerNumber, '6281234567890');
  assert.deepEqual(restored.get().bot.allowedNumbers, ['12025550100']);
  assert.equal(await readFile(file, 'utf8'), savedBytes);
  const invalid = restored.getPublic();
  invalid.bot.personaStyle = 'unrecognized-character';
  await assert.rejects(restored.save(invalid), error => error instanceof SettingsValidationError);
  assert.equal(await readFile(file, 'utf8'), savedBytes);
});

test('missing and older encrypted settings use compatible unrestricted access without rewriting saved data', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  assert.equal(repo.get().bot.accessMode, 'everyone');
  assert.equal(repo.get().bot.ownerNumber, '');
  assert.deepEqual(repo.get().bot.allowedNumbers, []);
  await repo.save(validSettings({ bot: { systemPrompt: 'Keep my instructions.', replyTrigger: 'mention-or-reply' } }));
  const file = path.join(storageDir, 'settings.json');
  const older = JSON.parse(await readFile(file, 'utf8'));
  for (const key of ['accessMode', 'ownerNumber', 'allowedNumbers']) delete older.bot[key];
  const original = JSON.stringify(older);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(file, original));
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();

  assert.equal(restored.get().bot.accessMode, 'everyone');
  assert.equal(restored.get().bot.ownerNumber, '');
  assert.deepEqual(restored.get().bot.allowedNumbers, []);
  assert.equal(restored.get().bot.systemPrompt, 'Keep my instructions.');
  assert.equal(restored.get().bot.replyTrigger, 'mention-or-reply');
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(await readFile(file, 'utf8'), original);
});

test('owner and allowed international numbers normalize, deduplicate and persist through masked-key saves', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings({ bot: {
    accessMode: 'allowlist', ownerNumber: '+62 (812) 3456-7890',
    allowedNumbers: ['+62 813-0000-1111', '6281300001111', '+1 (202) 555-0123'],
  } }));
  const payload = repo.getPublic();
  assert.equal(payload.bot.ownerNumber, '6281234567890');
  assert.deepEqual(payload.bot.allowedNumbers, ['6281300001111', '12025550123']);
  payload.ai.model = 'changed-model';
  await repo.save(payload);
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await restored.init();
  assert.equal(restored.get().bot.accessMode, 'allowlist');
  assert.equal(restored.get().bot.ownerNumber, '6281234567890');
  assert.deepEqual(restored.get().bot.allowedNumbers, ['6281300001111', '12025550123']);
  assert.equal(restored.get().ai.apiKey, 'sk-test-secret');
  assert.equal(restored.getPublic().ai.apiKey, MASKED_API_KEY);
  const copy = restored.getPublic();
  copy.bot.allowedNumbers.push('442079460123');
  assert.equal(restored.get().bot.allowedNumbers.length, 2);
});

test('restricted access requires an owner while an empty additional allowlist is valid', async (t) => {
  const { repo } = await makeRepo(t);
  for (const accessMode of ['owner-only', 'allowlist']) {
    await assert.rejects(repo.save(validSettings({ bot: { accessMode, ownerNumber: '', allowedNumbers: [] } })), error => {
      assert.ok(error instanceof SettingsValidationError);
      assert.deepEqual(Object.keys(error.fields), ['bot.ownerNumber']);
      return true;
    });
    await repo.save(validSettings({ bot: { accessMode, ownerNumber: '6281234567890', allowedNumbers: [] } }));
    assert.equal(repo.get().bot.accessMode, accessMode);
    assert.deepEqual(repo.get().bot.allowedNumbers, []);
  }
});

test('invalid access settings leave both active and persisted policy unchanged', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings({ bot: { accessMode: 'allowlist', ownerNumber: '6281234567890', allowedNumbers: ['6281300001111'] } }));
  const file = path.join(storageDir, 'settings.json');
  const before = await readFile(file, 'utf8');
  const invalid = [
    ['accessMode', 'unknown'], ['accessMode', null], ['accessMode', 1],
    ['ownerNumber', '081234567890'], ['ownerNumber', '6281234567890@s.whatsapp.net'],
    ['ownerNumber', '62812 OR 12025550123'], ['ownerNumber', 6281234567890],
    ['ownerNumber', '1'.repeat(65)], ['ownerNumber', '123456'], ['ownerNumber', '1234567890123456'],
    ['allowedNumbers', '6281300001111'], ['allowedNumbers', null], ['allowedNumbers', [6281300001111]], ['allowedNumbers', Array(1)],
    ['allowedNumbers', ['']], ['allowedNumbers', ['+62 813abc00001111']], ['allowedNumbers', ['6281300001111@g.us']],
    ['allowedNumbers', Array.from({ length: 101 }, (_, index) => `62813${String(index).padStart(8, '0')}`)],
  ];
  for (const [key, value] of invalid) {
    const payload = repo.getPublic();
    payload.bot[key] = value;
    await assert.rejects(repo.save(payload), error => {
      assert.ok(error instanceof SettingsValidationError);
      assert.deepEqual(Object.keys(error.fields), [`bot.${key}`]);
      return true;
    });
    assert.equal(repo.get().bot.accessMode, 'allowlist');
    assert.equal(repo.get().bot.ownerNumber, '6281234567890');
    assert.deepEqual(repo.get().bot.allowedNumbers, ['6281300001111']);
    assert.equal(await readFile(file, 'utf8'), before);
  }
});

test('older clients omitting new fields cannot silently reset an existing access policy', async (t) => {
  const { repo } = await makeRepo(t);
  await repo.save(validSettings({ bot: { accessMode: 'allowlist', ownerNumber: '6281234567890', allowedNumbers: ['6281300001111'] } }));
  await repo.save(validSettings({ ai: { apiKey: MASKED_API_KEY }, bot: { commandPrefix: '?' } }));
  assert.equal(repo.get().bot.accessMode, 'allowlist');
  assert.equal(repo.get().bot.ownerNumber, '6281234567890');
  assert.deepEqual(repo.get().bot.allowedNumbers, ['6281300001111']);
  assert.equal(repo.get().bot.commandPrefix, '?');
  assert.equal(repo.get().ai.apiKey, 'sk-test-secret');
});

test('invalid stored settings recover with bot access closed until the owner reconfigures them', async (t) => {
  const { repo, storageDir } = await makeRepo(t);
  await repo.save(validSettings());
  const file = path.join(storageDir, 'settings.json');
  const invalid = JSON.parse(await readFile(file, 'utf8'));
  invalid.bot.accessMode = 'allowlist';
  invalid.bot.ownerNumber = 'not-a-phone';
  invalid.bot.allowedNumbers = [];
  const original = JSON.stringify(invalid);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(file, original));
  const restored = new SettingsRepo({ storageDir, encryptionSecret: secret, logger: { warn() {} } });
  await restored.init();
  assert.equal(restored.get().bot.accessMode, 'owner-only');
  assert.equal(restored.get().bot.ownerNumber, '');
  assert.deepEqual(restored.get().bot.allowedNumbers, []);
  const backup = (await readdir(storageDir)).find(name => name.startsWith('settings.json.invalid-'));
  assert.ok(backup);
  assert.equal(await readFile(path.join(storageDir, backup), 'utf8'), original);
  const secondRestart = new SettingsRepo({ storageDir, encryptionSecret: secret, logger: { warn() {} } });
  await secondRestart.init();
  assert.equal(secondRestart.get().bot.accessMode, 'owner-only');
  assert.equal(secondRestart.get().bot.ownerNumber, '');
  const repaired = secondRestart.get();
  repaired.ai.apiKey = 'synthetic-reconfigured-key';
  repaired.bot.accessMode = 'everyone';
  await secondRestart.save(repaired);
  const configuredRestart = new SettingsRepo({ storageDir, encryptionSecret: secret });
  await configuredRestart.init();
  assert.equal(configuredRestart.get().bot.accessMode, 'everyone');
  assert.equal(configuredRestart.get().ai.apiKey, 'synthetic-reconfigured-key');
});
