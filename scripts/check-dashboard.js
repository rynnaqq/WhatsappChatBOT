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
const baseOrigin = new URL(baseURL).origin;
const viewportWidths = [1440, 768, 360, 320];
const providerFixtureModel = 'test-vision-model';
const longLayoutModel = 'openrouter/meta-llama/llama-3.3-70b-instruct:free';
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

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(
    Math.max(dimensions.body, dimensions.document) <= dimensions.viewport,
    `${label} must not overflow horizontally: ${JSON.stringify(dimensions)}`,
  );
}

async function assertManropeLoaded(page) {
  await page.evaluate(() => document.fonts.ready);
  const font = await page.evaluate(() => ({
    bodyFamily: getComputedStyle(document.body).fontFamily,
    check: document.fonts.check('16px Manrope'),
    faces: [...document.fonts]
      .filter((face) => face.family.replace(/["']/g, '').toLowerCase() === 'manrope')
      .map((face) => ({ family: face.family, status: face.status })),
  }));
  assert.match(font.bodyFamily, /Manrope/i, 'The rendered page must use Manrope');
  assert.equal(font.check, true, 'Manrope must be available to the document');
  assert.ok(font.faces.length > 0, 'The local Manrope font face must be registered');
  assert.deepEqual(font.faces.map((face) => face.status), font.faces.map(() => 'loaded'), 'Every Manrope font face must load');
}

async function assertSectionNavigation(page, width) {
  const link = page.locator('.nav-link[href="#provider"]');
  await link.click();
  await page.waitForFunction(() => location.hash === '#provider');
  assert.equal(await link.evaluate((element) => element.classList.contains('active')), true, 'Clicked navigation link must become active');
  assert.equal(await page.locator('.nav-link.active').count(), 1, 'Exactly one dashboard navigation link must be active');
  assert.equal(await page.locator('#provider-title').isVisible(), true, 'Navigation target heading must remain visible');

  if (width > 820) {
    const placement = await page.evaluate(() => {
      const heading = document.querySelector('#provider-title');
      const stickyBottom = [...document.querySelectorAll('body *')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.position === 'sticky' && rect.top <= 1 && rect.width >= window.innerWidth * 0.75;
        })
        .reduce((bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom), 0);
      return { headingTop: heading.getBoundingClientRect().top, stickyBottom };
    });
    assert.ok(
      placement.headingTop >= placement.stickyBottom - 1,
      `Provider heading must not be hidden behind the sticky desktop header: ${JSON.stringify(placement)}`,
    );
  }
}

async function waitForKeyboardScroll(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let previousX = window.scrollX;
    let previousY = window.scrollY;
    let stableFrames = 0;
    let totalFrames = 0;
    const check = () => {
      totalFrames += 1;
      if (window.scrollX === previousX && window.scrollY === previousY) stableFrames += 1;
      else stableFrames = 0;
      previousX = window.scrollX;
      previousY = window.scrollY;
      if (stableFrames >= 2 || totalFrames >= 20) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
}

async function focusedSettingsState(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const form = document.querySelector('#settings-form');
    const insideSettings = active instanceof HTMLElement && form?.contains(active);
    const identifier = active instanceof HTMLElement ? active.id || `${active.tagName.toLowerCase()}[name="${active.getAttribute('name') || ''}"]` : '';
    if (!insideSettings) return { insideSettings: false, identifier };

    const rect = active.getBoundingClientRect();
    const nav = document.querySelector('.sidebar');
    const navRect = nav?.getBoundingClientRect();
    const navPosition = nav ? getComputedStyle(nav).position : '';
    const navOverlaysTop = ['fixed', 'sticky'].includes(navPosition) && navRect.top <= 0 && navRect.bottom > 0;
    const saveBar = document.querySelector('.save-bar');
    const saveRect = saveBar?.getBoundingClientRect();
    const savePosition = saveBar ? getComputedStyle(saveBar).position : '';
    const saveBarOverlaysBottom = !saveBar?.contains(active)
      && ['fixed', 'sticky'].includes(savePosition)
      && saveRect.bottom > 0
      && saveRect.top < window.innerHeight;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);

    return {
      insideSettings: true,
      identifier,
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
      topBoundary: navOverlaysTop ? navRect.bottom : 0,
      bottomBoundary: saveBarOverlaysBottom ? saveRect.top : window.innerHeight,
      centerHit: hit instanceof HTMLElement ? hit.id || hit.tagName.toLowerCase() : '',
      centerResolvesControl: hit === active || active.contains(hit),
    };
  });
}

function assertFocusedSettingsControl(state, viewportLabel) {
  assert.ok(state.rect.left >= 0 && state.rect.right <= state.viewport.width, `${state.identifier} must fit horizontally at ${viewportLabel}: ${JSON.stringify(state)}`);
  assert.ok(state.rect.top >= state.topBoundary, `${state.identifier} must clear the sticky navigation at ${viewportLabel}: ${JSON.stringify(state)}`);
  assert.ok(state.rect.bottom <= state.bottomBoundary, `${state.identifier} must clear the sticky save bar at ${viewportLabel}: ${JSON.stringify(state)}`);
  assert.equal(state.centerResolvesControl, true, `${state.identifier} center must remain pointer-visible at ${viewportLabel}: ${JSON.stringify(state)}`);
}

async function traverseSettingsControls(page, key, expected, viewportLabel) {
  const visited = [];
  let enteredSettings = false;
  for (let step = 0; step < expected.length + 30; step += 1) {
    await page.keyboard.press(key);
    await waitForKeyboardScroll(page);
    const state = await focusedSettingsState(page);
    if (state.insideSettings) {
      enteredSettings = true;
      assertFocusedSettingsControl(state, viewportLabel);
      visited.push(state.identifier);
    } else if (enteredSettings) break;
  }
  assert.equal(enteredSettings, true, `${key} traversal must reach the settings form at ${viewportLabel}`);
  assert.deepEqual(visited, expected, `${key} traversal must visit each enabled, visible settings control once at ${viewportLabel}`);
}

async function assertKeyboardUsability(page, width, height) {
  const viewportLabel = `${width}x${height}px`;
  if (width <= 768) {
    const navigation = page.locator('.nav-link');
    for (let index = 0; index < await navigation.count(); index += 1) {
      const link = navigation.nth(index);
      assert.equal(await link.isVisible(), true, `Navigation link ${index + 1} must be visible at ${viewportLabel}`);
      const box = await link.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `Navigation link ${index + 1} must fit at ${viewportLabel}`);
    }
  }

  const expected = await page.locator('#settings-form :is(input, select, textarea, button)').evaluateAll((controls) => controls
    .filter((control) => {
      const style = getComputedStyle(control);
      return !control.matches(':disabled')
        && control.tabIndex >= 0
        && control.getClientRects().length > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    })
    .map((control) => control.id || `${control.tagName.toLowerCase()}[name="${control.getAttribute('name') || ''}"]`));
  assert.ok(expected.length > 0, `Settings controls must be available at ${viewportLabel}`);

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await waitForKeyboardScroll(page);
  await traverseSettingsControls(page, 'Tab', expected, viewportLabel);
  await traverseSettingsControls(page, 'Shift+Tab', [...expected].reverse(), viewportLabel);
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  for (const width of viewportWidths) {
    const height = width === 320 ? 560 : width <= 768 ? 667 : 1000;
    state.update({ state: 'disconnected', qr: undefined, qrExpiresAt: undefined, phone: undefined, connectedAt: undefined });
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', colorScheme: 'dark' });
    const page = await context.newPage();
    currentPage = page;
    const externalAssetRequests = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !(message.location().url.endsWith('/api/auth/login') && message.text().includes('401'))) problems.push(message.text());
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== baseOrigin && !['fetch', 'xhr'].includes(request.resourceType())) {
        externalAssetRequests.push({ type: request.resourceType(), url: request.url() });
      }
    });
    await page.goto(baseURL);
    await page.getByRole('heading', { name: 'Welcome to Relay' }).waitFor();
    await assertManropeLoaded(page);
    await page.screenshot({ path: `test-results/dashboard-login-${width}.png`, fullPage: false });
    const loginAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(loginAudit.violations.map((v) => v.id), [], 'Login accessibility violations');
    await page.getByLabel('Dashboard password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Incorrect password' }).waitFor();
    await page.getByLabel('Dashboard password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Your assistant’s workspace.' }).waitFor();
    await page.locator('#live-text').filter({ hasText: 'Live updates' }).waitFor();
    await page.locator('#status-label').filter({ hasText: 'Disconnected' }).waitFor();
    await assertManropeLoaded(page);
    await assertNoHorizontalOverflow(page, `Disconnected dashboard at ${width}px`);
    await assertSectionNavigation(page, width);
    await page.getByLabel('Base URL').fill(providerURL);
    await page.getByLabel(/^API key/).fill('fake-browser-provider-key');
    await page.getByLabel('Model name').fill(providerFixtureModel);
    await page.getByLabel('Command prefix').fill('?');
    assert.equal(await page.getByLabel('Reply style', { exact: true }).count(), 1);
    assert.equal(await page.getByLabel('Sticker replies', { exact: true }).count(), 1);
    await page.getByLabel('Reply style', { exact: true }).selectOption('custom');
    await page.getByLabel('Sticker replies', { exact: true }).selectOption('on-request');
    await page.getByLabel('Files, audio and video').check();
    await page.getByLabel(/^File size limit/).fill('12');
    await page.getByLabel('Attachment format', { exact: true }).selectOption('9router-gemini');
    await saveSettings(page);
    assert.equal(await page.getByLabel(/^API key/).inputValue(), '');
    assert.equal((await page.content()).includes('fake-browser-provider-key'), false);
    assert.equal(repo.get().ai.mediaEnabled, true);
    assert.equal(repo.get().ai.maxFileMB, 12);
    assert.equal(repo.get().ai.attachmentTransport, '9router-gemini');
    assert.equal(repo.get().bot.personaStyle, 'custom');
    assert.equal(repo.get().bot.stickerReplies, 'on-request');
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Connection successful' }).waitFor();
    await page.getByLabel('Model name').fill(longLayoutModel);
    await saveSettings(page);
    await page.locator('#model-summary').filter({ hasText: longLayoutModel }).waitFor();
    assert.equal(repo.get().ai.model, longLayoutModel);
    await assertNoHorizontalOverflow(page, `Saved dashboard with a long model ID at ${width}px`);
    await page.getByLabel('Model name').fill(providerFixtureModel);
    await saveSettings(page);
    assert.equal(repo.get().ai.model, providerFixtureModel);
    await assertKeyboardUsability(page, width, height);
    await page.getByLabel(/^Private chats only/).check();
    assert.equal(await page.getByLabel('Group chat replies').isDisabled(), true);
    await saveSettings(page);
    const qr = await QRCode.toDataURL('browser-verification-only');
    state.update({ state: 'qr_required', qr, qrExpiresAt: new Date(Date.now() + 60000).toISOString() });
    state.emit('qr', { dataUrl: qr, expiresInMs: 60000 });
    await page.locator('#qr-image').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#qr-image').getAttribute('src'), qr);
    const qrPresentation = await page.locator('#qr-image').evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { filter: style.filter, opacity: style.opacity, width: rect.width, height: rect.height, naturalWidth: element.naturalWidth };
    });
    assert.equal(qrPresentation.filter, 'none', 'Pairing QR must not have a visual filter');
    assert.equal(qrPresentation.opacity, '1', 'Pairing QR must be fully opaque');
    assert.ok(qrPresentation.width > 0 && qrPresentation.height > 0 && qrPresentation.naturalWidth > 0, 'Pairing QR must be rendered and decoded');
    await assertNoHorizontalOverflow(page, `Pairing dashboard at ${width}px`);
    await page.locator('.nav-link[href="#connection"]').click();
    await page.waitForFunction(() => location.hash === '#connection');
    await page.screenshot({ path: `test-results/dashboard-pairing-${width}.png`, fullPage: false });
    state.update({ state: 'connected', qr: undefined, phone: '6281234567890', connectedAt: '2026-10-08T12:00:00.000Z' });
    await page.locator('#status-label').filter({ hasText: 'Connected' }).waitFor();
    await page.locator('#phone-number').filter({ hasText: '6281234567890' }).waitFor();
    await assertNoHorizontalOverflow(page, `Connected dashboard at ${width}px`);
    await page.locator('.nav-link[href="#connection"]').click();
    await page.waitForFunction(() => location.hash === '#connection');
    await page.screenshot({ path: `test-results/dashboard-connected-${width}.png`, fullPage: false });
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
    await page.reload();
    await page.locator('#save-state').filter({ hasText: 'All changes saved' }).waitFor();
    assert.equal(await page.getByLabel('Command prefix').inputValue(), '?');
    assert.equal(await page.getByLabel('Files, audio and video').isChecked(), true);
    assert.equal(await page.getByLabel(/^File size limit/).inputValue(), '12');
    assert.equal(await page.getByLabel('Attachment format', { exact: true }).inputValue(), '9router-gemini');
    assert.equal(await page.getByLabel('Reply style', { exact: true }).inputValue(), 'custom');
    assert.equal(await page.getByLabel('Sticker replies', { exact: true }).inputValue(), 'on-request');
    await page.getByLabel('Reply style', { exact: true }).selectOption('feminine');
    await page.getByLabel('Sticker replies', { exact: true }).selectOption('contextual');
    await saveSettings(page);
    assert.equal(repo.get().bot.personaStyle, 'feminine');
    assert.equal(repo.get().bot.stickerReplies, 'contextual');
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
    state.update({ state: 'connected', qr: undefined, phone: '6281234567890', connectedAt: '2026-10-08T12:00:00.000Z' });
    await page.locator('#status-label').filter({ hasText: 'Connected' }).waitFor();
    await assertNoHorizontalOverflow(page, `Final saved dashboard at ${width}px`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
    assert.deepEqual(externalAssetRequests, [], `External font or CDN asset requests at ${width}px`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome to Relay' }).waitFor();
    results.push({ width, height, passed: true, accessibilityViolations: 0 });
    await context.close();
  }
  assert.deepEqual(problems, [], 'Browser errors');
  await writeFile('test-results/dashboard-check.json', JSON.stringify({ results, browserErrors: problems }, null, 2));
  console.log(`Dashboard checks passed at ${viewportWidths.join('px, ')}px: responsive layout, local font loading, navigation, settings, provider test, QR/status, keyboard dialogs, restart/logout, persistence, sign-out, screenshots, and WCAG AA audits.`);
} catch (error) {
  await currentPage?.screenshot({ path: 'test-results/dashboard-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await web.close();
  await new Promise((resolve) => { provider.close(resolve); provider.closeIdleConnections(); });
  await rm(storageDir, { recursive: true, force: true });
}
