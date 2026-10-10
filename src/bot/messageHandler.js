import { jidNormalizedUser } from '@whiskeysockets/baileys';

import { downloadImageMessage } from './mediaService.js';

const GENERIC_FAILURE = "Sorry, I couldn't process that request right now.";
const DEFAULT_IMAGE_PROMPT = 'Describe this image.';
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const DEDUP_TTL_MS = 10 * 60_000;
const MAX_DEDUP_ENTRIES = 10_000;
const MAX_CHAT_QUEUES = 1_000;
const MAX_PENDING_PER_CHAT = 100;

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
  if (typeof content.conversation === 'string') return { text: content.conversation, image: false };
  if (typeof content.extendedTextMessage?.text === 'string') return { text: content.extendedTextMessage.text, image: false };
  if (content.imageMessage) {
    return {
      text: typeof content.imageMessage.caption === 'string' ? content.imageMessage.caption : '',
      image: true,
    };
  }
  return null;
}

function contextInfo(content) {
  if (content?.extendedTextMessage && typeof content.extendedTextMessage.contextInfo === 'object') {
    return content.extendedTextMessage.contextInfo;
  }
  if (content?.imageMessage && typeof content.imageMessage.contextInfo === 'object') {
    return content.imageMessage.contextInfo;
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
      maxImageMB: Number.isFinite(value.ai?.maxImageMB) && value.ai.maxImageMB > 0 ? value.ai.maxImageMB : 5,
      timeoutSeconds: Number.isFinite(value.ai?.timeoutSeconds) && value.ai.timeoutSeconds > 0
        ? value.ai.timeoutSeconds : 60,
    },
    bot: {
      commandPrefix: typeof value.bot?.commandPrefix === 'string' ? value.bot.commandPrefix : '!',
      replyTrigger: value.bot?.replyTrigger === 'mention-or-reply' ? 'mention-or-reply' : 'prefix',
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

export function createMessageHandler({ settingsRepo, aiService, logger, downloadImage = downloadImageMessage, now = Date.now }) {
  const queues = new Map();
  const pending = new Map();
  const dedup = new Map();
  const rateWindows = new Map();
  let closed = false;

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

  async function process(sock, msg, chatId, text, hasImage, config, isActive) {
    if (closed || !isActive()) return;
    const messageId = msg.key?.id;
    let typingStarted = false;
    try {
      if (config.bot.markRead) await sock.readMessages([msg.key]);
      if (closed || !isActive()) return;
      if (config.bot.typingIndicator) {
        await sock.sendPresenceUpdate('composing', chatId);
        typingStarted = true;
        if (closed || !isActive()) return;
      }
      let media;
      if (hasImage) {
        media = await downloadImage(sock, msg, {
          maxBytes: Math.floor(config.ai.maxImageMB * 1024 * 1024),
          timeoutMs: config.ai.timeoutSeconds * 1000,
          logger,
        });
        if (closed || !isActive()) return;
      }
      if (closed || !isActive()) return;
      const reply = await aiService.reply({
        chatId,
        text,
        ...(media ? { imageBuffer: media.buffer, mimeType: media.mimeType } : {}),
      });
      if (!closed && isActive() && typeof reply === 'string' && reply) {
        await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
      }
      logger?.info?.({ event: 'message_replied', messageId }, 'Message replied');
    } catch (error) {
      logger?.warn?.({ event: 'message_failed', messageId }, 'Message processing failed');
      if (!closed && isActive()) {
        await sock.sendMessage(chatId, { text: userMessage(error) }, { quoted: msg }).catch(() => {});
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
      const content = unwrap(msg.message);
      const extracted = extract(content);
      if (!extracted) continue;
      const config = safeSettings(settingsRepo.get());
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
          if (!extracted.image) continue;
          text = DEFAULT_IMAGE_PROMPT;
        }
      } else {
        const prefix = config.bot.commandPrefix;
        if (prefix) {
          if (!text.startsWith(prefix)) continue;
          text = text.slice(prefix.length).trimStart();
        }
        if (!text.trim()) {
          if (!extracted.image || prefix && !extracted.text) continue;
          text = DEFAULT_IMAGE_PROMPT;
        }
      }

      const dedupKey = `${chatId}\u0000${messageId}`;
      pruneDedup(currentTime);
      if (dedup.has(dedupKey)) continue;
      dedup.set(dedupKey, currentTime);
      if (!acceptRate(chatId, config.bot.rateLimitPerMinute, currentTime)) continue;
      logger?.debug?.({ event: 'message_accepted', messageId }, 'Message accepted');
      tasks.push(enqueue(chatId, () => process(sock, msg, chatId, text, extracted.image, config, isActive)));
    }
    await Promise.all(tasks);
  }

  function close() {
    closed = true;
    dedup.clear();
    rateWindows.clear();
  }

  return { handleUpsert, close };
}
