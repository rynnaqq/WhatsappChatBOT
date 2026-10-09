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

To use tags and replies instead of commands, set **Bot behavior → Reply trigger → Tags or replies only** and save. In a group, tag the linked WhatsApp account and include your question. In a group or private chat, reply to a message from that account with your next question. A plain `!Hello`, tags of other people, and replies to other people are ignored in this mode. Images sent in a reply to the bot can be handled without a caption when vision is enabled; a bare text tag with no question is ignored.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to reach it from your LAN. Use HTTPS when exposing the dashboard beyond your local machine.

## Hosting requirements

Run the bot and dashboard together as one continuously running Node.js process with persistent writable storage. Pterodactyl / Botkeep with a Node.js 24 image supports this deployment model; keep `.env` and the root `storage/` directory across restarts and redeployments.

The complete v1 application is not configured for Vercel. Vercel's Express detection expects a recognized entry file to import Express and expose its application; this project's entry point composes the bot and a web-server factory instead. Adding an Express entry point would also require adapting the runtime: Vercel runs Express as a Function, local storage is ephemeral, and function instances do not share this application's in-memory sessions or WhatsApp state. Vercel now supports WebSockets in public beta, but their connection lifetime is bounded by the function duration. A separate persistent bot backend would be required for a Vercel-hosted dashboard.

References: [Vercel Express deployment](https://vercel.com/docs/frameworks/backend/express), [Vercel WebSocket lifecycle](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), [Vercel local storage limitations](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).

## Pterodactyl / Botkeep deployment

Deploy the complete current `main` branch. An earlier commit omitted `src/storage/settingsRepo.js` and `src/storage/jsonStore.js` because the runtime storage ignore rule also matched source code. The corrected rule excludes only the root `/storage/` directory. Updating npm packages alone cannot restore these application files.

1. Stop the server in the panel, then update the checkout with `git pull --ff-only` or redeploy the latest repository files. Preserve your existing `.env` and root `storage/` data.
2. Run `npm ci --omit=dev`. Run `npm run setup` if `.env` has not been created; it preserves an existing file.
3. Set `HOST=0.0.0.0` and set `PORT` to the port allocated by the panel. Set these in `.env` or the process environment; non-empty exported values take precedence, while empty exported values fall back to `.env`. Keep valid `DASHBOARD_PASSWORD` and `SESSION_SECRET` values.
4. Set the startup command to `npm start`, then start the server and open the dashboard using the panel's allocated address and port.

The optional npm install-script notices shown for Baileys and protobufjs do not cause the missing local module error. If that error remains after updating, check that both files above exist under `/home/container/src/storage/`; the deployed checkout is still incomplete.

If startup reports `DASHBOARD_PASSWORD` or `SESSION_SECRET` configuration errors, the effective credentials are missing or too short:

- In the panel File Manager, place `.env` directly in `/home/container`, beside `package.json`. The filename must be `.env`; `.env.example` is a template.
- `npm run setup` generates private credentials when `.env` is absent. It preserves existing files, including templates with blank values. For an existing file, fill `DASHBOARD_PASSWORD` with 12–1,024 characters and `SESSION_SECRET` with a random value of at least 32 characters.
- Empty Startup variables fall back to values in the project-root `.env`. A non-empty Startup value still overrides the file, so replace a short `SESSION_SECRET` with the complete valid value from `.env`, or clear that Startup field to use the file. Required credentials are still validated before startup.
- Keep `HOST=0.0.0.0`, set `PORT` to the allocated port, and restart after changing startup configuration. Keep a previously used valid `SESSION_SECRET` stable so saved provider keys remain decryptable.

## Configuration

Configuration is loaded from the project-root `.env` at startup, regardless of the process working directory. Non-empty process environment values override the file. Bot and provider settings are edited in the dashboard and apply to the next request without restarting the server.

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

The default persona uses natural WhatsApp conversation, matches the user's language and tone, and keeps casual replies short without unsolicited coding-task summaries. Customize **System prompt / Persona** in the dashboard's bot settings; saved personas stay in place when you update the application.

**Private chats only takes precedence over group replies.** These restrictions apply to both reply triggers. In command-prefix mode, an empty prefix accepts every eligible inbound message. In tags-or-replies mode, the prefix is ignored and the incoming message must tag the linked account or quote a message authored by it in the same chat. Phone-number and WhatsApp LID addresses are supported. Unsupported media, status updates, broadcasts, self messages, historical batches, duplicates, and old messages are ignored.

## Providers

Presets are editable starting points. Select a model available to your account; enable vision only when the selected model supports it.

| Provider | Base URL | Example model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` |
| Ollama | `http://localhost:11434/v1` | `gpt-oss:20b` |
| 9Router | `http://127.0.0.1:20128/v1` | `oc/muse-spark-1.3-contributor-free` |

Ollama ignores the key, but its OpenAI client still needs a non-empty value: enter `ollama`. Pull your chosen model locally before testing. Model identifiers and provider capabilities can change; the dashboard's test uses your saved provider and makes one small request. The dashboard requires a replacement key when switching to a different provider origin to avoid unintentionally reusing a previous provider's credentials.

For 9Router, use a key generated in its dashboard and the full prefixed model ID. Replace the example Base URL with your router's reachable URL when it runs on another computer or server.

Test connection allows up to 1024 output tokens so models with minimum token budgets and reasoning overhead can complete the request. Failed tests show safe guidance and the provider's HTTP status for rejected requests, keys, model IDs, quota, and availability; network failures and timeouts have separate messages. Raw provider errors and keys remain private.

Primary references: [OpenRouter](https://openrouter.ai/openai/gpt-4o-mini/providers), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [Groq compatibility](https://console.groq.com/docs/openai), [Groq model changes](https://console.groq.com/docs/deprecations), [DeepSeek quick start](https://api-docs.deepseek.com/en/), [9Router integration](https://github.com/decolua/9router/blob/master/gitbook/content/en/integration/other-tools.md), [9Router OpenCode models](https://github.com/decolua/9router/blob/master/open-sse/providers/registry/opencode.js).

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
