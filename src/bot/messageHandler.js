import { jidNormalizedUser } from '@whiskeysockets/baileys';

import { downloadImageMessage, downloadIncomingMedia, MediaUserFacingError } from './mediaService.js';
import { loadSticker } from './stickerService.js';
import { isSenderAuthorized } from './userAccess.js';
import { isStickerRequest, stickerAllowed, stickerFallback } from '../services/replyPersona.js';

const GENERIC_FAILURE = "Sorry, I couldn't process that request right now.";
const DEFAULT_IMAGE_PROMPT = 'Describe this image.';
const DEFAULT_MEDIA_PROMPTS = {
  image: DEFAULT_IMAGE_PROMPT,
  sticker: 'Describe this sticker.',
  audio: 'Transcribe this audio.',
  video: 'Describe this video.',
  document: 'Summarize this document.',
};
const MEDIA_KEYS = [
  ['imageMessage', 'image'],
  ['stickerMessage', 'sticker'],
  ['audioMessage', 'audio'],
  ['videoMessage', 'video'],
  ['ptvMessage', 'video'],
  ['documentMessage', 'document'],
];
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];
const DEDUP_TTL_MS = 10 * 60_000;
const MAX_DEDUP_ENTRIES = 10_000;
const MAX_CHAT_QUEUES = 1_000;
const MAX_PENDING_PER_CHAT = 100;
const STICKER_COOLDOWN_MS = 120_000;

function unwrap(content) {
  let current = content;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const wrapper = WRAPPERS.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current;
}

function extract(content) {
  if (!content || content.protocolMessage) return null;
  if (typeof content.conversation === 'string') {
    return { text: content.conversation, mediaKind: null, usesVisionControls: false };
  }
  if (typeof content.extendedTextMessage?.text === 'string') {
    return { text: content.extendedTextMessage.text, mediaKind: null, usesVisionControls: false };
  }
  const mediaEntry = MEDIA_KEYS.find(([key]) => content[key]);
  if (mediaEntry) {
    const [key, mediaKind] = mediaEntry;
    const declaredMime = typeof content[key].mimetype === 'string'
      ? content[key].mimetype.split(';')[0].trim().toLowerCase() : '';
    return {
      text: typeof content[key].caption === 'string' ? content[key].caption : '',
      mediaKind,
      usesVisionControls: mediaKind === 'image' || mediaKind === 'sticker'
        || mediaKind === 'document' && declaredMime.startsWith('image/'),
    };
  }
  return null;
}

function contextInfo(content) {
  if (content?.extendedTextMessage && typeof content.extendedTextMessage.contextInfo === 'object') {
    return content.extendedTextMessage.contextInfo;
  }
  const mediaEntry = MEDIA_KEYS.find(([key]) => content?.[key]);
  if (mediaEntry && typeof content[mediaEntry[0]].contextInfo === 'object') {
    return content[mediaEntry[0]].contextInfo;
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value.toNumber === 'function') {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && Number.isInteger(value.low) && Number.isInteger(value.high)) {
    const parsed = (value.high >>> 0) * 0x1_0000_0000 + (value.low >>> 0);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function timestampMs(value) {
  const parsed = toNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}

function normalizeJid(jid) {
  if (typeof jid !== 'string') return '';
  return jidNormalizedUser(jid);
}

function normalizeIdentityJid(jid) {
  const normalized = normalizeJid(jid);
  return /^[^@:\s]+@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.test(normalized) ? normalized : '';
}

function botIdentities(sock) {
  const identities = new Set();
  for (const contact of [sock?.user, sock?.authState?.creds?.me]) {
    for (const jid of [contact?.id, contact?.lid, contact?.phoneNumber]) {
      const normalized = normalizeIdentityJid(jid);
      if (normalized) identities.add(normalized);
    }
  }
  return identities;
}

function isIgnoredJid(jid, sock) {
  if (typeof jid !== 'string' || !jid) return true;
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return true;
  return botIdentities(sock).has(normalizeIdentityJid(jid));
}

function isCurrentChat(quotedChatId, chatId, chatIdAlt) {
  if (quotedChatId === undefined || quotedChatId === null) return true;
  if (typeof quotedChatId !== 'string') return false;
  const normalizedQuoted = normalizeJid(quotedChatId);
  const normalizedChat = normalizeJid(chatId);
  if (normalizedQuoted && normalizedChat && normalizedQuoted === normalizedChat) return true;
  if (!normalizeIdentityJid(chatId)) return false;
  const normalizedAlt = normalizeIdentityJid(chatIdAlt);
  return Boolean(normalizedQuoted && normalizedAlt && normalizedQuoted === normalizedAlt);
}

function addressedToBot(content, chatId, chatIdAlt, identities) {
  if (!identities.size) return null;
  const context = contextInfo(content);
  if (!context) return null;

  const mentionedJids = Array.isArray(context.mentionedJid)
    ? context.mentionedJid.map(normalizeIdentityJid).filter(Boolean)
    : [];
  const mentionedBotJids = mentionedJids.filter((jid) => identities.has(jid));
  const otherMentionLocals = new Set(
    mentionedJids.filter((jid) => !identities.has(jid)).map((jid) => jid.split('@')[0]),
  );
  const replyToBot = typeof context.stanzaId === 'string'
    && context.stanzaId.trim().length > 0
    && identities.has(normalizeIdentityJid(context.participant))
    && isCurrentChat(context.remoteJid, chatId, chatIdAlt);
  if (!mentionedBotJids.length && !replyToBot) return null;
  return { mentionedBotJids, otherMentionLocals };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripBotMentions(text, botJids, protectedLocals) {
  let stripped = text;
  const localParts = new Set(Array.from(botJids, (jid) => jid.split('@')[0]));
  for (const local of localParts) {
    if (protectedLocals.has(local)) continue;
    const mention = new RegExp(`(?<![\\p{L}\\p{N}_@])@${escapeRegExp(local)}(?![\\p{L}\\p{N}_])`, 'gu');
    stripped = stripped.replace(mention, '');
  }
  return stripped.trim();
}

function safeSettings(value = {}) {
  return {
    ai: {
      visionEnabled: value.ai?.visionEnabled !== false,
      mediaEnabled: value.ai?.mediaEnabled !== false,
      maxImageMB: Number.isFinite(value.ai?.maxImageMB) && value.ai.maxImageMB > 0 ? value.ai.maxImageMB : 5,
      maxFileMB: Number.isFinite(value.ai?.maxFileMB) && value.ai.maxFileMB > 0 ? value.ai.maxFileMB : 10,
      timeoutSeconds: Number.isFinite(value.ai?.timeoutSeconds) && value.ai.timeoutSeconds > 0
        ? value.ai.timeoutSeconds : 60,
    },
    bot: {
      commandPrefix: typeof value.bot?.commandPrefix === 'string' ? value.bot.commandPrefix : '!',
      replyTrigger: value.bot?.replyTrigger === 'mention-or-reply' ? 'mention-or-reply' : 'prefix',
      stickerReplies: value.bot?.stickerReplies ?? 'contextual',
      privateChatsOnly: value.bot?.privateChatsOnly === true,
      groupRepliesEnabled: value.bot?.groupRepliesEnabled !== false,
      typingIndicator: value.bot?.typingIndicator !== false,
      maxMessageAgeSeconds: Number.isFinite(value.bot?.maxMessageAgeSeconds) && value.bot.maxMessageAgeSeconds >= 0
        ? value.bot.maxMessageAgeSeconds : 120,
      markRead: value.bot?.markRead === true,
      rateLimitPerMinute: Number.isInteger(value.bot?.rateLimitPerMinute) && value.bot.rateLimitPerMinute > 0
        ? value.bot.rateLimitPerMinute : 20,
    },
  };
}

function userMessage(error) {
  if ((error?.code === 'AI_USER_FACING' || error?.code === 'MEDIA_USER_FACING') && typeof error.message === 'string') {
    return error.message.slice(0, 500);
  }
  return GENERIC_FAILURE;
}

function policyValueFingerprint(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `string:${value.length}:${value}`;
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (!Array.isArray(value)) return 'object';
  return `array:${value.length}:[${value.map(policyValueFingerprint).join(',')}]`;
}

function accessPolicyFingerprint(settings) {
  const bot = settings?.bot;
  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) {
    return `bot:${policyValueFingerprint(bot)}`;
  }
  return [bot.accessMode, bot.ownerNumber, bot.allowedNumbers]
    .map(policyValueFingerprint)
    .join('|');
}

export function createMessageHandler({
  settingsRepo,
  aiService,
  logger,
  downloadImage = downloadImageMessage,
  downloadMedia = downloadIncomingMedia,
  now = Date.now,
  senderLookupTimeoutMs,
}) {
  const queues = new Map();
  const pending = new Map();
  const dedup = new Map();
  const rateWindows = new Map();
  const stickerTimes = new Map();
  let closed = false;

  async function senderAllowed(sock, msg, settings) {
    try {
      const authorize = (current) => isSenderAuthorized({
        sock,
        message: msg,
        settings: current,
        ...(senderLookupTimeoutMs === undefined ? {} : { timeoutMs: senderLookupTimeoutMs }),
      });
      const initial = settings ?? settingsRepo.get();
      const initialFingerprint = accessPolicyFingerprint(initial);
      const initiallyAllowed = await authorize(initial);
      const latest = settingsRepo.get();
      const latestFingerprint = accessPolicyFingerprint(latest);
      if (latestFingerprint === initialFingerprint) return initiallyAllowed;

      const currentlyAllowed = await authorize(latest);
      return accessPolicyFingerprint(settingsRepo.get()) === latestFingerprint && currentlyAllowed;
    } catch {
      return false;
    }
  }

  function pruneDedup(currentTime) {
    for (const [key, seenAt] of dedup) {
      if (currentTime - seenAt <= DEDUP_TTL_MS && dedup.size <= MAX_DEDUP_ENTRIES) break;
      dedup.delete(key);
    }
  }

  function firstMapKey(map) {
    return map.keys().next().value;
  }

  function acceptRate(chatId, limit, currentTime) {
    const cutoff = currentTime - 60_000;
    const recent = (rateWindows.get(chatId) ?? []).filter((seenAt) => seenAt > cutoff);
    if (recent.length >= limit) {
      rateWindows.set(chatId, recent);
      return false;
    }
    recent.push(currentTime);
    rateWindows.set(chatId, recent);
    if (rateWindows.size > MAX_CHAT_QUEUES) rateWindows.delete(firstMapKey(rateWindows));
    return true;
  }

  function enqueue(chatId, operation) {
    if (!queues.has(chatId) && queues.size >= MAX_CHAT_QUEUES) return Promise.resolve();
    const count = pending.get(chatId) ?? 0;
    if (count >= MAX_PENDING_PER_CHAT) return Promise.resolve();
    pending.set(chatId, count + 1);
    const prior = queues.get(chatId) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(operation);
    const tracked = task.finally(() => {
      const remaining = (pending.get(chatId) ?? 1) - 1;
      if (remaining > 0) pending.set(chatId, remaining);
      else pending.delete(chatId);
      if (queues.get(chatId) === tracked) queues.delete(chatId);
    });
    queues.set(chatId, tracked);
    return tracked;
  }

  async function process(sock, msg, chatId, text, mediaKind, usesVisionControls, config, isActive) {
    const canContinue = async () => {
      if (closed || !isActive()) return false;
      const allowed = await senderAllowed(sock, msg);
      return allowed && !closed && isActive();
    };
    if (!(await canContinue())) return;
    const messageId = msg.key?.id;
    let typingStarted = false;
    let stage = 'read_receipt';
    try {
      if (config.bot.markRead) await sock.readMessages([msg.key]);
      if (!(await canContinue())) return;
      if (config.bot.typingIndicator) {
        stage = 'typing';
        await sock.sendPresenceUpdate('composing', chatId);
        typingStarted = true;
        if (!(await canContinue())) return;
      }
      let attachment;
      if (mediaKind) {
        stage = 'attachment_validation';
        if (usesVisionControls && !config.ai.visionEnabled) {
          throw new MediaUserFacingError('Image messages are disabled.');
        }
        if (!usesVisionControls && !config.ai.mediaEnabled) {
          throw new MediaUserFacingError('File messages are disabled.');
        }
        const options = {
          maxBytes: Math.floor((usesVisionControls ? config.ai.maxImageMB : config.ai.maxFileMB) * 1024 * 1024),
          timeoutMs: config.ai.timeoutSeconds * 1000,
          logger,
        };
        stage = 'attachment_download';
        if (mediaKind === 'image') {
          const media = await downloadImage(sock, msg, options);
          const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
          attachment = {
            kind: 'image',
            buffer: media.buffer,
            mimeType: media.mimeType,
            fileName: media.fileName ?? `image.${extensions[media.mimeType] ?? 'bin'}`,
          };
        } else {
          attachment = await downloadMedia(msg, sock, options);
        }
        if (!(await canContinue())) return;
      }
      if (!(await canContinue())) return;
      stage = 'ai_request';
      const input = {
        chatId,
        text,
        ...(attachment ? { attachment } : {}),
        ...(attachment?.kind === 'image'
          ? { imageBuffer: attachment.buffer, mimeType: attachment.mimeType }
          : {}),
      };
      const reply = typeof aiService.replyWithMedia === 'function'
        ? await aiService.replyWithMedia(input) : await aiService.reply(input);
      if (!(await canContinue())) return;
      const replyText = typeof reply === 'string' ? reply : reply?.text;
      const stickerId = typeof reply === 'object' ? reply?.stickerId : null;
      let textSent = false;
      let stickerSent = false;
      if (typeof replyText === 'string' && replyText.trim()) {
        stage = 'reply_send';
        await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });
        textSent = true;
        if (!(await canContinue())) return;
      }
      const lastSticker = stickerTimes.get(chatId);
      const canSendSticker = stickerId && stickerAllowed(config, { text, attachment })
        && (isStickerRequest(text) || lastSticker === undefined || now() - lastSticker >= STICKER_COOLDOWN_MS);
      if (canSendSticker && await canContinue()) {
        stage = 'sticker_send';
        try {
          const sticker = await loadSticker(stickerId);
          if (sticker && await canContinue()) {
            await sock.sendMessage(chatId, { sticker }, { quoted: msg });
            stickerSent = true;
            stickerTimes.delete(chatId);
            stickerTimes.set(chatId, now());
            if (stickerTimes.size > MAX_CHAT_QUEUES) stickerTimes.delete(firstMapKey(stickerTimes));
          }
        } catch {
          logger?.warn?.({ event: 'sticker_reply_failed', messageId }, 'Sticker reply could not be sent.');
        }
      }
      if (!textSent && !stickerSent && await canContinue()) {
        stage = 'reply_send';
        await sock.sendMessage(chatId, { text: stickerFallback(stickerId) }, { quoted: msg });
        textSent = true;
      }
      if ((textSent || stickerSent) && await canContinue()) {
        logger?.info?.({ event: 'message_replied', messageId, stickerSent }, 'Message replied');
      }
    } catch (error) {
      if (!(await canContinue())) return;
      const reason = userMessage(error);
      const errorCode = error?.code === 'AI_USER_FACING' || error?.code === 'MEDIA_USER_FACING'
        ? error.code : 'INTERNAL_FAILURE';
      logger?.warn?.({ event: 'message_failed', messageId, stage, errorCode, reason }, 'Message processing failed');
      if (await canContinue()) {
        await sock.sendMessage(chatId, { text: reason }, { quoted: msg }).catch(() => {});
      }
    } finally {
      if (typingStarted && !closed && isActive()) {
        await sock.sendPresenceUpdate('paused', chatId).catch(() => {});
      }
    }
  }

  async function handleUpsert(sock, event, { isActive = () => true } = {}) {
    if (closed || event?.type !== 'notify' || !Array.isArray(event.messages) || !isActive()) return;
    const tasks = [];
    for (const msg of event.messages) {
      if (closed || !isActive() || msg?.key?.fromMe) continue;
      const chatId = msg?.key?.remoteJid;
      const messageId = msg?.key?.id;
      if (!messageId || isIgnoredJid(chatId, sock)) continue;
      let currentSettings;
      try {
        currentSettings = settingsRepo.get();
      } catch {
        continue;
      }
      if (!(await senderAllowed(sock, msg, currentSettings)) || closed || !isActive()) continue;
      const content = unwrap(msg.message);
      const extracted = extract(content);
      if (!extracted) continue;
      const config = safeSettings(currentSettings);
      const isGroup = chatId.endsWith('@g.us');
      if (isGroup && (config.bot.privateChatsOnly || !config.bot.groupRepliesEnabled)) continue;
      const sentAt = timestampMs(msg.messageTimestamp);
      const currentTime = now();
      if (sentAt !== undefined && currentTime - sentAt > config.bot.maxMessageAgeSeconds * 1000) continue;

      let text = extracted.text;
      if (config.bot.replyTrigger === 'mention-or-reply') {
        const identities = botIdentities(sock);
        const address = addressedToBot(content, chatId, msg.key?.remoteJidAlt, identities);
        if (isGroup && !address) continue;
        if (address) {
          text = stripBotMentions(
            text,
            address.mentionedBotJids.length ? identities : [],
            address.otherMentionLocals,
          );
        }
        if (!text.trim()) {
          if (!extracted.mediaKind) continue;
          text = DEFAULT_MEDIA_PROMPTS[extracted.mediaKind];
        }
      } else {
        const prefix = config.bot.commandPrefix;
        if (prefix) {
          if (!text.startsWith(prefix)) continue;
          text = text.slice(prefix.length).trimStart();
        }
        if (!text.trim()) {
          if (!extracted.mediaKind || prefix && !extracted.text) continue;
          text = DEFAULT_MEDIA_PROMPTS[extracted.mediaKind];
        }
      }

      const dedupKey = `${chatId}\u0000${messageId}`;
      pruneDedup(currentTime);
      if (dedup.has(dedupKey)) continue;
      dedup.set(dedupKey, currentTime);
      if (!acceptRate(chatId, config.bot.rateLimitPerMinute, currentTime)) continue;
      logger?.debug?.({ event: 'message_accepted', messageId }, 'Message accepted');
      tasks.push(enqueue(chatId, () => process(
        sock,
        msg,
        chatId,
        text,
        extracted.mediaKind,
        extracted.usesVisionControls,
        config,
        isActive,
      )));
    }
    await Promise.all(tasks);
  }

  function close() {
    closed = true;
    dedup.clear();
    rateWindows.clear();
    stickerTimes.clear();
  }

  return { handleUpsert, close };
}
