import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';

const COOKIE_NAME = 'wabot_session';
const LOCK_MS = 15 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest();

export function createAuth({ password, secret, ttlMs = 12 * 60 * 60 * 1000, now = Date.now }) {
  const sessions = new Map();
  const attempts = new Map();
  const events = new EventEmitter();
  const signature = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  const prune = () => {
    const time = now();
    for (const [sid, session] of sessions) if (session.exp <= time) sessions.delete(sid);
    for (const [ip, entry] of attempts) if (entry.until <= time && entry.updated + LOCK_MS <= time) attempts.delete(ip);
  };
  function issue() {
    prune();
    if (sessions.size >= 1000) revoke(sessions.keys().next().value);
    const session = { sid: randomBytes(32).toString('base64url'), exp: now() + ttlMs };
    sessions.set(session.sid, session);
    const body = Buffer.from(JSON.stringify(session)).toString('base64url');
    return `${body}.${signature(body)}`;
  }
  function getSession(cookie = '') {
    if (typeof cookie !== 'string' || cookie.length > 8192) return null;
    const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (!token || token.length > 512) return null;
    const pieces = token.split('.');
    if (pieces.length !== 2) return null;
    const [body, supplied] = pieces;
    const expected = signature(body);
    if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(supplied)
      || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
    try {
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
      const current = sessions.get(decoded.sid);
      if (!current || current.exp !== decoded.exp || current.exp <= now()) {
        if (current?.exp <= now()) sessions.delete(decoded.sid);
        return null;
      }
      return { ...current };
    } catch { return null; }
  }
  function revoke(sid) {
    if (sessions.delete(sid)) events.emit('revoke', sid);
  }
  function setCookie(req, res, token, clear = false) {
    const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${clear ? 0 : Math.floor(ttlMs / 1000)}`];
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
  function login(req, res) {
    prune();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const previous = attempts.get(ip);
    const time = now();
    if (previous?.until > time) {
      res.setHeader('Retry-After', Math.ceil((previous.until - time) / 1000));
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    }
    const supplied = req.body?.password;
    if (typeof supplied !== 'string' || supplied.length > 1024 || !timingSafeEqual(hash(supplied), hash(password))) {
      if (attempts.size >= 10000 && !attempts.has(ip)) attempts.delete(attempts.keys().next().value);
      const count = (previous && previous.updated + LOCK_MS > time ? previous.count : 0) + 1;
      attempts.set(ip, { count, until: count >= 5 ? time + LOCK_MS : 0, updated: time });
      if (count >= 5) {
        res.setHeader('Retry-After', LOCK_MS / 1000);
        return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      }
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    attempts.delete(ip);
    setCookie(req, res, issue());
    return res.json({ ok: true });
  }
  function middleware(req, res, next) {
    const session = getSession(req.headers.cookie);
    if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.session = session;
    next();
  }
  function logout(req, res) {
    revoke(req.session.sid);
    setCookie(req, res, '', true);
    res.json({ ok: true });
  }
  return { issue, getSession, revoke, login, logout, middleware, events };
}

export function allowedOrigin(request, origin = request.headers.origin) {
  if (!origin || origin === 'null') return false;
  try {
    const url = new URL(origin);
    const secure = request.secure ?? Boolean(request.socket.encrypted);
    return url.origin === `${secure ? 'https' : 'http'}://${request.headers.host}` && !url.username && !url.password;
  } catch { return false; }
}
