const $ = (selector) => document.querySelector(selector);
const form = $('#settings-form');
const fieldsets = [...form.querySelectorAll('fieldset')];
const controls = [...form.elements].filter((input) => /^(ai|bot)\./.test(input.name));
const saveButton = $('#save-settings');
const testButton = $('#test-connection');
const notice = $('#notice');
const errorSummary = $('#form-error');
const dialog = $('#confirm-dialog');
const sessionButtons = [$('#restart-session'), $('#logout-whatsapp')];
const presets = {
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' },
  deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-flash' },
  ollama: { baseURL: 'http://localhost:11434/v1', model: 'gpt-oss:20b' },
};
let savedSettings;
let dirty = false;
let saving = false;
let pendingAction;
let socket;
let reconnectTimer;
let reconnectCount = 0;
let pageClosed = false;
let qrExpiry = 0;
let latestState;

async function request(url, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    if (response.status === 401) { dirty = false; location.assign('/login'); throw new Error('Your session has ended. Please sign in.'); }
    const result = await response.json();
    if (!response.ok) {
      const failure = new Error(result.error || 'The request could not be completed.');
      failure.fields = result.fields;
      throw failure;
    }
    return result;
  } catch (failure) {
    if (failure.name === 'AbortError') throw new Error('The request timed out. Please try again.');
    if (failure instanceof TypeError) throw new Error('Could not reach your server. Check your connection and try again.');
    throw failure;
  } finally { clearTimeout(timer); }
}

function clearErrors() {
  errorSummary.hidden = true;
  errorSummary.textContent = '';
  for (const input of controls) {
    input.removeAttribute('aria-invalid');
    const errorId = `error-${input.id}`;
    document.getElementById(errorId)?.remove();
    const ids = (input.getAttribute('aria-describedby') || '').split(' ').filter((id) => id && id !== errorId);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }
}
function showError(failure) {
  notice.textContent = '';
  errorSummary.textContent = failure.message;
  errorSummary.hidden = false;
  for (const [name, message] of Object.entries(failure.fields || {})) {
    const input = form.elements.namedItem(name);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const error = document.createElement('p');
    error.id = `error-${input.id}`;
    error.className = 'field-error';
    error.textContent = message;
    input.closest('.field')?.append(error);
    input.setAttribute('aria-describedby', `${input.getAttribute('aria-describedby') || ''} ${error.id}`.trim());
  }
  errorSummary.focus();
}
function payload() {
  const result = structuredClone(savedSettings);
  for (const input of controls) {
    const [group, name] = input.name.split('.');
    result[group][name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
  }
  if (!result.ai.apiKey) result.ai.apiKey = savedSettings.ai.apiKey;
  return result;
}
function providerChanged() {
  if (!savedSettings?.ai.apiKey) return true;
  try { return new URL($('#base-url').value).origin !== new URL(savedSettings.ai.baseURL).origin; } catch { return false; }
}
function updateFormState() {
  if (!savedSettings) return;
  dirty = JSON.stringify(payload()) !== JSON.stringify(savedSettings);
  $('#save-state').textContent = saving ? 'Saving changes…' : dirty ? 'You have unsaved changes' : 'All changes saved';
  saveButton.disabled = saving;
  testButton.disabled = saving || dirty || !savedSettings.ai.apiKey;
  $('#test-hint').textContent = dirty ? 'Save changes before testing.' : savedSettings.ai.apiKey ? 'Sends one small request to your saved model.' : 'Save a provider to test its connection.';
  const newKeyNeeded = providerChanged();
  $('#api-key').required = newKeyNeeded;
  $('#key-label-note').textContent = newKeyNeeded ? 'required' : 'saved securely';
  $('#api-key').placeholder = newKeyNeeded ? 'Enter a key for this provider' : 'Saved key · leave empty to keep';
  $('#group-replies').disabled = $('#private-chats').checked || saving;
  $('#group-help').textContent = $('#private-chats').checked ? 'Paused while private chats only is enabled.' : 'Allow the assistant to respond in groups.';
  const addressedOnly = $('#reply-trigger').value === 'mention-or-reply';
  $('#command-prefix').disabled = saving || addressedOnly;
  $('#trigger-help').textContent = addressedOnly
    ? 'Tag the bot or reply to one of its messages. Other messages are ignored.'
    : 'Start messages with the command prefix below.';
  $('#prefix-help').textContent = addressedOnly
    ? 'Command prefixes are ignored while tags or replies only is selected.'
    : 'Leave empty to reply to all eligible messages.';
  $('#prompt-count').textContent = `${$('#system-prompt').value.length.toLocaleString()} / 4,000`;
}
function fillSettings(settings) {
  savedSettings = settings;
  for (const input of controls) {
    const [group, name] = input.name.split('.');
    if (input.type === 'checkbox') input.checked = settings[group][name];
    else input.value = name === 'apiKey' ? '' : settings[group][name];
  }
  $('#api-key').type = 'password';
  $('#reveal-key').textContent = 'Show';
  $('#reveal-key').setAttribute('aria-pressed', 'false');
  $('#provider-preset').value = Object.entries(presets).find(([, preset]) => preset.baseURL.replace(/\/$/, '') === settings.ai.baseURL.replace(/\/$/, ''))?.[0] || 'custom';
  $('#provider-badge').textContent = settings.ai.apiKey ? 'CONFIGURED' : 'SETUP REQUIRED';
  $('#model-summary').textContent = settings.ai.model;
  $('#scope-summary').textContent = settings.bot.privateChatsOnly || !settings.bot.groupRepliesEnabled ? 'Private chats' : 'Private & group chats';
  $('#memory-summary').textContent = settings.bot.memoryLimit === 0 ? 'Disabled' : `Last ${settings.bot.memoryLimit} turns`;
  fieldsets.forEach((fieldset) => { fieldset.disabled = false; });
  updateFormState();
}
async function loadSettings() {
  $('#retry-settings').hidden = true;
  clearErrors();
  try { fillSettings(await request('/api/settings')); }
  catch (failure) { showError(failure); $('#save-state').textContent = 'Settings unavailable'; $('#retry-settings').hidden = false; }
}

form.addEventListener('input', (event) => {
  if (event.target.matches('[name]')) {
    event.target.removeAttribute('aria-invalid');
    document.getElementById(`error-${event.target.id}`)?.remove();
  }
  updateFormState();
});
$('#base-url').addEventListener('change', () => {
  $('#provider-preset').value = Object.entries(presets).find(([, preset]) => preset.baseURL === $('#base-url').value)?.[0] || 'custom';
  updateFormState();
});
$('#provider-preset').addEventListener('change', () => {
  const preset = presets[$('#provider-preset').value];
  if (preset) { $('#base-url').value = preset.baseURL; $('#model-name').value = preset.model; }
  updateFormState();
});
$('#reveal-key').addEventListener('click', () => {
  const visible = $('#api-key').type === 'password';
  $('#api-key').type = visible ? 'text' : 'password';
  $('#reveal-key').textContent = visible ? 'Hide' : 'Show';
  $('#reveal-key').setAttribute('aria-pressed', String(visible));
});
$('#retry-settings').addEventListener('click', loadSettings);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!savedSettings || saving || !form.reportValidity()) return;
  clearErrors();
  const next = payload();
  saving = true;
  fieldsets.forEach((fieldset) => { fieldset.disabled = true; });
  updateFormState();
  saveButton.textContent = 'Saving…';
  try {
    const result = await request('/api/settings', { method: 'POST', body: next });
    fillSettings(result);
    notice.textContent = 'Settings saved. Your changes apply to the next message.';
  } catch (failure) { showError(failure); }
  finally {
    saving = false;
    fieldsets.forEach((fieldset) => { fieldset.disabled = false; });
    saveButton.textContent = 'Save changes';
    updateFormState();
  }
});
testButton.addEventListener('click', async () => {
  clearErrors();
  testButton.disabled = true;
  testButton.textContent = 'Testing…';
  try {
    const result = await request('/api/ai/test', { method: 'POST', body: {}, timeoutMs: 310000 });
    notice.textContent = `Connection successful. ${result.model} responded in ${Math.round(result.latencyMs)} ms.`;
  } catch (failure) { showError(failure); }
  finally { testButton.textContent = 'Test connection'; updateFormState(); }
});

function hideQR() { qrExpiry = 0; $('#qr-image').hidden = true; $('#qr-image').removeAttribute('src'); $('#qr-placeholder').hidden = false; }
function showQR(dataUrl, expiresInMs) {
  if (!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(dataUrl) || expiresInMs <= 0 || latestState !== 'qr_required') return;
  qrExpiry = Date.now() + expiresInMs;
  $('#qr-image').src = dataUrl;
  $('#qr-image').hidden = false;
  $('#qr-placeholder').hidden = true;
  updateQRCaption();
}
function updateQRCaption() {
  if (!qrExpiry) return;
  const seconds = Math.max(0, Math.ceil((qrExpiry - Date.now()) / 1000));
  if (!seconds) {
    hideQR();
    $('#qr-placeholder-title').textContent = 'Pairing code expired';
    $('#qr-placeholder-note').textContent = 'Waiting for a fresh code from WhatsApp.';
    $('#qr-caption').textContent = 'Codes refresh automatically while pairing.';
    return;
  }
  $('#qr-caption').textContent = `Scan in Linked devices · refreshes in ${seconds}s`;
}
const descriptions = {
  disconnected: ['Disconnected', 'Your account is offline. Restart the session to connect or request a new pairing code.', 'No active pairing code', 'Restart the session to link an account.'],
  connecting: ['Connecting', 'Establishing a connection with WhatsApp. Saved sessions reconnect automatically.', 'Connecting to WhatsApp', 'Your pairing code will appear here if needed.'],
  qr_required: ['QR required', 'Scan the code with WhatsApp on your phone to link this account.', 'Preparing your pairing code', 'Codes refresh automatically while pairing.'],
  connected: ['Connected', 'Your account is connected. Eligible incoming messages will reach your configured assistant.', 'You’re connected', 'Your saved session is ready to receive messages.'],
};
function renderStatus(status) {
  if (!descriptions[status.state]) return;
  latestState = status.state;
  const [label, description, placeholder, note] = descriptions[status.state];
  $('#status-badge').className = `badge ${status.state}`;
  $('#status-label').textContent = label;
  $('#connection-description').textContent = description;
  $('#phone-number').textContent = status.phone ? `+${status.phone.replace(/^\+/, '')}` : 'No account linked';
  const date = status.connectedAt ? new Date(status.connectedAt) : undefined;
  $('#connected-at').textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  $('#session-detail').textContent = status.state === 'connected' ? 'Credentials saved on server' : status.state === 'qr_required' ? 'Awaiting QR scan' : label;
  $('#session-error').textContent = status.lastError || '';
  $('#session-error').hidden = !status.lastError;
  $('#qr-placeholder-title').textContent = placeholder;
  $('#qr-placeholder-note').textContent = note;
  if (status.state !== 'qr_required') { hideQR(); $('#qr-caption').textContent = status.state === 'connected' ? 'Session saved · reconnects automatically' : 'Open WhatsApp → Linked devices → Link a device.'; }
  else if (status.qr) showQR(status.qr, new Date(status.qrExpiresAt).getTime() - Date.now());
  else hideQR();
}
function connectRealtime() {
  if (pageClosed) return;
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('open', () => { reconnectCount = 0; $('#live-text').textContent = 'Live updates'; $('.live-indicator').classList.add('is-live'); });
  socket.addEventListener('message', ({ data }) => {
    try {
      const event = JSON.parse(data);
      if (event.type === 'status') renderStatus(event.payload);
      if (event.type === 'qr') showQR(event.payload.dataUrl, event.payload.expiresInMs);
    } catch { /* Ignore malformed events; later snapshots restore the current state. */ }
  });
  socket.addEventListener('close', (event) => {
    $('.live-indicator').classList.remove('is-live');
    if (pageClosed) return;
    if (event.code === 1008) { dirty = false; location.assign('/login'); return; }
    $('#live-text').textContent = 'Reconnecting · status may be outdated';
    hideQR();
    const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectCount++, 5)) + Math.random() * 500;
    reconnectTimer = setTimeout(connectRealtime, delay);
  });
}

function confirmSession(mode) {
  pendingAction = mode;
  $('#confirm-title').textContent = mode === 'logout' ? 'Log out of WhatsApp?' : 'Restart session?';
  $('#confirm-description').textContent = mode === 'logout' ? 'This removes the saved WhatsApp session and opens a fresh pairing code. You will need to scan it again.' : 'Your linked account will reconnect using its saved credentials. Replies currently being prepared may be interrupted.';
  $('#confirm-action').textContent = mode === 'logout' ? 'Log out of WhatsApp' : 'Restart session';
  $('#confirm-action').className = `button ${mode === 'logout' ? 'danger' : 'primary'}`;
  dialog.showModal();
}
$('#restart-session').addEventListener('click', () => confirmSession('restart'));
$('#logout-whatsapp').addEventListener('click', () => confirmSession('logout'));
$('#confirm-action').addEventListener('click', async () => {
  const mode = pendingAction;
  dialog.close();
  sessionButtons.forEach((button) => { button.disabled = true; });
  try { await request('/api/bot/restart', { method: 'POST', body: { mode } }); notice.textContent = mode === 'logout' ? 'Fresh pairing requested. Watch for the new QR code.' : 'Restart requested. Connection updates will appear here.'; }
  catch (failure) { showError(failure); }
  finally { sessionButtons.forEach((button) => { button.disabled = false; }); }
});
$('#sign-out').addEventListener('click', async () => {
  $('#sign-out').disabled = true;
  try { await request('/api/auth/logout', { method: 'POST', body: {} }); dirty = false; location.assign('/login'); }
  catch (failure) { showError(failure); $('#sign-out').disabled = false; }
});
for (const link of document.querySelectorAll('.nav-link')) link.addEventListener('click', () => { document.querySelector('.nav-link.active')?.classList.remove('active'); link.classList.add('active'); });
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { pageClosed = true; clearTimeout(reconnectTimer); socket?.close(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { pageClosed = false; connectRealtime(); } });
setInterval(updateQRCaption, 1000);
loadSettings();
connectRealtime();
