# PRD: WhatsApp AI Chatbot with OpenAI-Compatible Backend and Web Admin Dashboard

| Field | Value |
|---|---|
| Version | 1.0 (Draft) |
| Date | 2026-10-08 |
| Owner | Senior Full-Stack Engineering |
| Status | Draft for review |

---

## 1. Overview

### 1.1 Problem Statement
Teams and individuals want an AI assistant reachable through WhatsApp, the messaging app they already use, without paying for a hosted chatbot platform. They also want the freedom to choose any model provider that speaks the OpenAI API format (OpenAI, OpenRouter, Ollama, Groq, DeepSeek, and others), and they need to change settings without editing code or restarting the server.

### 1.2 Product Summary
A self-hosted Node.js (ES Modules) application that links a WhatsApp account through the Baileys WebSocket library, forwards incoming text and images to any OpenAI-compatible endpoint, and replies in WhatsApp. An embedded web dashboard shows live connection status and a QR code, and lets the operator configure the AI provider and bot behavior. Settings are saved to disk and applied in memory without a process restart.

### 1.3 Goals
1. Connect a WhatsApp account by QR code and keep the connection alive automatically.
2. Answer text and image messages using any OpenAI-compatible model, including vision models.
3. Let the operator control the bot's behavior (persona, prefix, memory, chat scope) from a browser.
4. Persist WhatsApp session and settings across reboots.
5. Show connection state changes in real time.

### 1.4 Non-Goals (v1)
- Multi-tenant SaaS hosting, or multiple WhatsApp accounts in one instance.
- Sending broadcast or marketing messages.
- Voice notes, video, documents, or stickers (transcription and OCR are roadmap items).
- Official WhatsApp Business API integration (the bot uses the unofficial Baileys client; see Risks).
- A relational database. v1 uses JSON file storage.

---

## 2. Users and Personas

| Persona | Description | Key Needs |
|---|---|---|
| **Operator (Admin)** | Technical person who deploys and runs the bot | Easy setup, provider switching, visibility into connection health |
| **End User (WhatsApp contact)** | Person messaging the bot's number | Fast, relevant replies; understands when the bot is or isn't responding |

---

## 3. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20+ LTS, ES Modules | `"type": "module"` in `package.json` |
| WhatsApp engine | `@whiskeysockets/baileys` | WebSocket-based; no headless browser |
| AI client | `openai` (official npm package) | Configurable `baseURL` and `apiKey` |
| Web server | `express` | Static assets and REST API |
| Real-time | `ws` | Pushes QR codes and status to the dashboard |
| QR rendering | `qrcode` | Converts the QR string to a data URL |
| Auth storage | `useMultiFileAuthState` | Stored in `./storage/auth_info` |
| Settings storage | JSON file | `./storage/settings.json`, with atomic, serialized writes |
| Dashboard UI | Vanilla HTML/CSS/JS (Tailwind via CDN optional) | No build step required |

---

## 4. Architecture and Project Structure (Proposed)

The source prompt ends before its architecture section, so the layout below is a proposal. It can be changed later.

```
whatsapp-ai-bot/
├── package.json                 # "type": "module"; scripts: start, dev
├── .env.example                 # PORT, DASHBOARD_PASSWORD, SESSION_SECRET, LOG_LEVEL
├── src/
│   ├── index.js                 # Entry point: starts web server and bot
│   ├── config/
│   │   └── env.js               # Loads and validates environment variables
│   ├── storage/
│   │   ├── jsonStore.js         # Thread-safe (serialized) JSON read/write, atomic rename
│   │   └── settingsRepo.js      # Settings schema, defaults, validation, masking
│   ├── services/
│   │   ├── aiService.js         # OpenAI client factory, text and vision completions
│   │   ├── memoryService.js     # Per-chat sliding-window conversation memory
│   │   └── rateLimiter.js       # Retry/backoff for 429 and 5xx responses
│   ├── bot/
│   │   ├── socket.js            # Baileys lifecycle, QR, reconnect with backoff
│   │   ├── messageHandler.js    # Parse, filter, apply rules, call AI, reply
│   │   ├── mediaService.js      # downloadMediaMessage, image to base64 data URL
│   │   └── botState.js          # Connection state machine and event emitter
│   └── web/
│       ├── server.js            # Express app, auth middleware, routes
│       ├── routes/
│       │   ├── status.js        # GET /api/status
│       │   ├── settings.js      # GET/POST /api/settings
│       │   └── bot.js           # POST /api/bot/restart
│       ├── realtime.js          # ws server; broadcasts status and QR
│       └── public/              # index.html, app.js, styles.css
├── storage/                     # Runtime data (git-ignored)
│   ├── auth_info/
│   └── settings.json
└── tests/                       # Unit tests for settings, memory, filters, AI service
```

### 4.1 Component Responsibilities
- **socket.js** owns the Baileys socket. It listens to `connection.update` and `creds.update`, emits QR and status changes through `botState`, and reconnects with exponential backoff.
- **messageHandler.js** receives `messages.upsert` events and runs the pipeline in Section 5.3.
- **aiService.js** reads the current settings on each request (or when a settings change is signaled), so a new provider takes effect without a restart.
- **settingsRepo.js** is the only module that reads or writes `settings.json`. All other modules use it.
- **realtime.js** pushes events to browser clients over WebSocket. Clients never poll for status.

---

## 5. Functional Requirements

### 5.1 AI Service (`aiService.js`, `memoryService.js`)

| ID | Requirement | Priority |
|---|---|---|
| AI-01 | Create the OpenAI client from current settings (`baseURL`, `apiKey`, `model`). Rebuild it when those settings change. | P0 |
| AI-02 | Text completion with the system prompt, sliding-window memory, `temperature`, and `max_tokens` from settings. | P0 |
| AI-03 | Per-chat memory keeps the last N user/assistant turns, where N = `memoryLimit`. Memory is keyed by chat JID. | P0 |
| AI-04 | Vision completion: convert image buffers to `data:image/jpeg;base64,...` and send them in the OpenAI content-array format (`text` + `image_url`). | P0 |
| AI-05 | Handle timeouts (configurable, default 60 s), HTTP 429 with exponential backoff and jitter (max 3 retries), and 5xx errors. | P0 |
| AI-06 | Handle context window overflow by trimming the oldest turns and retrying once. If it still fails, reply with a short user-facing error and log it. | P0 |
| AI-07 | Never send the API key, raw provider errors, or stack traces to WhatsApp users. | P0 |
| AI-08 | Reject images above a configurable size (default 5 MB) before encoding. Optionally downscale. | P1 |
| AI-09 | Optional test-connection action that sends a minimal prompt to validate the provider settings. | P2 |

### 5.2 WhatsApp Lifecycle (`socket.js`)

| ID | Requirement | Priority |
|---|---|---|
| WA-01 | Start Baileys with `useMultiFileAuthState('./storage/auth_info')` and save credentials on `creds.update`. | P0 |
| WA-02 | On QR generation, convert the QR string to a data URL with `qrcode` and push it to dashboard clients. | P0 |
| WA-03 | Track state as `connecting`, `qr_required`, `connected`, or `disconnected`, and push every change to the dashboard. | P0 |
| WA-04 | Reconnect automatically on non-fatal disconnects with exponential backoff (1 s base, 60 s cap, jitter). | P0 |
| WA-05 | Treat "logged out" (401/`loggedOut`) as fatal for auto-reconnect. Clear `auth_info` and wait for a new QR scan. | P0 |
| WA-06 | "Restart Session" closes the socket and reconnects with existing credentials. "Log Out" deletes `auth_info` and starts a fresh pairing. | P0 |
| WA-07 | Avoid duplicate sockets. Only one socket may exist at a time, even when restart is clicked repeatedly. | P0 |

### 5.3 Message Processing (`messageHandler.js`)

Processing pipeline for each `messages.upsert` event:

1. Skip if `type` is not `notify`.
2. Skip if `key.fromMe` is true.
3. Skip if `remoteJid` is `status@broadcast`.
4. Extract text from `conversation`, `extendedTextMessage.text`, or `imageMessage.caption`.
5. Apply rules from settings:
   - **Private Chats Only**: skip JIDs ending in `@g.us` when enabled.
   - **Group replies**: when group replies are enabled, group messages are eligible; otherwise they are skipped.
   - **Command prefix**: if set, only messages starting with the prefix are answered, and the prefix is stripped before sending to the AI. If empty, all eligible messages are answered.
6. If the message is an image, download it with `downloadMediaMessage` and pass the buffer to the vision path.
7. Send a typing indicator (`sock.sendPresenceUpdate('composing', remoteJid)`) during inference, only if **Typing Indicator** is enabled. Send `paused` afterward.
8. Call the AI service, store the turn in memory, and send the reply with `sock.sendMessage(remoteJid, { text }, { quoted: msg })`.
9. Log each step with the message ID (never log message bodies or keys at info level).

| ID | Requirement | Priority |
|---|---|---|
| MSG-01 | Implement the filtering and extraction pipeline above. | P0 |
| MSG-02 | Support text and image-with-caption messages. Image-only messages with no caption use a default prompt such as "Describe this image." | P0 |
| MSG-03 | Use one serialized queue per chat so replies stay in order when messages arrive quickly. | P0 |
| MSG-04 | Deduplicate messages by `key.id` to handle redelivery after reconnects. | P0 |
| MSG-05 | Ignore messages older than a set window (default 2 minutes) to avoid replying to backlog after a reconnect. | P1 |
| MSG-06 | Mark messages as read only when configured (default: off). | P2 |

### 5.4 Web Dashboard (`src/web/`)

#### 5.4.1 Authentication

| ID | Requirement | Priority |
|---|---|---|
| AUTH-01 | Single password gate. A login page accepts `DASHBOARD_PASSWORD` from the environment. | P0 |
| AUTH-02 | Successful login sets an `HttpOnly`, `SameSite=Strict` session cookie signed with `SESSION_SECRET`. Expiry is 12 hours by default. | P0 |
| AUTH-03 | All `/api/*` routes and the WebSocket upgrade require a valid session. | P0 |
| AUTH-04 | Brute-force protection: lock login for 15 minutes after 5 failed attempts from the same IP. | P1 |
| AUTH-05 | The server refuses to start if `DASHBOARD_PASSWORD` is unset or shorter than 12 characters. | P0 |

#### 5.4.2 Live WhatsApp Status Card

| ID | Requirement | Priority |
|---|---|---|
| UI-01 | Show a status badge: Connected (green), Connecting (amber), Disconnected (red), or QR Required (blue). | P0 |
| UI-02 | When pairing is required, display the QR code image and update it when WhatsApp issues a new one. | P0 |
| UI-03 | Show the linked phone number and the last connected timestamp when connected. | P1 |
| UI-04 | "Restart Session" and "Log Out" buttons, each with a confirmation dialog. | P0 |
| UI-05 | Status updates arrive over WebSocket without a page refresh. | P0 |

#### 5.4.3 AI Provider Settings Form

| Field | Type | Default | Validation | Priority |
|---|---|---|---|---|
| Base URL | URL | `https://api.openai.com/v1` | Valid http(s) URL | P0 |
| API Key | Masked password input | empty | Non-empty; stored encrypted at rest or masked in responses | P0 |
| Model Name | String | `gpt-4o-mini` | Required; examples: `gpt-4o`, `deepseek-chat`, `qwen/qwen-2.5-vl-72b-instruct` | P0 |
| Temperature | Number | 0.7 | 0 to 2 | P0 |
| Max Tokens | Integer | 512 | 1 to a configurable ceiling | P0 |
| Vision Enabled | Boolean | true | Turns image handling on or off | P1 |

#### 5.4.4 Bot Behavior Settings

| Field | Type | Default | Validation | Priority |
|---|---|---|---|---|
| System Prompt / Persona | Textarea | "You are a helpful assistant." | Max 4,000 characters | P0 |
| Command Prefix | String | `!` | Max 5 characters; empty allowed (respond to all) | P0 |
| Memory Limit | Integer | 6 | 0 to 50 turns; 0 disables memory | P0 |
| Private Chats Only | Boolean | false | — | P0 |
| Group Chat Replies | Boolean | true | Per the group decision in Section 9 | P0 |
| Typing Indicator | Boolean | true | — | P0 |
| Request Timeout (s) | Integer | 60 | 5 to 300 | P1 |

### 5.5 REST API

| Method | Path | Purpose | Auth | Response Notes |
|---|---|---|---|---|
| GET | `/api/status` | Current WhatsApp connection state | Session | `{ state, phone?, connectedAt?, qr? }` |
| GET | `/api/settings` | Current configuration | Session | API key masked (e.g., `sk-••••abcd`) |
| POST | `/api/settings` | Save settings and refresh the in-memory AI client without restart | Session | Validates the full payload; returns 400 with field errors on failure; keeps the old API key if the masked value is sent back unchanged |
| POST | `/api/bot/restart` | Restart the Baileys socket; accepts `{ mode: "restart" \| "logout" }` | Session | `202 Accepted`; progress comes over WebSocket |
| POST | `/api/auth/login` | Password login | Public (rate-limited) | Sets session cookie |
| POST | `/api/auth/logout` | End dashboard session | Session | Clears cookie |

### 5.6 Real-Time Channel

| Event | Direction | Payload |
|---|---|---|
| `status` | Server → Client | `{ state, phone?, connectedAt?, lastError? }` |
| `qr` | Server → Client | `{ dataUrl, expiresInMs }` |
| `log` | Server → Client | Last 100 info-level log lines on connect (optional, P2) |
| `ping` / `pong` | Both | Keepalive every 30 s |

---

## 6. Persistence Requirements

| ID | Requirement |
|---|---|
| DATA-01 | `settings.json` is written atomically (write to a temp file, then rename). |
| DATA-02 | All reads and writes go through one async queue, so concurrent requests cannot corrupt the file. |
| DATA-03 | If `settings.json` is missing or invalid, the app starts with defaults and logs a warning. The invalid file is backed up first. |
| DATA-04 | `auth_info` survives restarts. The app never deletes it except on explicit Log Out. |
| DATA-05 | Conversation memory is kept in process memory only in v1 and is lost on restart. Persistence is a roadmap item. |
| DATA-06 | Storage directories are created on startup with restrictive permissions (`0700` for `storage/`). |

### 6.1 Settings Schema (JSON)

```json
{
  "ai": {
    "baseURL": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "maxTokens": 512,
    "visionEnabled": true,
    "timeoutSeconds": 60
  },
  "bot": {
    "systemPrompt": "You are a helpful assistant.",
    "commandPrefix": "!",
    "memoryLimit": 6,
    "privateChatsOnly": false,
    "groupRepliesEnabled": true,
    "typingIndicator": true
  },
  "version": 1
}
```

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Reliability** | Auto-reconnect after transient failures. The bot keeps running if one AI request fails. |
| **Performance** | Dashboard status updates appear within 1 s of a state change. Text replies: target under 5 s excluding model latency. Image replies: target under 10 s. |
| **Concurrency** | Handle at least 20 active chats without blocking. Per-chat queues prevent cross-chat interference. |
| **Security** | Dashboard requires login. API keys are masked in responses and logs. Cookies are `HttpOnly` and `SameSite=Strict`. Secrets come from environment variables or are masked in `settings.json`. Input is validated on all endpoints. |
| **Privacy** | Message content is not logged at info level. Memory is in-process only (v1). The operator is responsible for compliance with local data laws. |
| **Observability** | Structured JSON logs (pino or equivalent). Log levels set via `LOG_LEVEL`. Health endpoint `GET /healthz` for process checks. |
| **Compatibility** | Works with any provider implementing `/v1/chat/completions` with vision content arrays. Tested against OpenAI, OpenRouter, Ollama, and Groq. |
| **Accessibility** | Dashboard meets WCAG 2.1 AA for contrast and keyboard navigation. |
| **Responsiveness** | Dashboard usable on mobile (≥360 px wide) and desktop. |
| **Maintainability** | ES Modules throughout. Modules have a single responsibility. Unit tests for settings, memory, filters, and the AI service. |

---

## 8. Configuration (Environment Variables)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3000` | Dashboard and API port |
| `DASHBOARD_PASSWORD` | Yes | — | Dashboard login password (min 12 chars) |
| `SESSION_SECRET` | Yes | — | Signs session cookies (min 32 chars) |
| `STORAGE_DIR` | No | `./storage` | Location of `auth_info` and `settings.json` |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `TRUST_PROXY` | No | `false` | Set `true` behind a reverse proxy (HTTPS termination) |

---

## 9. Assumptions and Decisions

| # | Topic | Decision | Source |
|---|---|---|---|
| 1 | Architecture section | Layout in Section 4 is proposed because the source prompt is truncated. | Operator decision: infer |
| 2 | Dashboard auth | Single password gate with session cookie. | Operator decision |
| 3 | Scope | Full scope with a v2 roadmap (Section 11). | Operator decision |
| 4 | Group chats | Group replies are **on by default**. The operator can disable them in settings. | Operator decision |
| 5 | Image memory | **Not confirmed.** This PRD assumes images are used for the current reply only. Memory keeps a text placeholder (e.g., `[image sent]` plus its caption), not the image data. This avoids large token costs. | Assumed; see Open Questions |
| 6 | Model default | `gpt-4o-mini` is the default model name. | Assumed |
| 7 | Multi-session | Single WhatsApp account per instance. | Assumed |

---

## 10. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **WhatsApp ToS**: Baileys is an unofficial client. WhatsApp may restrict or ban accounts, especially for automated or bulk messaging. | High | Medium | Use a dedicated number. Reply only to inbound messages, and never send unsolicited messages. Add rate limits per chat. Document the risk for the operator. |
| Baileys API changes or breaking updates | Medium | Medium | Pin the version in `package.json`. Add an upgrade test checklist. |
| Group spam: the bot replies to many group messages and gets the number flagged | High | Medium | Group replies on by default is a risk. Consider a per-group rate limit or an allowlist (see Open Questions). |
| Large image costs and slow responses | Medium | High | Size limit (AI-08), downscaling, and the vision toggle. |
| Provider rate limits or outages | Medium | High | Backoff (AI-05), clear user error messages, and fallback to a second provider (roadmap). |
| Leaked API key or dashboard password | High | Low | Masking, env-based secrets, login rate limiting, HTTPS via reverse proxy. |
| Session data corruption on a crash mid-write | Medium | Low | Atomic writes (DATA-01). Keep a backup of `auth_info` (roadmap). |
| Prompt injection from WhatsApp users | Medium | High | Keep the system prompt separate from user content. Set a clear persona and output length limits. Do not expose tools or secrets to the model in v1. |

---

## 11. Roadmap (v2 and Beyond)

| Area | Feature |
|---|---|
| Channels | Voice note transcription (Whisper-compatible endpoint), document and PDF handling, OCR |
| Memory | Persistent conversation memory (SQLite), per-chat summaries, `/reset` command |
| Reliability | Multi-provider fallback, circuit breaker, scheduled `auth_info` backups |
| Admin | Message logs viewer, usage and token dashboard, per-chat allowlist and blocklist |
| Behavior | Per-chat personas, tool or function calling, knowledge base (RAG) |
| Deployment | Docker image, Docker Compose, Helm chart, reverse-proxy examples (Caddy, Nginx) |
| Security | Multi-user accounts with roles, 2FA for dashboard login |

---

## 12. Acceptance Criteria (v1 Release)

- [ ] `npm install && npm start` runs on Node.js 20+ with no errors, given valid `.env` values.
- [ ] Scanning the QR code in the dashboard connects the account, and the status card shows Connected within 5 s.
- [ ] Sending a text message to the bot receives an AI reply using the configured model.
- [ ] Sending an image with a caption receives a vision-based reply.
- [ ] Changing the Base URL, API key, or model in the dashboard takes effect on the next message, with no restart.
- [ ] With the prefix set to `!`, messages without the prefix get no reply; with the prefix, the prefix is stripped before the AI call.
- [ ] Private Chats Only ignores group messages when enabled.
- [ ] Killing the network connection triggers reconnect with backoff, and the session resumes without a new QR scan.
- [ ] Restarting the server keeps the session and settings.
- [ ] Logging out deletes `auth_info` and shows a new QR code.
- [ ] Dashboard APIs return 401 without a valid session.
- [ ] API keys never appear in logs, responses, or the browser after saving.
- [ ] Unit tests for settings, memory, filters, and AI service pass.

---

## 13. Open Questions

1. **Image memory:** Should images stay in the conversation window (more context, higher cost), or should only a text placeholder be kept? The current assumption is placeholder only.
2. **Group spam control:** Should group replies also require a prefix or a per-group allowlist, given the ban risk?
3. **Dashboard hosting:** Will the dashboard be reached over the public internet (needs HTTPS and reverse proxy) or only on a LAN or VPN?
4. **Language:** Should bot replies and the dashboard UI be English only, or multilingual? The operator is in Indonesia (East Java), so Bahasa Indonesia support may matter.
5. **Missing architecture section:** If the rest of the original prompt exists, please share it so Section 4 can be aligned with it.
