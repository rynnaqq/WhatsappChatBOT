import { jidDecode } from '@whiskeysockets/baileys';

import { normalizePhoneNumber } from '../config/access.js';

const DEFAULT_LOOKUP_TIMEOUT_MS = 1_000;
const PN_SERVERS = new Set(['c.us', 's.whatsapp.net', 'hosted']);
const LID_SERVERS = new Set(['lid', 'hosted.lid']);
const OWN = Object.prototype.hasOwnProperty;

function accessPolicy(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  if (!settings.bot || typeof settings.bot !== 'object' || Array.isArray(settings.bot)) return null;

  const mode = settings.bot.accessMode;
  if (mode === undefined || mode === 'everyone') return { mode: 'everyone' };
  if (mode !== 'owner-only' && mode !== 'allowlist') return null;

  const owner = normalizePhoneNumber(settings.bot.ownerNumber);
  if (!owner || owner !== settings.bot.ownerNumber) return null;
  if (mode === 'owner-only') return { mode, numbers: new Set([owner]) };
  if (!Array.isArray(settings.bot.allowedNumbers)) return null;

  const numbers = new Set([owner]);
  for (const value of settings.bot.allowedNumbers) {
    const normalized = normalizePhoneNumber(value);
    if (!normalized || normalized !== value) return null;
    numbers.add(normalized);
  }
  return { mode, numbers };
}

function parseAuthorJid(value) {
  if (typeof value !== 'string') return null;
  const exact = /^([1-9]\d*)(?::(\d+))?@(c\.us|s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.exec(value);
  if (!exact) return null;
  const decoded = jidDecode(value);
  if (!decoded || decoded.user !== exact[1] || decoded.server !== exact[3]) return null;

  if (PN_SERVERS.has(decoded.server)) {
    const phone = normalizePhoneNumber(decoded.user);
    return phone ? { kind: 'pn', phone } : null;
  }
  if (LID_SERVERS.has(decoded.server)) {
    return { kind: 'lid', jid: `${decoded.user}@${decoded.server}` };
  }
  return null;
}

function trustedAuthorFields(message) {
  const key = message?.key;
  if (!key || typeof key !== 'object') return null;
  const isGroup = typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@g.us');
  const primaryName = isGroup ? 'participant' : 'remoteJid';
  const alternateName = isGroup ? 'participantAlt' : 'remoteJidAlt';
  const primary = parseAuthorJid(key[primaryName]);
  if (!primary) return null;
  if (!OWN.call(key, alternateName) || key[alternateName] === undefined) return [primary];
  const alternate = parseAuthorJid(key[alternateName]);
  return alternate ? [primary, alternate] : null;
}

async function lookupWithDeadline(lookup, lid, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => lookup(lid)),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function isSenderAuthorized({
  sock,
  message,
  settings,
  timeoutMs = DEFAULT_LOOKUP_TIMEOUT_MS,
}) {
  const policy = accessPolicy(settings);
  if (!policy) return false;
  if (policy.mode === 'everyone') return true;

  const authors = trustedAuthorFields(message);
  if (!authors) return false;
  const phones = new Set(authors.filter(({ kind }) => kind === 'pn').map(({ phone }) => phone));
  const lids = new Set(authors.filter(({ kind }) => kind === 'lid').map(({ jid }) => jid));
  if (phones.size > 1 || lids.size > 1) return false;

  const lookup = sock?.signalRepository?.lidMapping?.getPNForLID;
  for (const lid of lids) {
    if (typeof lookup !== 'function') {
      if (!phones.size) return false;
      continue;
    }
    const mapped = await lookupWithDeadline(
      lookup.bind(sock.signalRepository.lidMapping),
      lid,
      Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : DEFAULT_LOOKUP_TIMEOUT_MS,
    );
    if (mapped === undefined) return false;
    if (mapped === null) {
      if (!phones.size) return false;
      continue;
    }
    const identity = parseAuthorJid(mapped);
    if (!identity || identity.kind !== 'pn') return false;
    phones.add(identity.phone);
    if (phones.size > 1) return false;
  }

  return phones.size === 1 && policy.numbers.has(phones.values().next().value);
}
