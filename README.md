# Relay · WhatsApp AI Chatbot

A self-hosted WhatsApp assistant with a live web dashboard. Link one WhatsApp account, configure an OpenAI-compatible provider, and reply to inbound text and image messages.

## Quick start

Use Node.js 24 LTS for deployment. Node.js 20 compatibility is also checked; the application uses ES Modules.

```sh
npm install
npm run setup
npm start
```

Open **http://localhost:3000**. The setup command creates a private `.env` file with a random `DASHBOARD_PASSWORD` and `SESSION_SECRET`; read the password from that file to sign in. Running setup again keeps existing credentials.

1. In **AI provider**, enter the provider URL, key, and model. Save changes and use **Test connection**.
2. In WhatsApp on your phone, open **Linked devices → Link a device**, then scan the dashboard QR code.
3. From a different WhatsApp account, send `!Hello`. With the default prefix, messages without `!` are ignored.
4. For images, use a vision-capable model and send an image with a caption such as `!Describe this image`. To handle images without captions, leave the command prefix empty.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to reach it from your LAN. Use HTTPS when exposing the dashboard beyond your local machine.

## Configuration

Configuration is loaded from `.env` at startup. Bot and provider settings are edited in the dashboard and apply to the next request without restarting the server.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Required | 12–1,024 characters. The server rejects missing or weak values. |
| `SESSION_SECRET` | Required | At least 32 characters; signs sessions and derives the API-key encryption key. |
| `PORT` | `3000` | HTTP and WebSocket port. |
| `HOST` | `127.0.0.1` | Listen address. |
| `STORAGE_DIR` | `./storage` | WhatsApp credentials and settings; relative to the working directory. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |
| `TRUST_PROXY` | `false` | Use `true` behind **one trusted reverse proxy** that sanitizes forwarded headers. |
| `SESSION_TTL_HOURS` | `12` | Dashboard-session lifetime, from 1 to 168 hours. |
| `MAX_TOKENS_CEILING` | `32768` | Server-side upper limit for the dashboard's token setting; at least 512. |

Default behavior: `!` prefix, six complete conversation turns, group replies enabled, private-only disabled, typing enabled, read receipts off. Advanced settings default to a 60-second AI request budget, 5 MB images, a 120-second freshness window, and 20 accepted messages per minute per chat.

**Private chats only takes precedence over group replies.** An empty prefix accepts every eligible inbound message. Unsupported media, status updates, broadcasts, self messages, historical batches, duplicates, and old messages are ignored.

## Providers

Presets are editable starting points. Select a model available to your account; enable vision only when the selected model supports it.

| Provider | Base URL | Example model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` |
| Ollama | `http://localhost:11434/v1` | `gpt-oss:20b` |

Ollama ignores the key, but its OpenAI client still needs a non-empty value: enter `ollama`. Pull your chosen model locally before testing. Model identifiers and provider capabilities can change; the dashboard's test uses your saved provider and makes one small request. The dashboard requires a replacement key when switching to a different provider origin to avoid unintentionally reusing a previous provider's credentials.

Primary references: [OpenRouter](https://openrouter.ai/openai/gpt-4o-mini/providers), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [Groq compatibility](https://console.groq.com/docs/openai), [Groq model changes](https://console.groq.com/docs/deprecations), [DeepSeek quick start](https://api-docs.deepseek.com/en/).

## Sessions, storage, and privacy

- **Restart session** reconnects using the current account's saved credentials.
- **Log out of WhatsApp** removes credentials and immediately starts fresh QR pairing. A remote WhatsApp logout invalidates credentials, stops automatic reconnect, and waits for an operator to restart pairing.
- **Sign out** ends only the dashboard session. It leaves the WhatsApp connection running.
- Transient disconnects reconnect with exponential backoff, capped at 60 seconds. Processing and deduplication remain scoped to the bot instance across same-account reconnects.
- `storage/settings.json` is written atomically through a serialized queue. The provider key is encrypted with AES-256-GCM; API responses expose only a fixed mask. Invalid settings are backed up before defaults are used. Runtime files, `.env`, logs, and test screenshots are Git-ignored.
- WhatsApp authentication lives in `storage/auth_info`. Back up this directory and `.env` privately. Directory/file permissions are restricted on platforms supporting POSIX modes; use equivalent private ACLs on Windows.
- Conversation memory stays in RAM and holds only text. Image history stores `[image sent]` plus its caption. Memory clears on process restart or account logout; abandoned old-account work cannot restore it.
- Application logs contain events and message IDs, with no message bodies or provider credentials. Baileys' internal logger is silent. Incoming content and current conversation history are sent to the configured AI provider.
- Image downloads accept only HTTPS media hosts under `whatsapp.net`, including redirects and reupload results. Downloads are bounded by byte count and deadline; their private network dispatcher is destroyed when finished or timed out.

Keep `SESSION_SECRET` stable across reboots. Changing it invalidates sessions and prevents decryption of a previously saved API key; the old encrypted file is backed up and the provider key must be entered again.

Baileys is an unofficial WhatsApp client. WhatsApp may restrict automated accounts. Use a dedicated number and keep the bot limited to replies to inbound messages; this app provides no broadcast or marketing route. See the [Baileys project](https://github.com/WhiskeySockets/Baileys).

## HTTP and real-time API

All `/api/*` endpoints except the password login require a valid signed session cookie. Mutations accept JSON; browser origins are checked. Sessions use `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS. Five failed logins from one IP lock login for 15 minutes. Logging out revokes the cookie and its live WebSocket immediately.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Public process health. |
| POST | `/api/auth/login` | `{ "password": "..." }`, sets the session cookie. |
| POST | `/api/auth/logout` | End the dashboard session. |
| GET | `/api/status` | WhatsApp state and current pairing code, when present. |
| GET | `/api/settings` | Current settings with the key masked. |
| POST | `/api/settings` | Validate and atomically save the full settings object. |
| POST | `/api/bot/restart` | `{ "mode": "restart" }` or `{ "mode": "logout" }`; returns `202`. |
| POST | `/api/ai/test` | Test the saved provider without adding conversation memory. |

Settings validation returns `400` with a flat `fields` map. Sending `"********"` for an unchanged saved key preserves it. Schema additions to the PRD: `ai.maxImageMB`, `bot.maxMessageAgeSeconds`, `bot.markRead`, and `bot.rateLimitPerMinute`.

Connect to authenticated **`/ws`** with a same-origin `Origin` header. Events are `{ "type": "status" | "qr", "payload": {...} }`. New clients receive the current snapshot and QR; subsequent changes are pushed without polling. WebSocket ping/pong runs every 30 seconds.

## Development and verification

```sh
npm run dev
npm test
npm run check
npx playwright install chromium
npm run test:ui
```

Unit/integration tests use temporary private storage, real local HTTP provider endpoints, and controlled WhatsApp socket boundaries. Browser checks exercise the integrated authenticated server at 1440px and 360px with axe WCAG AA audits. Screenshots and results go to `test-results/`. Live WhatsApp pairing and real provider calls require the operator's account and provider credentials. The verification report records those boundaries separately.

## Dependency upgrades

Baileys is pinned to `7.0.0-rc14`, the supported 7.x security line; a stable 7.0 release was not available at implementation time. OpenAI SDK `6.49.0` preserves the PRD's Node 20 compatibility; deploy on a supported Node LTS release. References: [Baileys security policy](https://github.com/WhiskeySockets/Baileys/blob/master/SECURITY.md), [Baileys releases](https://github.com/WhiskeySockets/Baileys/releases), [OpenAI SDK v6.49.0](https://github.com/openai/openai-node/blob/v6.49.0/README.md).

Before upgrading: run the suite and browser checks, inspect dependency advisories, verify media download and Baileys exports, then test QR pairing, credential reload, transient reconnect, restart, logout, text, and vision on a dedicated account. The v2 roadmap in the PRD remains outside this release.
