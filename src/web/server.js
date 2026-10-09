import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAuth, allowedOrigin } from './auth.js';
import { attachRealtime } from './realtime.js';
import { SettingsValidationError } from '../storage/settingsRepo.js';
import { AIConnectionTestError } from '../services/aiService.js';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));

export function createWebServer({ config, settingsRepo, state, bot, aiService, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  const auth = createAuth({ password: config.dashboardPassword, secret: config.sessionSecret, ttlMs: config.sessionTtlMs });
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && req.path === '/auth/login') return next();
    return auth.middleware(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if ((req.headers.origin && !allowedOrigin(req)) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Requests must come from this dashboard.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Send an application/json request.' });
    }
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) }));
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/logout', auth.logout);
  app.get('/api/status', (_req, res) => res.json(state.snapshot()));
  app.get('/api/settings', (_req, res) => res.json(settingsRepo.getPublic()));
  app.post('/api/settings', async (req, res) => {
    try { res.json(await settingsRepo.save(req.body)); }
    catch (error) {
      if (error instanceof SettingsValidationError) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: error.fields });
      logger?.error?.({ event: 'settings_save_failed' }, 'Unable to persist settings.');
      res.status(500).json({ error: 'Settings could not be saved. Your previous settings are still active.' });
    }
  });
  app.post('/api/bot/restart', (req, res) => {
    if (!req.body || !['restart', 'logout'].includes(req.body.mode) || Object.keys(req.body).some((key) => key !== 'mode')) return res.status(400).json({ error: 'Mode must be restart or logout.' });
    const mode = req.body.mode;
    res.status(202).json({ accepted: true, mode });
    Promise.resolve().then(() => bot.restart(mode)).catch(() => {
      logger?.error?.({ event: 'session_action_failed', mode }, 'Unable to change WhatsApp session.');
      state.update?.({ state: 'disconnected', lastError: 'Could not start the session. Try Restart Session again.' });
    });
  });
  app.post('/api/ai/test', async (_req, res) => {
    try { res.json(await aiService.testConnection()); }
    catch (error) {
      if (error instanceof AIConnectionTestError) return res.status(502).json({ error: error.message, code: error.code, providerStatus: error.providerStatus });
      res.status(502).json({ error: 'Could not reach the model. Check the saved URL, key, and model, then try again.' });
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.get(['/login', '/login.html'], (req, res) => {
    if (auth.getSession(req.headers.cookie)) return res.redirect('/');
    res.sendFile(path.join(publicDir, 'login.html'));
  });
  app.get(['/', '/index.html'], (req, res) => {
    if (!auth.getSession(req.headers.cookie)) return res.redirect('/login');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.use(express.static(publicDir, { index: false, dotfiles: 'deny', etag: false, maxAge: 0 }));
  app.use((_req, res) => res.status(404).send('Page not found.'));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request contains invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    logger?.error?.({ event: 'web_request_failed' }, 'Dashboard request failed.');
    res.status(500).json({ error: 'The request could not be completed.' });
  });
  const server = http.createServer(app);
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const realtime = attachRealtime({ server, state, auth, trustProxy: config.trustProxy, logger });
  return {
    app, server, realtime,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => { server.off('error', onError); resolve(server.address()); });
      });
    },
    async close() {
      await realtime.close();
      if (server.listening) await new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    },
  };
}
