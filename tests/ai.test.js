import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { AIService, UserFacingError } from '../src/services/aiService.js';
import { MemoryService } from '../src/services/memoryService.js';

function settings(overrides = {}) {
  return {
    ai: {
      baseURL: 'http://127.0.0.1:1/v1',
      apiKey: 'provider-secret',
      model: 'model-one',
      temperature: 0.4,
      maxTokens: 123,
      visionEnabled: true,
      timeoutSeconds: 2,
      maxImageMB: 5,
      ...overrides.ai,
    },
    bot: {
      systemPrompt: 'Stay concise.',
      memoryLimit: 3,
      ...overrides.bot,
    },
  };
}

function fakeRepo(initial) {
  let current = structuredClone(initial);
  return {
    get: () => structuredClone(current),
    set: (next) => { current = structuredClone(next); },
  };
}

async function startProvider(t, responder, basePath = '/v1') {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const record = { method: request.method, url: request.url, body: JSON.parse(rawBody), headers: request.headers };
    requests.push(record);
    await responder({ request: record, response, attempt: requests.length });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return { baseURL: `http://127.0.0.1:${address.port}${basePath}`, requests };
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function completion(content = 'provider answer') {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'model-one',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

test('reply sends system, history, and current text through the official client and stores success', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion('hello')));
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const memory = new MemoryService();
  memory.append('chat-a', 'old question', 'old answer', 3);
  const service = new AIService({ settingsRepo: repo, memory, logger: { warn() {}, error() {} } });

  assert.equal(await service.reply({ chatId: 'chat-a', text: 'new question' }), 'hello');

  assert.deepEqual(provider.requests[0].body, {
    model: 'model-one',
    messages: [
      { role: 'system', content: 'Stay concise.' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'new question' },
    ],
    temperature: 0.4,
    max_tokens: 123,
  });
  assert.deepEqual(memory.get('chat-a', 3).slice(-2), [
    { role: 'user', content: 'new question' },
    { role: 'assistant', content: 'hello' },
  ]);
  assert.equal(provider.requests[0].headers.authorization, 'Bearer provider-secret');
});

test('reply sends images as data URLs but stores only the text placeholder', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion('seen')));
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const memory = new MemoryService();
  const service = new AIService({ settingsRepo: repo, memory, logger: { warn() {}, error() {} } });

  await service.reply({ chatId: 'chat-a', text: 'what is this?', imageBuffer: Buffer.from('image'), mimeType: 'image/png' });

  assert.deepEqual(provider.requests[0].body.messages.at(-1), {
    role: 'user',
    content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
    ],
  });
  assert.deepEqual(memory.get('chat-a', 3), [
    { role: 'user', content: '[image sent] what is this?' },
    { role: 'assistant', content: 'seen' },
  ]);
});

test('reply rejects disabled or oversized images before contacting the provider', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion()));
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL, visionEnabled: false, maxImageMB: 1 } }));
  const service = new AIService({ settingsRepo: repo, memory: new MemoryService(), logger: { warn() {}, error() {} } });

  await assert.rejects(
    service.reply({ chatId: 'a', text: '', imageBuffer: Buffer.from('x') }),
    (error) => error instanceof UserFacingError && error.message === 'Image messages are disabled.',
  );
  repo.set(settings({ ai: { baseURL: provider.baseURL, visionEnabled: true, maxImageMB: 1 } }));
  await assert.rejects(
    service.reply({ chatId: 'a', text: '', imageBuffer: Buffer.alloc(1024 * 1024 + 1) }),
    (error) => error instanceof UserFacingError && error.message === 'Image exceeds the 1 MB limit.',
  );
  assert.equal(provider.requests.length, 0);
});

test('settings changes switch endpoint and model on the next request', async (t) => {
  const providerA = await startProvider(t, ({ response }) => sendJson(response, 200, completion('a')));
  const providerB = await startProvider(t, ({ response }) => sendJson(response, 200, completion('b')));
  const repo = fakeRepo(settings({ ai: { baseURL: providerA.baseURL, model: 'model-a' }, bot: { memoryLimit: 0 } }));
  const service = new AIService({ settingsRepo: repo, memory: new MemoryService(), logger: { warn() {}, error() {} } });

  assert.equal(await service.reply({ chatId: 'chat', text: 'first' }), 'a');
  repo.set(settings({ ai: { baseURL: providerB.baseURL, model: 'model-b' }, bot: { memoryLimit: 0 } }));
  assert.equal(await service.reply({ chatId: 'chat', text: 'second' }), 'b');

  assert.equal(providerA.requests[0].body.model, 'model-a');
  assert.equal(providerB.requests[0].body.model, 'model-b');
});

test('OpenAI-compatible provider base paths preserve the configured protocol contract', async (t) => {
  const variants = [
    { name: 'OpenAI or Ollama', basePath: '/v1', requestPath: '/v1/chat/completions' },
    { name: 'OpenRouter', basePath: '/api/v1', requestPath: '/api/v1/chat/completions' },
    { name: 'Groq', basePath: '/openai/v1', requestPath: '/openai/v1/chat/completions' },
  ];

  for (const [index, variant] of variants.entries()) {
    await t.test(variant.name, async (subtest) => {
      const provider = await startProvider(
        subtest,
        ({ response }) => sendJson(response, 200, completion(`${variant.name} answer`)),
        variant.basePath,
      );
      const apiKey = `key-${index}`;
      const repo = fakeRepo(settings({
        ai: {
          baseURL: provider.baseURL,
          apiKey,
          model: `vision-model-${index}`,
          temperature: 0.25,
          maxTokens: 321,
        },
        bot: { memoryLimit: 0 },
      }));
      const service = new AIService({
        settingsRepo: repo,
        memory: new MemoryService(),
        logger: { warn() {}, error() {} },
      });

      await service.reply({
        chatId: `chat-${index}`,
        text: 'inspect this',
        imageBuffer: Buffer.from('compatible-image'),
        mimeType: 'image/webp',
      });

      assert.equal(provider.requests.length, 1);
      assert.equal(provider.requests[0].url, variant.requestPath);
      assert.equal(provider.requests[0].headers.authorization, `Bearer ${apiKey}`);
      assert.equal(provider.requests[0].body.model, `vision-model-${index}`);
      assert.equal(provider.requests[0].body.temperature, 0.25);
      assert.equal(provider.requests[0].body.max_tokens, 321);
      assert.deepEqual(provider.requests[0].body.messages.at(-1), {
        role: 'user',
        content: [
          { type: 'text', text: 'inspect this' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/webp;base64,Y29tcGF0aWJsZS1pbWFnZQ==' },
          },
        ],
      });
    });
  }
});

test('429 responses use bounded exponential retries within the same operation', async (t) => {
  const provider = await startProvider(t, ({ response, attempt }) => {
    if (attempt < 3) sendJson(response, 429, { error: { message: 'secret provider detail', type: 'rate_limit_error' } });
    else sendJson(response, 200, completion('eventually'));
  });
  const delays = [];
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({
    settingsRepo: repo,
    memory: new MemoryService(),
    logger: { warn() {}, error() {} },
    sleep: async (ms) => delays.push(ms),
    random: () => 0,
  });

  assert.equal(await service.reply({ chatId: 'chat', text: 'hello' }), 'eventually');
  assert.equal(provider.requests.length, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test('503 retry exhaustion stops after three retries and four total requests', async (t) => {
  const provider = await startProvider(t, ({ response }) =>
    sendJson(response, 503, { error: { message: 'provider unavailable' } }),
  );
  const delays = [];
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({
    settingsRepo: repo,
    memory: new MemoryService(),
    logger: { warn() {}, error() {} },
    sleep: async (ms) => delays.push(ms),
    random: () => 0,
  });

  await assert.rejects(
    service.reply({ chatId: 'chat', text: 'hello' }),
    (error) => error instanceof UserFacingError && error.code === 'AI_USER_FACING',
  );
  assert.equal(provider.requests.length, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test('401 authentication failures are never retried', async (t) => {
  const provider = await startProvider(t, ({ response }) =>
    sendJson(response, 401, { error: { message: 'invalid key' } }),
  );
  const delays = [];
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({
    settingsRepo: repo,
    memory: new MemoryService(),
    logger: { warn() {}, error() {} },
    sleep: async (ms) => delays.push(ms),
  });

  await assert.rejects(
    service.reply({ chatId: 'chat', text: 'hello' }),
    (error) => error instanceof UserFacingError && error.code === 'AI_USER_FACING',
  );
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(delays, []);
});

test('dropped network connections are retried by the service', async (t) => {
  const provider = await startProvider(t, ({ response, attempt }) => {
    if (attempt === 1) response.destroy();
    else sendJson(response, 200, completion('recovered'));
  });
  const delays = [];
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({
    settingsRepo: repo,
    memory: new MemoryService(),
    logger: { warn() {}, error() {} },
    sleep: async (ms) => delays.push(ms),
    random: () => 0,
  });

  assert.equal(await service.reply({ chatId: 'chat', text: 'hello' }), 'recovered');
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(delays, [500]);
});

test('the timeout budget aborts the whole operation with a safe error', async (t) => {
  const provider = await startProvider(t, async ({ response }) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (!response.destroyed) sendJson(response, 200, completion('too late'));
  });
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL, timeoutSeconds: 0.03 } }));
  const service = new AIService({
    settingsRepo: repo,
    memory: new MemoryService(),
    logger: { warn() {}, error() {} },
  });
  const started = performance.now();

  await assert.rejects(service.reply({ chatId: 'chat', text: 'hello' }), (error) => {
    assert.ok(error instanceof UserFacingError);
    assert.equal(error.code, 'AI_USER_FACING');
    assert.match(error.message, /timed out/i);
    return true;
  });
  assert.ok(performance.now() - started < 110);
  assert.equal(provider.requests.length, 1);
});

test('context overflow trims the oldest memory turn and retries once with the current image intact', async (t) => {
  const provider = await startProvider(t, ({ response, attempt }) => {
    if (attempt === 1) {
      sendJson(response, 400, { error: { message: 'maximum context length exceeded', code: 'context_length_exceeded' } });
    } else {
      sendJson(response, 200, completion('trimmed'));
    }
  });
  const memory = new MemoryService();
  memory.append('chat', 'u1', 'a1', 3);
  memory.append('chat', 'u2', 'a2', 3);
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({ settingsRepo: repo, memory, logger: { warn() {}, error() {} } });

  assert.equal(await service.reply({ chatId: 'chat', text: 'caption', imageBuffer: Buffer.from('i') }), 'trimmed');

  assert.equal(provider.requests.length, 2);
  assert.deepEqual(provider.requests[1].body.messages.slice(1, 3), [
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
  ]);
  assert.equal(provider.requests[1].body.messages.at(-1).content[1].image_url.url, 'data:image/jpeg;base64,aQ==');
});

test('a second context overflow fails safely without another retry', async (t) => {
  const provider = await startProvider(t, ({ response }) =>
    sendJson(response, 400, {
      error: { message: 'maximum context length exceeded with private provider details', code: 'context_length_exceeded' },
    }),
  );
  const memory = new MemoryService();
  memory.append('chat', 'old question', 'old answer', 3);
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({ settingsRepo: repo, memory, logger: { warn() {}, error() {} } });

  await assert.rejects(service.reply({ chatId: 'chat', text: 'current question' }), (error) => {
    assert.ok(error instanceof UserFacingError);
    assert.equal(error.code, 'AI_USER_FACING');
    assert.equal(error.message.includes('private provider details'), false);
    return true;
  });
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(memory.get('chat', 3), []);
});

test('resetMemory prevents an in-flight reply from restoring a previous account conversation', async (t) => {
  let releaseOldResponse;
  let markOldRequestReceived;
  const oldResponseGate = new Promise((resolve) => { releaseOldResponse = resolve; });
  const oldRequestReceived = new Promise((resolve) => { markOldRequestReceived = resolve; });
  const provider = await startProvider(t, async ({ response, attempt }) => {
    if (attempt === 1) {
      markOldRequestReceived();
      await oldResponseGate;
      sendJson(response, 200, completion('old account answer'));
      return;
    }
    sendJson(response, 200, completion('new account answer'));
  });
  const memory = new MemoryService();
  memory.append('chat', 'prior account question', 'prior account answer', 3);
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({ settingsRepo: repo, memory, logger: { warn() {}, error() {} } });

  const oldReply = service.reply({ chatId: 'chat', text: 'old in-flight question' });
  await oldRequestReceived;
  service.resetMemory();
  releaseOldResponse();
  assert.equal(await oldReply, 'old account answer');
  assert.deepEqual(memory.get('chat', 3), []);

  assert.equal(await service.reply({ chatId: 'chat', text: 'new account question' }), 'new account answer');
  assert.deepEqual(provider.requests[1].body.messages, [
    { role: 'system', content: 'Stay concise.' },
    { role: 'user', content: 'new account question' },
  ]);
  assert.deepEqual(memory.get('chat', 3), [
    { role: 'user', content: 'new account question' },
    { role: 'assistant', content: 'new account answer' },
  ]);
});

test('provider failures and empty completions become safe user-facing errors without leaking details', async (t) => {
  const logs = [];
  const provider = await startProvider(t, ({ response }) =>
    sendJson(response, 401, {
      error: {
        message: 'raw secret provider failure',
        type: 'auth_error',
        code: 'raw_secret_provider_code',
      },
    }),
  );
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
  const service = new AIService({
    settingsRepo: repo,
    memory: new MemoryService(),
    logger: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });

  await assert.rejects(service.reply({ chatId: 'chat', text: 'hello' }), (error) => {
    assert.ok(error instanceof UserFacingError);
    assert.equal(error.code, 'AI_USER_FACING');
    assert.equal(error.message.includes('raw secret'), false);
    assert.equal(error.stack.includes('raw secret'), false);
    return true;
  });
  assert.equal(JSON.stringify(logs).includes('raw secret'), false);
  assert.equal(JSON.stringify(logs).includes('raw_secret_provider_code'), false);

  const emptyProvider = await startProvider(t, ({ response }) => sendJson(response, 200, completion(null)));
  repo.set(settings({ ai: { baseURL: emptyProvider.baseURL } }));
  await assert.rejects(
    service.reply({ chatId: 'chat', text: 'hello' }),
    (error) => error instanceof UserFacingError && error.message.includes('empty response'),
  );
});

test('testConnection returns the active model and measured nonnegative latency', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion('OK')));
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL, model: 'health-model' } }));
  const service = new AIService({ settingsRepo: repo, memory: new MemoryService(), logger: { warn() {}, error() {} } });

  const result = await service.testConnection();

  assert.equal(result.ok, true);
  assert.equal(result.model, 'health-model');
  assert.ok(Number.isFinite(result.latencyMs));
  assert.ok(result.latencyMs >= 0);
  assert.ok(provider.requests[0].body.max_tokens >= 16);
  assert.ok(provider.requests[0].body.max_tokens <= 1024);
});

test('testConnection works with the Muse minimum of 16 output tokens', async (t) => {
  const provider = await startProvider(t, ({ request, response }) => {
    if (request.body.max_tokens < 16) {
      sendJson(response, 400, {
        error: {
          code: 'bad_request',
          type: 'invalid_request_error',
          message: '`max_output_tokens` The number must be `>= 16`.',
          param: 'max_output_tokens',
        },
      });
      return;
    }
    sendJson(response, 200, completion('OK'));
  });
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL, model: 'oc/muse-spark-1.3-contributor-free' } }));
  const memory = new MemoryService();
  const service = new AIService({ settingsRepo: repo, memory, logger: { warn() {}, error() {} } });

  const result = await service.testConnection();

  assert.equal(result.ok, true);
  assert.equal(result.model, 'oc/muse-spark-1.3-contributor-free');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0].body.messages, [{ role: 'user', content: 'Reply with OK.' }]);
  assert.deepEqual(memory.get('test', 3), []);
});

test('testConnection gives safe diagnostics for authentication and rejected requests', async (t) => {
  for (const scenario of [
    { status: 401, code: 'AI_AUTHENTICATION_FAILED', hint: /API key/i },
    { status: 400, code: 'AI_REQUEST_REJECTED', hint: /model|parameters/i },
    { status: 403, code: 'AI_ACCESS_DENIED', hint: /access|permission/i },
    { status: 404, code: 'AI_MODEL_OR_ENDPOINT_NOT_FOUND', hint: /model|URL/i },
    { status: 429, code: 'AI_RATE_LIMITED', hint: /quota|rate limit/i, attempts: 4 },
    { status: 503, code: 'AI_PROVIDER_UNAVAILABLE', hint: /unavailable/i, attempts: 4 },
  ]) {
    await t.test(`HTTP ${scenario.status}`, async (subtest) => {
      const provider = await startProvider(subtest, ({ response }) => sendJson(response, scenario.status, {
        error: { message: 'raw provider detail with provider-secret', code: 'private-provider-code' },
      }));
      const logs = [];
      const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
      const service = new AIService({
        settingsRepo: repo,
        memory: new MemoryService(),
        logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
        sleep: async () => {},
      });

      await assert.rejects(service.testConnection(), (error) => {
        assert.equal(error.code, scenario.code);
        assert.equal(error.providerStatus, scenario.status);
        assert.match(error.message, scenario.hint);
        assert.equal(error.message.includes('provider-secret'), false);
        assert.equal(error.message.includes('raw provider detail'), false);
        assert.equal(error.message.includes('private-provider-code'), false);
        return true;
      });
      assert.equal(provider.requests.length, scenario.attempts ?? 1);
      assert.equal(JSON.stringify(logs).includes('provider-secret'), false);
      assert.equal(JSON.stringify(logs).includes('private-provider-code'), false);
    });
  }
});

test('testConnection distinguishes network failure from timeout', async (t) => {
  await t.test('network failure', async (subtest) => {
    const provider = await startProvider(subtest, ({ response }) => response.destroy());
    const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL } }));
    const service = new AIService({ settingsRepo: repo, memory: new MemoryService(), logger: { warn() {}, error() {} }, sleep: async () => {} });

    await assert.rejects(service.testConnection(), (error) => {
      assert.equal(error.code, 'AI_CONNECTION_FAILED');
      assert.equal(error.providerStatus, null);
      assert.match(error.message, /URL|running|connect/i);
      return true;
    });
  });
  await t.test('timeout', async (subtest) => {
    const provider = await startProvider(subtest, async ({ response }) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (!response.destroyed) sendJson(response, 200, completion('too late'));
    });
    const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL, timeoutSeconds: 0.03 } }));
    const service = new AIService({ settingsRepo: repo, memory: new MemoryService(), logger: { warn() {}, error() {} } });

    await assert.rejects(service.testConnection(), (error) => {
      assert.equal(error.code, 'AI_TIMEOUT');
      assert.equal(error.providerStatus, null);
      assert.match(error.message, /timed out/i);
      return true;
    });
  });
});

test('attachments reach the official client as native file parts without storing binary content in history', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion('heard')));
  const memory = new MemoryService();
  const service = new AIService({ settingsRepo: fakeRepo(settings({ ai: { baseURL: provider.baseURL } })), memory });
  const buffer = Buffer.from('OggS synthetic voice payload');

  await service.reply({ chatId: 'chat', text: 'Transcribe this.', attachment: { kind: 'audio', mimeType: 'audio/ogg', fileName: 'voice.ogg', buffer } });

  const current = provider.requests[0].body.messages.at(-1);
  assert.equal(current.content[0].text, 'Transcribe this.');
  assert.equal(current.content[1].type, 'file');
  assert.equal(current.content[1].file.file_data, `data:audio/ogg;base64,${buffer.toString('base64')}`);
  const history = JSON.stringify(memory.get('chat', 3));
  assert.match(history, /audio sent/);
  assert.match(history, /Transcribe this/);
  assert.equal(history.includes(buffer.toString('base64')), false);
  assert.equal(history.includes('synthetic voice payload'), false);
});

test('text documents are attached as bounded text while history retains metadata only', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion('summarized')));
  const memory = new MemoryService();
  const service = new AIService({ settingsRepo: fakeRepo(settings({ ai: { baseURL: provider.baseURL } })), memory });

  await service.reply({ chatId: 'chat', text: 'Summarize.', attachment: { kind: 'document', mimeType: 'text/plain', fileName: 'notes.txt', buffer: Buffer.from('fixture document body') } });

  assert.match(JSON.stringify(provider.requests[0].body.messages.at(-1).content), /fixture document body/);
  const history = JSON.stringify(memory.get('chat', 3));
  assert.match(history, /document sent/);
  assert.equal(history.includes('fixture document body'), false);
});

test('disabled or oversized attachments never contact the provider or populate memory', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion()));
  const repo = fakeRepo(settings({ ai: { baseURL: provider.baseURL, mediaEnabled: false, maxFileMB: 1 } }));
  const memory = new MemoryService();
  const service = new AIService({ settingsRepo: repo, memory });
  const document = { kind: 'document', mimeType: 'text/plain', fileName: 'notes.txt', buffer: Buffer.from('hello') };
  await assert.rejects(service.reply({ chatId: 'chat', text: 'Read.', attachment: document }), (error) => error instanceof UserFacingError && /disabled/i.test(error.message));
  repo.set(settings({ ai: { baseURL: provider.baseURL, mediaEnabled: true, maxFileMB: 1 } }));
  await assert.rejects(service.reply({ chatId: 'chat', attachment: { ...document, buffer: Buffer.alloc(1024 * 1024 + 1) } }), (error) => error instanceof UserFacingError && /1 MB/i.test(error.message));
  assert.equal(provider.requests.length, 0);
  assert.deepEqual(memory.get('chat', 3), []);
});

test('context overflow retry keeps the same attachment and trims only complete memory turns', async (t) => {
  const provider = await startProvider(t, ({ response, attempt }) => attempt === 1
    ? sendJson(response, 400, { error: { code: 'context_length_exceeded', message: 'context length exceeded' } })
    : sendJson(response, 200, completion('read')));
  const memory = new MemoryService();
  memory.append('chat', 'old question', 'old answer', 3);
  const service = new AIService({ settingsRepo: fakeRepo(settings({ ai: { baseURL: provider.baseURL } })), memory });
  await service.reply({ chatId: 'chat', text: 'Read.', attachment: { kind: 'document', mimeType: 'application/pdf', fileName: 'paper.pdf', buffer: Buffer.from('%PDF-1.4\nfixture') } });
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(provider.requests[1].body.messages.at(-1), provider.requests[0].body.messages.at(-1));
  assert.equal(provider.requests[1].body.messages.length, 2);
  assert.equal(provider.requests[1].body.messages.at(-1).content[1].type, 'file');
});

test('account reset during attachment parsing cancels the old request before provider dispatch', { timeout: 1000 }, async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { started = resolve; });
  let requests = 0;
  const memory = new MemoryService();
  const service = new AIService({
    settingsRepo: fakeRepo(settings()), memory,
    prepareAttachment: async () => { started(); await gate; return { parts: [{ type: 'text', text: 'parsed' }], memoryText: '[document sent]' }; },
    clientFactory: () => ({ chat: { completions: { create: async () => { requests++; return completion(); } } } }),
  });
  const reply = service.reply({ chatId: 'chat', text: 'Read.', attachment: { kind: 'document', buffer: Buffer.from('fixture') } });
  await ready;
  service.resetMemory();
  release();
  await assert.rejects(reply, UserFacingError);
  assert.equal(requests, 0);
  assert.deepEqual(memory.get('chat', 3), []);
});

test('attachment preparation shares the total AI deadline and cannot dispatch after timeout', async () => {
  let requests = 0;
  const memory = new MemoryService();
  const service = new AIService({
    settingsRepo: fakeRepo(settings({ ai: { timeoutSeconds: 0.02 } })), memory,
    prepareAttachment: async (_attachment, { signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(signal.aborted, true);
      return { parts: [{ type: 'text', text: 'parsed' }], memoryText: '[document sent]' };
    },
    clientFactory: () => ({ chat: { completions: { create: async () => { requests++; return completion(); } } } }),
  });
  await assert.rejects(service.reply({ chatId: 'chat', attachment: { kind: 'document', buffer: Buffer.from('fixture') } }), (error) => error instanceof UserFacingError && /timed out/i.test(error.message));
  assert.equal(requests, 0);
  assert.deepEqual(memory.get('chat', 3), []);
});

test('a model rejection of a file has a helpful safe error without raw provider content', async (t) => {
  const logs = [];
  const provider = await startProvider(t, ({ response }) => sendJson(response, 400, { error: { message: 'private provider-secret attachment detail', code: 'unsupported_file' } }));
  const service = new AIService({ settingsRepo: fakeRepo(settings({ ai: { baseURL: provider.baseURL } })), memory: new MemoryService(), logger: { error: (...args) => logs.push(args) } });
  await assert.rejects(service.reply({ chatId: 'chat', text: 'Read.', attachment: { kind: 'document', mimeType: 'application/pdf', fileName: 'paper.pdf', buffer: Buffer.from('%PDF-1.4\nfixture') } }), (error) => {
    assert.ok(error instanceof UserFacingError);
    assert.match(error.message, /model|file type|attachment/i);
    assert.equal(error.message.includes('provider-secret'), false);
    return true;
  });
  assert.equal(JSON.stringify(logs).includes('provider-secret'), false);
});

test('9Router Gemini automatically receives compatible audio, PDF and video parts through the official client', async (t) => {
  const provider = await startProvider(t, ({ response }) => sendJson(response, 200, completion('read')));
  const service = new AIService({ settingsRepo: fakeRepo(settings({ ai: { baseURL: provider.baseURL, model: 'ag/gemini-3.8-flash-high' } })), memory: new MemoryService() });
  const attachments = [
    { kind: 'audio', mimeType: 'audio/ogg', fileName: 'voice.ogg', buffer: Buffer.from('OggS fixture'), partType: 'audio_url' },
    { kind: 'document', mimeType: 'application/pdf', fileName: 'paper.pdf', buffer: Buffer.from('%PDF-1.4\nfixture'), partType: 'image_url' },
    { kind: 'video', mimeType: 'video/mp4', fileName: 'clip.mp4', buffer: Buffer.from('synthetic mp4 fixture'), partType: 'image_url' },
  ];
  for (const attachment of attachments) {
    await service.reply({ chatId: 'chat', text: 'Read.', attachment });
    const part = provider.requests.at(-1).body.messages.at(-1).content[1];
    assert.equal(part.type, attachment.partType);
    assert.equal(part[attachment.partType].url, `data:${attachment.mimeType};base64,${attachment.buffer.toString('base64')}`);
  }
});
