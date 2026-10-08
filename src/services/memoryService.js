export class MemoryService {
  #chats = new Map();
  #maxChats;

  constructor({ maxChats = 1000 } = {}) {
    if (!Number.isInteger(maxChats) || maxChats < 1) {
      throw new TypeError('maxChats must be a positive integer.');
    }
    this.#maxChats = maxChats;
  }

  get(chatId, limit) {
    const turnsToRead = normalizeLimit(limit);
    const turns = this.#chats.get(chatId);
    if (!turns || turnsToRead === 0) return [];
    this.#touch(chatId, turns);
    return turns.slice(-turnsToRead).flatMap((turn) => [
      { role: 'user', content: turn.user },
      { role: 'assistant', content: turn.assistant },
    ]);
  }

  append(chatId, userText, assistantText, limit) {
    const turnsToKeep = normalizeLimit(limit);
    if (turnsToKeep === 0) {
      this.clear(chatId);
      return;
    }
    if (typeof chatId !== 'string' || chatId.length === 0) throw new TypeError('chatId is required.');
    if (typeof userText !== 'string' || typeof assistantText !== 'string') {
      throw new TypeError('Memory content must be text.');
    }
    const turns = this.#chats.get(chatId) ?? [];
    turns.push({ user: userText, assistant: assistantText });
    if (turns.length > turnsToKeep) turns.splice(0, turns.length - turnsToKeep);
    this.#touch(chatId, turns);
    this.#evictIdleChats();
  }

  clear(chatId) {
    this.#chats.delete(chatId);
  }

  clearAll() {
    this.#chats.clear();
  }

  trim(chatId, turnsToKeep) {
    const limit = normalizeLimit(turnsToKeep);
    if (limit === 0) {
      this.clear(chatId);
      return;
    }
    const turns = this.#chats.get(chatId);
    if (!turns) return;
    if (turns.length > limit) turns.splice(0, turns.length - limit);
    this.#touch(chatId, turns);
  }

  #touch(chatId, turns) {
    this.#chats.delete(chatId);
    this.#chats.set(chatId, turns);
  }

  #evictIdleChats() {
    while (this.#chats.size > this.#maxChats) {
      this.#chats.delete(this.#chats.keys().next().value);
    }
  }
}

function normalizeLimit(value) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError('limit must be a nonnegative integer.');
  return value;
}
