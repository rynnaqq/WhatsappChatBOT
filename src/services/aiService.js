import OpenAI from 'openai';
import { performance } from 'node:perf_hooks';

import { computeBackoffDelay, isAbortError, isRetryableProviderError } from './rateLimiter.js';
import { AttachmentUserFacingError, prepareAttachment } from './attachmentService.js';

const MAX_TRANSIENT_RETRIES = 3;
const GENERIC_ERROR = 'The AI service is temporarily unavailable. Please try again.';
// Allow provider minimums and reasoning tokens before the short test answer.
const CONNECTION_TEST_TOKENS = 1024;
const CONNECTION_TEST_ERRORS = {
  AI_AUTHENTICATION_FAILED: 'The provider rejected the API key. Check the key for the saved Base URL.',
  AI_REQUEST_REJECTED: 'The provider rejected the test request. Check the saved model and model parameters.',
  AI_ACCESS_DENIED: 'The provider denied access. Check that your key has permission to use this model.',
  AI_MODEL_OR_ENDPOINT_NOT_FOUND: 'The provider URL or model was not found. Check the Base URL and exact model ID.',
  AI_RATE_LIMITED: 'The provider rate limit or quota was reached. Check your quota and try again later.',
  AI_PROVIDER_UNAVAILABLE: 'The provider is temporarily unavailable. Try again later.',
  AI_CONNECTION_FAILED: 'Could not connect to the provider. Check the Base URL and that the router is running and reachable.',
  AI_TIMEOUT: 'The model test timed out. Try again or increase Timeout in AI provider settings.',
  AI_TEST_FAILED: 'Could not test the model. Check the saved URL, key, and model, then try again.',
};

export class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
    this.code = 'AI_USER_FACING';
  }
}

export class AIConnectionTestError extends Error {
  constructor(code, providerStatus) {
    const safeCode = typeof code === 'string' && Object.hasOwn(CONNECTION_TEST_ERRORS, code) ? code : 'AI_TEST_FAILED';
    const safeStatus = Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599 ? providerStatus : null;
    super(`${CONNECTION_TEST_ERRORS[safeCode]}${safeStatus === null ? '' : ` (HTTP ${safeStatus})`}`);
    this.name = 'AIConnectionTestError';
    this.code = safeCode;
    this.providerStatus = safeStatus;
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
  #prepareAttachment;

  constructor({ settingsRepo, memory, logger, clientFactory, sleep, random, prepareAttachment: attachmentPreparer } = {}) {
    if (!settingsRepo || typeof settingsRepo.get !== 'function') throw new TypeError('settingsRepo is required.');
    if (!memory) throw new TypeError('memory is required.');
    this.#settingsRepo = settingsRepo;
    this.#memory = memory;
    this.#logger = logger ?? {};
    this.#clientFactory = clientFactory ?? ((config) => new OpenAI(config));
    this.#sleep = sleep ?? abortableSleep;
    this.#random = random ?? Math.random;
    this.#prepareAttachment = attachmentPreparer ?? prepareAttachment;
  }

  async reply({ chatId, text, imageBuffer, mimeType, attachment } = {}) {
    const settings = this.#settingsRepo.get();
    const memoryGeneration = this.#memoryGeneration;
    const userText = typeof text === 'string' ? text : '';
    const operation = this.#beginOperation(settings.ai.timeoutSeconds);

    try {
      let currentMessage;
      let attachmentMemory;
      if (attachment !== undefined && attachment !== null) {
        let prepared;
        try {
          prepared = await this.#prepareAttachment(attachment, { ai: settings.ai, signal: operation.signal });
        } catch (error) {
          if (error instanceof AttachmentUserFacingError) throw new UserFacingError(error.message);
          throw error;
        }
        if (operation.signal.aborted) throw abortError();
        if (memoryGeneration !== this.#memoryGeneration) throw new UserFacingError(GENERIC_ERROR);
        currentMessage = {
          role: 'user',
          content: [{ type: 'text', text: userText || 'Please help me with this attachment.' }, ...prepared.parts],
        };
        attachmentMemory = prepared.memoryText;
      } else {
        this.#validateImage(imageBuffer, settings.ai);
        currentMessage = buildCurrentMessage(userText, imageBuffer, mimeType);
      }
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
      const rememberedText = attachmentMemory
        ? `${attachmentMemory}${userText ? ` ${userText}` : ''}`
        : imageBuffer
        ? `[image sent]${userText ? ` ${userText}` : ''}`
        : userText;
      if (memoryGeneration === this.#memoryGeneration) {
        this.#memory.append(chatId, rememberedText, answer, settings.bot.memoryLimit);
      }
      return answer;
    } catch (error) {
      throw this.#toUserFacingError(error, operation.signal, Boolean(attachment));
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
        maxTokens: CONNECTION_TEST_TOKENS,
        temperature: 0,
      });
      return {
        ok: true,
        model: settings.ai.model,
        latencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
      };
    } catch (error) {
      this.#toUserFacingError(error, operation.signal);
      throw new AIConnectionTestError(connectionTestErrorCode(error, operation.signal), error?.status);
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

  #toUserFacingError(error, signal, hasAttachment = false) {
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
    if (timedOut) return new UserFacingError('The AI service timed out. Please try again.');
    if (hasAttachment && error?.status === 400 && !isContextOverflow(error)) {
      return new UserFacingError('The provider rejected this attachment. Check that the selected model supports its file type.');
    }
    if (hasAttachment && error?.status === 413) {
      return new UserFacingError('The attachment exceeds the provider\'s size limit. Try a smaller file.');
    }
    return new UserFacingError(GENERIC_ERROR);
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

function connectionTestErrorCode(error, signal) {
  if (signal.aborted || isAbortError(error) || error?.name === 'APIConnectionTimeoutError' || error?.constructor?.name === 'APIConnectionTimeoutError') return 'AI_TIMEOUT';
  if (error?.status === 400) return 'AI_REQUEST_REJECTED';
  if (error?.status === 401) return 'AI_AUTHENTICATION_FAILED';
  if (error?.status === 403) return 'AI_ACCESS_DENIED';
  if (error?.status === 404) return 'AI_MODEL_OR_ENDPOINT_NOT_FOUND';
  if (error?.status === 429) return 'AI_RATE_LIMITED';
  if (Number.isInteger(error?.status) && error.status >= 500 && error.status <= 599) return 'AI_PROVIDER_UNAVAILABLE';
  if (error?.constructor?.name === 'APIConnectionError' || error?.name === 'APIConnectionError') return 'AI_CONNECTION_FAILED';
  return 'AI_TEST_FAILED';
}
