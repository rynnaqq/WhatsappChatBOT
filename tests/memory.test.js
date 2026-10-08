import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryService } from '../src/services/memoryService.js';

test('get returns the last complete turns as copied OpenAI messages', () => {
  const memory = new MemoryService();
  memory.append('chat-a', 'u1', 'a1', 3);
  memory.append('chat-a', 'u2', 'a2', 3);
  memory.append('chat-a', 'u3', 'a3', 3);

  const messages = memory.get('chat-a', 2);
  messages[0].content = 'changed';

  assert.deepEqual(memory.get('chat-a', 2), [
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
    { role: 'assistant', content: 'a3' },
  ]);
});

test('append enforces the configured turn limit and zero clears the chat', () => {
  const memory = new MemoryService();
  memory.append('chat-a', 'u1', 'a1', 2);
  memory.append('chat-a', 'u2', 'a2', 2);
  memory.append('chat-a', 'u3', 'a3', 2);
  assert.deepEqual(memory.get('chat-a', 10), [
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
    { role: 'assistant', content: 'a3' },
  ]);

  memory.append('chat-a', 'ignored', 'ignored', 0);
  assert.deepEqual(memory.get('chat-a', 10), []);
});

test('trim keeps only the requested newest complete turns', () => {
  const memory = new MemoryService();
  memory.append('chat-a', 'u1', 'a1', 5);
  memory.append('chat-a', 'u2', 'a2', 5);
  memory.append('chat-a', 'u3', 'a3', 5);

  memory.trim('chat-a', 1);

  assert.deepEqual(memory.get('chat-a', 5), [
    { role: 'user', content: 'u3' },
    { role: 'assistant', content: 'a3' },
  ]);
});

test('the least recently used idle chat is evicted at the chat bound', () => {
  const memory = new MemoryService({ maxChats: 2 });
  memory.append('chat-a', 'ua', 'aa', 2);
  memory.append('chat-b', 'ub', 'ab', 2);
  memory.get('chat-a', 2);
  memory.append('chat-c', 'uc', 'ac', 2);

  assert.deepEqual(memory.get('chat-b', 2), []);
  assert.equal(memory.get('chat-a', 2)[0].content, 'ua');
  assert.equal(memory.get('chat-c', 2)[0].content, 'uc');
});

test('clearAll removes every chat when the linked account changes', () => {
  const memory = new MemoryService();
  memory.append('chat-a', 'ua', 'aa', 2);
  memory.append('chat-b', 'ub', 'ab', 2);

  memory.clearAll();

  assert.deepEqual(memory.get('chat-a', 2), []);
  assert.deepEqual(memory.get('chat-b', 2), []);
});
