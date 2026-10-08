import { rm } from 'node:fs/promises';
import path from 'node:path';

import { createMessageHandler } from './messageHandler.js';

const noop = () => {};
const defaultSleep = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError());
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, milliseconds);
  const onAbort = () => {
    clearTimeout(timer);
    reject(abortError());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

function abortError() {
  const error = new Error('Reconnect cancelled');
  error.name = 'AbortError';
  return error;
}

async function defaultAuthStateFactory(directory) {
  const { useMultiFileAuthState } = await import('@whiskeysockets/baileys');
  return useMultiFileAuthState(directory);
}

async function defaultSocketFactory(options) {
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default ?? baileys.makeWASocket;
  return makeWASocket(options);
}

async function defaultQRRenderer(value) {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(value);
}

function statusCode(error) {
  return error?.output?.statusCode ?? error?.statusCode ?? error?.data?.statusCode;
}

function phoneFromJid(jid) {
  if (typeof jid !== 'string') return undefined;
  return jid.split('@')[0].split(':')[0] || undefined;
}

function safeLogger(logger) {
  if (!logger) return { child() { return this; }, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  return {
    trace: typeof logger.trace === 'function' ? logger.trace.bind(logger) : noop,
    debug: typeof logger.debug === 'function' ? logger.debug.bind(logger) : noop,
    info: typeof logger.info === 'function' ? logger.info.bind(logger) : noop,
    warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop,
    error: typeof logger.error === 'function' ? logger.error.bind(logger) : noop,
    fatal: typeof logger.fatal === 'function' ? logger.fatal.bind(logger) : noop,
    child: typeof logger.child === 'function' ? logger.child.bind(logger) : function child() { return this; },
  };
}

export class WhatsAppBot {
  constructor({
    storageDir,
    state,
    settingsRepo,
    aiService,
    logger,
    socketFactory = defaultSocketFactory,
    authStateFactory = defaultAuthStateFactory,
    qrRenderer = defaultQRRenderer,
    sleep = defaultSleep,
    random = Math.random,
  }) {
    this.storageDir = path.resolve(storageDir);
    this.authDir = path.join(this.storageDir, 'auth_info');
    this.state = state;
    this.settingsRepo = settingsRepo;
    this.aiService = aiService;
    this.logger = safeLogger(logger);
    this.socketFactory = socketFactory;
    this.authStateFactory = authStateFactory;
    this.qrRenderer = qrRenderer;
    this.sleep = sleep;
    this.random = random;
    this.socket = null;
    this.listeners = null;
    this.handler = null;
    this.queue = Promise.resolve();
    this.generation = 0;
    this.reconnectAttempt = 0;
    this.reconnectController = null;
    this.qrToken = 0;
    this.stopped = true;
    this.fatal = false;
  }

  start() {
    return this.#serialize(async () => {
      if (this.socket && !this.stopped) return;
      this.stopped = false;
      this.fatal = false;
      const generation = this.#nextGeneration();
      try {
        await this.#open(generation);
      } catch (error) {
        this.state.update({ state: 'disconnected', lastError: 'Unable to start WhatsApp connection.' });
        throw error;
      }
    });
  }

  restart(mode = 'restart') {
    return this.#serialize(async () => {
      if (mode !== 'restart' && mode !== 'logout') throw new TypeError('mode must be restart or logout');
      this.stopped = false;
      this.fatal = false;
      const generation = this.#nextGeneration();
      const prior = this.socket;
      const credentialSave = this.#detach();
      await credentialSave;
      if (mode === 'logout') {
        this.handler?.close?.();
        this.handler = null;
        this.#resetMemory();
        this.state.update({ state: 'disconnected', phone: undefined, connectedAt: undefined });
        this.#requestRemoteLogout(prior);
        await this.#clearAuth();
      }
      this.#closeSocket(prior);
      this.socket = null;
      try {
        await this.#open(generation);
      } catch (error) {
        this.state.update({ state: 'disconnected', lastError: 'Unable to start WhatsApp connection.' });
        throw error;
      }
    });
  }

  stop() {
    return this.#serialize(async () => {
      this.stopped = true;
      this.fatal = false;
      this.#nextGeneration();
      const prior = this.socket;
      const credentialSave = this.#detach();
      this.socket = null;
      this.handler?.close?.();
      this.handler = null;
      this.#closeSocket(prior);
      await credentialSave;
      this.state.update({ state: 'disconnected' });
    });
  }

  #serialize(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async #open(generation) {
    if (this.stopped || this.fatal || generation !== this.generation) return;
    this.state.update({ state: 'connecting', lastError: undefined });
    const { state: auth, saveCreds } = await this.authStateFactory(this.authDir);
    if (this.stopped || this.fatal || generation !== this.generation) return;
    const baileysLogger = this.#silentLogger();
    const socket = await this.socketFactory({ auth, logger: baileysLogger, printQRInTerminal: false });
    if (this.stopped || this.fatal || generation !== this.generation) {
      this.#closeSocket(socket);
      return;
    }
    this.socket = socket;
    const handler = this.#messageHandler();
    let saveQueue = Promise.resolve();
    const onCreds = () => {
      saveQueue = saveQueue.then(() => saveCreds()).catch(() => {
        this.logger.error({ event: 'whatsapp_credentials_save_failed' }, 'Could not save WhatsApp credentials');
      });
    };
    const onConnection = (update) => {
      void this.#connectionUpdate(socket, generation, update).catch(() => {
        if (generation === this.generation && !this.stopped) {
          this.state.update({ state: 'disconnected', lastError: 'WhatsApp connection failed.' });
        }
        this.logger.error({ event: 'whatsapp_connection_failed' }, 'WhatsApp connection failed');
      });
    };
    const onMessages = (event) => {
      void handler.handleUpsert(socket, event, {
        isActive: () => this.#isCurrent(socket, generation),
      }).catch(() => {
        this.logger.error({ event: 'whatsapp_message_handler_failed' }, 'Message handler failed');
      });
    };
    socket.ev.on('creds.update', onCreds);
    socket.ev.on('connection.update', onConnection);
    socket.ev.on('messages.upsert', onMessages);
    this.listeners = { socket, onCreds, onConnection, onMessages, getSaveQueue: () => saveQueue };
  }

  async #connectionUpdate(socket, generation, update = {}) {
    if (!this.#isCurrent(socket, generation)) return;
    if (update.qr) {
      const qrToken = ++this.qrToken;
      try {
        const dataUrl = await this.qrRenderer(update.qr);
        if (this.#isCurrent(socket, generation) && qrToken === this.qrToken) this.state.setQR(dataUrl, 60_000);
      } catch {
        if (this.#isCurrent(socket, generation) && qrToken === this.qrToken) {
          this.state.update({ state: 'disconnected', lastError: 'Unable to render pairing code.' });
        }
      }
    }
    if (update.connection === 'open') {
      ++this.qrToken;
      this.reconnectAttempt = 0;
      this.state.update({
        state: 'connected',
        phone: phoneFromJid(socket.user?.id),
        connectedAt: new Date().toISOString(),
        lastError: undefined,
      });
      this.logger.info({ event: 'whatsapp_connected' }, 'WhatsApp connected');
      return;
    }
    if (update.connection !== 'close') return;

    const code = statusCode(update.lastDisconnect?.error);
    const credentialSave = this.#detach(socket);
    this.#closeSocket(socket);
    if (this.socket === socket) this.socket = null;
    await credentialSave;
    if (generation !== this.generation || this.stopped) return;
    if (code === 401) {
      await this.#serialize(async () => {
        if (generation !== this.generation || this.stopped) return;
        this.#cancelReconnect();
        this.fatal = true;
        this.state.update({ state: 'disconnected', lastError: 'WhatsApp session logged out.' });
        this.handler?.close?.();
        this.handler = null;
        this.#resetMemory();
        this.state.update({ state: 'disconnected', phone: undefined, connectedAt: undefined });
        await this.#clearAuth();
      });
      return;
    }
    this.state.update({ state: 'disconnected', lastError: 'WhatsApp connection closed.' });
    await this.#reconnect(generation);
  }

  async #reconnect(generation) {
    while (this.#isGenerationActive(generation) && !this.socket) {
      const attempt = this.reconnectAttempt++;
      const base = Math.min(60_000, 1_000 * (2 ** Math.min(attempt, 6)));
      const delay = Math.min(60_000, Math.round(base + base * 0.2 * this.random()));
      const controller = new AbortController();
      this.#cancelReconnect();
      this.reconnectController = controller;
      try {
        await this.sleep(delay, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        throw error;
      } finally {
        if (this.reconnectController === controller) this.reconnectController = null;
      }
      if (!this.#isGenerationActive(generation)) return;
      const opened = await this.#serialize(async () => {
        if (!this.#isGenerationActive(generation) || this.socket) return null;
        try {
          await this.#open(generation);
          return Boolean(this.socket);
        } catch {
          this.state.update({ state: 'disconnected', lastError: 'Unable to reconnect WhatsApp.' });
          this.logger.warn({ event: 'whatsapp_reconnect_failed' }, 'WhatsApp reconnect failed');
          return false;
        }
      });
      if (opened !== false) return;
    }
  }

  #messageHandler() {
    if (!this.handler) {
      this.handler = createMessageHandler({
        settingsRepo: this.settingsRepo,
        aiService: this.aiService,
        logger: this.logger,
      });
    }
    return this.handler;
  }

  #nextGeneration() {
    this.#cancelReconnect();
    this.generation += 1;
    return this.generation;
  }

  #cancelReconnect() {
    this.reconnectController?.abort();
    this.reconnectController = null;
  }

  #requestRemoteLogout(socket) {
    try {
      Promise.resolve(socket?.logout?.()).catch(() => {
        this.logger.warn({ event: 'whatsapp_logout_failed' }, 'WhatsApp logout failed');
      });
    } catch {
      this.logger.warn({ event: 'whatsapp_logout_failed' }, 'WhatsApp logout failed');
    }
  }

  #resetMemory() {
    try {
      this.aiService?.resetMemory?.();
    } catch {
      this.logger.warn({ event: 'whatsapp_memory_reset_failed' }, 'Conversation memory reset failed');
    }
  }

  #isCurrent(socket, generation) {
    return this.socket === socket && this.#isGenerationActive(generation);
  }

  #isGenerationActive(generation) {
    return !this.stopped && !this.fatal && generation === this.generation;
  }

  #silentLogger() {
    try {
      return this.logger.child({ component: 'baileys' }, { level: 'silent' });
    } catch {
      return { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child() { return this; } };
    }
  }

  #detach(onlySocket) {
    const listeners = this.listeners;
    if (!listeners || (onlySocket && listeners.socket !== onlySocket)) return Promise.resolve();
    const { socket, onCreds, onConnection, onMessages, getSaveQueue } = listeners;
    socket.ev.off?.('creds.update', onCreds);
    socket.ev.off?.('connection.update', onConnection);
    socket.ev.off?.('messages.upsert', onMessages);
    this.listeners = null;
    return getSaveQueue();
  }

  #closeSocket(socket) {
    if (!socket) return;
    try {
      Promise.resolve(socket.end?.()).catch(() => {});
    } catch { /* best effort */ }
  }

  async #clearAuth() {
    const expected = path.join(this.storageDir, 'auth_info');
    if (path.dirname(expected) !== this.storageDir || path.basename(expected) !== 'auth_info') {
      throw new Error('Refusing to clear an unsafe auth path');
    }
    await rm(expected, { recursive: true, force: true });
  }
}
