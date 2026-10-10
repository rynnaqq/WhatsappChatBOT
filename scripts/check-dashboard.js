import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import QRCode from 'qrcode';
import { createWebServer } from '../src/web/server.js';
import { SettingsRepo } from '../src/storage/settingsRepo.js';
import { AIService } from '../src/services/aiService.js';
import { MemoryService } from '../src/services/memoryService.js';

const password = 'browser-check-password-123';
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const storageDir = await mkdtemp(path.join(os.tmpdir(), 'wabot-ui-'));
const state = new EventEmitter();
let snapshot = { state: 'disconnected' };
state.snapshot = () => structuredClone(snapshot);
state.update = (value) => { snapshot = { ...snapshot, ...value }; state.emit('status', state.snapshot()); };
const config = { port: 0, host: '127.0.0.1', dashboardPassword: password, sessionSecret: 'a'.repeat(64), sessionTtlMs: 43_200_000, trustProxy: false };
const repo = new SettingsRepo({ storageDir, encryptionSecret: config.sessionSecret, logger });
await repo.init();
const provider = http.createServer(async (req, res) => {
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, 'test-vision-model');
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'local-test', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const providerURL = `http://127.0.0.1:${provider.address().port}/v1`;
const aiService = new AIService({ settingsRepo: repo, memory: new MemoryService(), logger });
let lastMode;
const bot = { async restart(mode) { lastMode = mode; state.update({ state: 'connecting', qr: undefined }); } };
const web = createWebServer({ config, settingsRepo: repo, state, bot, aiService, logger });
await web.listen();
const baseURL = `http://127.0.0.1:${web.server.address().port}`;
let browser;
let currentPage;
const results = [];
const problems = [];
await mkdir('test-results', { recursive: true });

async function saveSettings(page) {
  const [response] = await Promise.all([
    page.waitForResponse(result => result.url().endsWith('/api/settings') && result.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save changes', exact: true }).click(),
  ]);
  assert.equal(response.status(), 200, 'Settings save must complete successfully');
  await page.locator('#save-state').filter({ hasText: 'All changes saved' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Settings saved' }).waitFor();
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  for (const width of [1440, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !(message.location().url.endsWith('/api/auth/login') && message.text().includes('401'))) problems.push(message.text());
    });
    await page.goto(baseURL);
    await page.getByRole('heading', { name: 'Welcome to Relay' }).waitFor();
    const loginAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(loginAudit.violations.map((v) => v.id), [], 'Login accessibility violations');
    await page.getByLabel('Dashboard password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Incorrect password' }).waitFor();
    await page.getByLabel('Dashboard password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Your assistant’s workspace.' }).waitFor();
    await page.locator('#live-text').filter({ hasText: 'Live updates' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Overflow at ${width}px`);
    await page.getByLabel('Base URL').fill(providerURL);
    await page.getByLabel(/^API key/).fill('fake-browser-provider-key');
    await page.getByLabel('Model name').fill('test-vision-model');
    await page.getByLabel('Command prefix').fill('?');
    await page.getByLabel('Files, audio and video').check();
    await page.getByLabel(/^File size limit/).fill('12');
    await page.getByLabel('Attachment format', { exact: true }).selectOption('9router-gemini');
    await saveSettings(page);
    assert.equal(await page.getByLabel(/^API key/).inputValue(), '');
    assert.equal((await page.content()).includes('fake-browser-provider-key'), false);
    assert.equal(repo.get().ai.mediaEnabled, true);
    assert.equal(repo.get().ai.maxFileMB, 12);
    assert.equal(repo.get().ai.attachmentTransport, '9router-gemini');
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Connection successful' }).waitFor();
    await page.getByLabel(/^Private chats only/).check();
    assert.equal(await page.getByLabel('Group chat replies').isDisabled(), true);
    await saveSettings(page);
    const qr = await QRCode.toDataURL('browser-verification-only');
    state.update({ state: 'qr_required', qr, qrExpiresAt: new Date(Date.now() + 60000).toISOString() });
    state.emit('qr', { dataUrl: qr, expiresInMs: 60000 });
    await page.locator('#qr-image').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#qr-image').getAttribute('src'), qr);
    state.update({ state: 'connected', qr: undefined, phone: '6281234567890', connectedAt: '2026-10-08T12:00:00.000Z' });
    await page.locator('#status-label').filter({ hasText: 'Connected' }).waitFor();
    await page.locator('#phone-number').filter({ hasText: '6281234567890' }).waitFor();
    const restartButton = page.getByRole('button', { name: 'Restart session', exact: true });
    await restartButton.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await restartButton.evaluate((element) => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Restart session', exact: true }).click();
    await dialog.getByRole('button', { name: 'Restart session', exact: true }).click();
    await page.locator('#status-label').filter({ hasText: 'Connecting' }).waitFor();
    assert.equal(lastMode, 'restart');
    await page.getByRole('button', { name: 'Log out of WhatsApp', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Log out of WhatsApp?' }).waitFor();
    await dialog.getByRole('button', { name: 'Log out of WhatsApp', exact: true }).click();
    await page.locator('#notice').filter({ hasText: 'Fresh pairing requested' }).waitFor();
    assert.equal(lastMode, 'logout');
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `Dashboard accessibility at ${width}px`);
    await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
    await page.reload();
    await page.locator('#save-state').filter({ hasText: 'All changes saved' }).waitFor();
    assert.equal(await page.getByLabel('Command prefix').inputValue(), '?');
    assert.equal(await page.getByLabel('Files, audio and video').isChecked(), true);
    assert.equal(await page.getByLabel(/^File size limit/).inputValue(), '12');
    assert.equal(await page.getByLabel('Attachment format', { exact: true }).inputValue(), '9router-gemini');
    await page.getByLabel('Files, audio and video').uncheck();
    await saveSettings(page);
    assert.equal(repo.get().ai.mediaEnabled, false);
    await page.getByLabel('Reply trigger', { exact: true }).selectOption('mention-or-reply');
    assert.equal(await page.getByLabel('Command prefix').isDisabled(), true);
    await saveSettings(page);
    assert.equal(repo.get().bot.replyTrigger, 'mention-or-reply');
    assert.equal(repo.get().bot.commandPrefix, '?');
    await page.reload();
    await page.locator('#save-state').filter({ hasText: 'All changes saved' }).waitFor();
    assert.equal(await page.getByLabel('Reply trigger', { exact: true }).inputValue(), 'mention-or-reply');
    assert.equal(await page.getByLabel('Command prefix').isDisabled(), true);
    await page.getByLabel('Reply trigger', { exact: true }).selectOption('prefix');
    assert.equal(await page.getByLabel('Command prefix').isEnabled(), true);
    assert.equal(await page.getByLabel('Command prefix').inputValue(), '?');
    await saveSettings(page);
    assert.equal(repo.get().bot.replyTrigger, 'prefix');
    const triggerAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(triggerAudit.violations.map((v) => v.id), [], `Reply trigger accessibility at ${width}px`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome to Relay' }).waitFor();
    results.push({ width, passed: true, accessibilityViolations: 0 });
    await context.close();
  }
  assert.deepEqual(problems, [], 'Browser errors');
  await writeFile('test-results/dashboard-check.json', JSON.stringify({ results, browserErrors: problems }, null, 2));
  console.log('Dashboard checks passed at 1440px and 360px: login, settings, provider test, QR/status, keyboard dialogs, restart/logout, persistence, sign-out, and WCAG AA audits.');
} catch (error) {
  await currentPage?.screenshot({ path: 'test-results/dashboard-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await web.close();
  await new Promise((resolve) => { provider.close(resolve); provider.closeIdleConnections(); });
  await rm(storageDir, { recursive: true, force: true });
}
