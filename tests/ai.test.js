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
  assert.equal(provider.requests[0].body.max_tokens, 1);
});
