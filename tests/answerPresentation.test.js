import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { AIService } from '../src/services/aiService.js';
import { MemoryService } from '../src/services/memoryService.js';

function settings(baseURL, bot = {}) {
  return {
    ai: {
      baseURL,
      apiKey: 'local-fixture-key',
      model: 'fixture-model',
      temperature: 0.2,
      maxTokens: 512,
      visionEnabled: true,
      timeoutSeconds: 2,
    },
    bot: {
      systemPrompt: 'Solve accurately and preserve the source content.',
      memoryLimit: 3,
      personaStyle: 'feminine',
      stickerReplies: 'contextual',
      ...bot,
    },
  };
}

function fakeRepo(value) {
  return { get: () => structuredClone(value) };
}

async function startProvider(t, answer) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl-answer-presentation',
      object: 'chat.completion',
      created: 1,
      model: 'fixture-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: answer },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests };
}

test('AI boundary carries MCQ guidance and preserves the authored answer structure in reply and memory', async (t) => {
  const userText = [
    'Hai, bantu jawab soal pilihan ganda ini.',
    '1. Berapa 2 + 2? A. 3 B. 4',
    '2. Kode mana yang mencetak "ok"? A. return B. break C. console.log("ok")',
  ].join('\n');
  const structuredAnswer = [
    '*Kunci Jawaban:* 1. B; 2. C',
    '',
    '1.',
    '*Jawaban: B. 4*',
    '',
    '*Penjelasan:* Gunakan rumus `2 + 2 = 4`.',
    '',
    '2.',
    '*Jawaban: C. `console.log("ok")`*',
    '',
    '*Penjelasan:* Kode tersebut menulis string "ok" ke konsol.',
  ].join('\n');
  const provider = await startProvider(t, `${structuredAnswer}\n[[sticker:happy]]`);
  const memory = new MemoryService();
  const service = new AIService({
    settingsRepo: fakeRepo(settings(provider.baseURL)),
    memory,
  });

  const result = await service.replyWithMedia({ chatId: 'study-chat', text: userText });

  assert.deepEqual(result, { text: structuredAnswer, stickerId: null });
  assert.equal(provider.requests.length, 1);
  const sentMessages = provider.requests[0].messages;
  assert.equal(sentMessages.at(-1).content, userText);
  assert.match(sentMessages[0].content, /\*Jawaban: B\. \.\.\.\*.*blank line.*\*Penjelasan:\* \.\.\./su);
  assert.match(sentMessages[0].content, /original numbering and order/iu);
  assert.match(sentMessages[0].content, /Preserve formulas, code, and quotations exactly/iu);
  assert.equal(sentMessages[0].content.includes('[[sticker:'), false);
  assert.equal(result.text.includes('\n\n'), true);
  assert.deepEqual([...result.text.matchAll(/^\*Jawaban:/gmu)].map(({ 0: label }) => label), [
    '*Jawaban:',
    '*Jawaban:',
  ]);
  assert.deepEqual(memory.get('study-chat', 3), [
    { role: 'user', content: userText },
    { role: 'assistant', content: structuredAnswer },
  ]);
  assert.equal(JSON.stringify(memory.get('study-chat', 3)).includes('[[sticker:'), false);
});

test('AI boundary leaves the custom persona prompt exact for academic input', async (t) => {
  const provider = await startProvider(t, 'B');
  const memory = new MemoryService();
  const service = new AIService({
    settingsRepo: fakeRepo(settings(provider.baseURL, {
      systemPrompt: 'Return only the option letter.',
      personaStyle: 'custom',
    })),
    memory,
  });

  assert.equal(await service.reply({ chatId: 'custom-study-chat', text: 'Hai, jawab soal ini.' }), 'B');
  assert.equal(provider.requests[0].messages[0].content, 'Return only the option letter.');
  assert.deepEqual(memory.get('custom-study-chat', 3).at(-1), { role: 'assistant', content: 'B' });
});
