import pino from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { readRuntimeEnv } from './config/runtimeEnv.js';
import { SettingsRepo } from './storage/settingsRepo.js';
import { AIService } from './services/aiService.js';
import { MemoryService } from './services/memoryService.js';
import { BotState } from './bot/botState.js';
import { WhatsAppBot } from './bot/socket.js';
import { createWebServer } from './web/server.js';

export async function startApplication(env = process.env) {
  const config = loadEnv(env);
  const logger = pino({
    level: config.logLevel,
    redact: { paths: ['apiKey', 'password', 'sessionSecret', 'ai.apiKey', '*.apiKey', '*.password', 'req.headers.cookie', 'req.headers.authorization', 'qr', '*.qr'], censor: '[redacted]' },
  });
  const settingsRepo = new SettingsRepo({ storageDir: config.storageDir, encryptionSecret: config.sessionSecret, maxTokensCeiling: config.maxTokensCeiling, logger });
  await settingsRepo.init();
  const memory = new MemoryService();
  const aiService = new AIService({ settingsRepo, memory, logger });
  const state = new BotState();
  const bot = new WhatsAppBot({ storageDir: config.storageDir, state, settingsRepo, aiService, logger });
  const web = createWebServer({ config, settingsRepo, state, bot, aiService, logger });
  await web.listen();
  logger.info({ event: 'dashboard_started', host: config.host, port: config.port }, 'Dashboard is ready.');
  try { await bot.start(); }
  catch { logger.error({ event: 'bot_start_failed' }, 'WhatsApp could not start. The dashboard is available; use Restart Session to retry.'); }
  let shutdownPromise;
  const shutdown = () => {
    if (!shutdownPromise) shutdownPromise = (async () => {
      logger.info({ event: 'shutdown' }, 'Stopping the application.');
      await bot.stop();
      await web.close();
    })();
    return shutdownPromise;
  };
  return { config, settingsRepo, memory, aiService, state, bot, web, shutdown };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const application = await startApplication(readRuntimeEnv());
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10000);
      deadline.unref();
      try { await application.shutdown(); clearTimeout(deadline); process.exitCode = 0; }
      catch { console.error('Shutdown did not complete. Check storage permissions.'); process.exitCode = 1; }
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error.message?.startsWith('Configuration error:') ? error.message : `Application startup failed${error.code === 'EADDRINUSE' ? ': PORT is already in use' : '. Check storage permissions and installed dependencies'}.`);
    process.exitCode = 1;
  }
}
