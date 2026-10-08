import { WebSocketServer, WebSocket } from 'ws';
import { allowedOrigin } from './auth.js';

export function attachRealtime({ server, state, auth, trustProxy = false, logger }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  function send(socket, type, payload) {
    if (socket.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 1024 * 1024) return socket.terminate();
      socket.send(JSON.stringify({ type, payload }));
    }
  }
  const broadcastStatus = (value) => { for (const client of wss.clients) send(client, 'status', value); };
  const broadcastQR = (value) => { for (const client of wss.clients) send(client, 'qr', value); };
  state.on('status', broadcastStatus);
  state.on('qr', broadcastQR);
  const reject = (socket, code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
  const upgrade = (request, socket, head) => {
    if (request.url !== '/ws') return reject(socket, 404, 'Not Found');
    const session = auth.getSession(request.headers.cookie);
    if (!session) return reject(socket, 401, 'Unauthorized');
    // As with Express, TRUST_PROXY means one trusted HTTPS-terminating proxy.
    request.secure = Boolean(request.socket.encrypted) || (trustProxy && request.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https');
    if (!allowedOrigin(request)) return reject(socket, 403, 'Forbidden');
    wss.handleUpgrade(request, socket, head, (client) => {
      client.sessionId = session.sid;
      client.sessionCookie = request.headers.cookie;
      wss.emit('connection', client);
    });
  };
  server.on('upgrade', upgrade);
  wss.on('connection', (socket) => {
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => logger?.debug?.({ event: 'dashboard_socket_error' }, 'Dashboard connection closed.'));
    socket.on('message', (raw) => {
      try { if (JSON.parse(raw.toString()).type === 'ping') send(socket, 'pong', {}); } catch { socket.close(1008, 'Invalid message'); }
    });
    const snapshot = state.snapshot();
    send(socket, 'status', snapshot);
    if (snapshot.qr && new Date(snapshot.qrExpiresAt).getTime() > Date.now()) send(socket, 'qr', { dataUrl: snapshot.qr, expiresInMs: new Date(snapshot.qrExpiresAt).getTime() - Date.now() });
  });
  const revoke = (sid) => { for (const client of wss.clients) if (client.sessionId === sid) client.close(1008, 'Session ended'); };
  auth.events.on('revoke', revoke);
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!auth.getSession(client.sessionCookie)) { client.close(1008, 'Session expired'); continue; }
      if (!client.alive) { client.terminate(); continue; }
      client.alive = false;
      client.ping();
    }
  }, 30000);
  heartbeat.unref();
  return {
    wss,
    async close() {
      clearInterval(heartbeat);
      state.off('status', broadcastStatus);
      state.off('qr', broadcastQR);
      auth.events.off('revoke', revoke);
      server.off('upgrade', upgrade);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
