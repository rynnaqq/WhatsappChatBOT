import OpenAI from 'openai';
import { performance } from 'node:perf_hooks';

import { computeBackoffDelay, isAbortError, isRetryableProviderError } from './rateLimiter.js';

const MAX_TRANSIENT_RETRIES = 3;
const GENERIC_ERROR = 'The AI service is temporarily unavailable. Please try again.';

export class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
    this.code = 'AI_USER_FACING';
  }
}

export class AIService {
  #settingsRepo;
  #memory;
  #logger;
  #clientFactory;
  #sleep;
  #random;
  #client;
  #clientSignature;
  #memoryGeneration = 0;

  constructor({ settingsRepo, memory, logger, clientFactory, sleep, random } = {}) {
    if (!settingsRepo || typeof settingsRepo.get !== 'function') throw new TypeError('settingsRepo is required.');
    if (!memory) throw new TypeError('memory is required.');
    this.#settingsRepo = settingsRepo;
    this.#memory = memory;
    this.#logger = logger ?? {};
    this.#clientFactory = clientFactory ?? ((config) => new OpenAI(config));
    this.#sleep = sleep ?? abortableSleep;
    this.#random = random ?? Math.random;
  }

  async reply({ chatId, text, imageBuffer, mimeType } = {}) {
    const settings = this.#settingsRepo.get();
    const memoryGeneration = this.#memoryGeneration;
    const userText = typeof text === 'string' ? text : '';
    this.#validateImage(imageBuffer, settings.ai);
    const currentMessage = buildCurrentMessage(userText, imageBuffer, mimeType);
    const operation = this.#beginOperation(settings.ai.timeoutSeconds);

    try {
      let messages = this.#buildMessages(settings, chatId, currentMessage);
      let overflowRetried = false;
      let response;

      while (true) {
        try {
          response = await this.#completeWithRetries(settings, messages, operation);
          break;
        } catch (error) {
          if (!overflowRetried && isContextOverflow(error)) {
            if (memoryGeneration !== this.#memoryGeneration) {
              throw new UserFacingError(GENERIC_ERROR);
            }
            overflowRetried = true;
            const priorTurns = this.#memory.get(chatId, settings.bot.memoryLimit).length / 2;
            if (priorTurns > 0) this.#memory.trim(chatId, Math.max(0, priorTurns - 1));
            messages = this.#buildMessages(settings, chatId, currentMessage);
            continue;
          }
          throw error;
        }
      }

      const answer = extractText(response);
      if (!answer) throw new UserFacingError('The AI service returned an empty response. Please try again.');
      const rememberedText = imageBuffer
        ? `[image sent]${userText ? ` ${userText}` : ''}`
        : userText;
      if (memoryGeneration === this.#memoryGeneration) {
        this.#memory.append(chatId, rememberedText, answer, settings.bot.memoryLimit);
      }
      return answer;
    } catch (error) {
      throw this.#toUserFacingError(error, operation.signal);
    } finally {
      operation.finish();
    }
  }

  resetMemory() {
    this.#memoryGeneration += 1;
    this.#memory.clearAll();
  }

  async testConnection() {
    const settings = this.#settingsRepo.get();
    const operation = this.#beginOperation(settings.ai.timeoutSeconds);
    const startedAt = performance.now();
    try {
      await this.#completeWithRetries(settings, [{ role: 'user', content: 'Reply with OK.' }], operation, {
        maxTokens: 1,
        temperature: 0,
      });
      return {
        ok: true,
        model: settings.ai.model,
        latencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
      };
    } catch (error) {
      throw this.#toUserFacingError(error, operation.signal);
    } finally {
      operation.finish();
    }
  }

  #buildMessages(settings, chatId, currentMessage) {
    return [
      { role: 'system', content: settings.bot.systemPrompt },
      ...this.#memory.get(chatId, settings.bot.memoryLimit),
      currentMessage,
    ];
  }

  async #completeWithRetries(settings, messages, operation, overrides = {}) {
    const client = this.#getClient(settings.ai);
    let retryNumber = 0;
    while (true) {
      try {
        return await client.chat.completions.create({
          model: settings.ai.model,
          messages,
          temperature: overrides.temperature ?? settings.ai.temperature,
          max_tokens: overrides.maxTokens ?? settings.ai.maxTokens,
        }, { signal: operation.signal });
      } catch (error) {
        if (!isRetryableProviderError(error) || retryNumber >= MAX_TRANSIENT_RETRIES || operation.signal.aborted) {
          throw error;
        }
        const delay = computeBackoffDelay(retryNumber, { random: this.#random });
        retryNumber += 1;
        this.#logger.warn?.(
          { event: 'ai_retry', retry: retryNumber, status: error?.status ?? null },
          'Retrying a transient AI provider failure.',
        );
        await this.#sleep(delay, operation.signal);
      }
    }
  }

  #getClient(ai) {
    const signature = JSON.stringify([ai.baseURL, ai.apiKey, ai.model, ai.timeoutSeconds]);
    if (!this.#client || signature !== this.#clientSignature) {
      this.#client = this.#clientFactory({
        baseURL: ai.baseURL,
        apiKey: ai.apiKey,
        timeout: ai.timeoutSeconds * 1000,
        maxRetries: 0,
      });
      this.#clientSignature = signature;
    }
    return this.#client;
  }

  #validateImage(imageBuffer, ai) {
    if (imageBuffer === undefined || imageBuffer === null) return;
    if (!Buffer.isBuffer(imageBuffer)) throw new UserFacingError('The image could not be processed.');
    if (!ai.visionEnabled) throw new UserFacingError('Image messages are disabled.');
    if (imageBuffer.byteLength > ai.maxImageMB * 1024 * 1024) {
      throw new UserFacingError(`Image exceeds the ${ai.maxImageMB} MB limit.`);
    }
  }

  #beginOperation(timeoutSeconds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    timer.unref?.();
    return { signal: controller.signal, finish: () => clearTimeout(timer) };
  }

  #toUserFacingError(error, signal) {
    if (error instanceof UserFacingError) return error;
    const timedOut = signal.aborted || isAbortError(error) || error?.name === 'APIConnectionTimeoutError';
    this.#logger.error?.(
      {
        event: 'ai_request_failed',
        status: Number.isInteger(error?.status) ? error.status : null,
        kind: safeKind(error?.name),
      },
      timedOut ? 'AI request timed out.' : 'AI request failed.',
    );
    return new UserFacingError(timedOut
      ? 'The AI service timed out. Please try again.'
      : GENERIC_ERROR);
  }
}

function buildCurrentMessage(text, imageBuffer, mimeType) {
  if (!imageBuffer) return { role: 'user', content: text };
  const safeMimeType = typeof mimeType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(mimeType)
    ? mimeType.toLowerCase()
    : 'image/jpeg';
  return {
    role: 'user',
    content: [
      { type: 'text', text: text || 'Describe this image.' },
      { type: 'image_url', image_url: { url: `data:${safeMimeType};base64,${imageBuffer.toString('base64')}` } },
    ],
  };
}

function extractText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function isContextOverflow(error) {
  if (error?.status !== 400) return false;
  const code = error?.code ?? error?.error?.code;
  if (code === 'context_length_exceeded') return true;
  return /context (?:length|window)|maximum context/i.test(String(error?.message ?? ''));
}

function abortableSleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function abortError() {
  const error = new Error('Operation aborted.');
  error.name = 'AbortError';
  return error;
}

function safeKind(value) {
  return typeof value === 'string' && /^[A-Z][A-Za-z0-9]{0,63}$/.test(value) ? value : 'Error';
}
