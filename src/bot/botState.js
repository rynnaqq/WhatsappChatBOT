import { EventEmitter } from 'node:events';

const VALID_STATES = new Set(['disconnected', 'connecting', 'qr_required', 'connected']);
const ALLOWED_FIELDS = new Set(['state', 'phone', 'connectedAt', 'lastError', 'qr', 'qrExpiresAt']);

export class BotState extends EventEmitter {
  #value = { state: 'disconnected' };
  #qrTimer = null;

  snapshot() {
    return { ...this.#value };
  }

  update(payload = {}) {
    const next = { ...this.#value };
    for (const [key, value] of Object.entries(payload)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      if (value === undefined && key !== 'state') delete next[key];
      else if (value !== undefined) next[key] = value;
    }
    if (!VALID_STATES.has(next.state)) next.state = this.#value.state;
    if (next.state !== 'qr_required') {
      delete next.qr;
      delete next.qrExpiresAt;
      this.#clearQRExpiry();
    }
    this.#value = next;
    const snapshot = this.snapshot();
    this.emit('status', snapshot);
    return snapshot;
  }

  setQR(dataUrl, expiresInMs = 60_000) {
    const safeExpiry = Number.isFinite(expiresInMs) && expiresInMs > 0 ? expiresInMs : 60_000;
    this.#clearQRExpiry();
    this.#value = {
      ...this.#value,
      state: 'qr_required',
      qr: dataUrl,
      qrExpiresAt: new Date(Date.now() + safeExpiry).toISOString(),
    };
    this.emit('status', this.snapshot());
    this.emit('qr', { dataUrl, expiresInMs: safeExpiry });
    this.#qrTimer = setTimeout(() => {
      if (this.#value.qr !== dataUrl) return;
      this.#value = { ...this.#value, state: 'disconnected' };
      delete this.#value.qr;
      delete this.#value.qrExpiresAt;
      this.#qrTimer = null;
      this.emit('status', this.snapshot());
    }, safeExpiry);
    this.#qrTimer.unref?.();
  }

  #clearQRExpiry() {
    if (this.#qrTimer) clearTimeout(this.#qrTimer);
    this.#qrTimer = null;
  }
}
