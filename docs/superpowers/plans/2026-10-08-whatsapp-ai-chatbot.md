# WhatsApp AI Chatbot Implementation Plan

> **For agentic workers:** Use the orchestrate skill for bounded implementation tasks; the main agent owns integration and verification. Steps use checkbox syntax for tracking.

**Goal:** Implement the complete v1 application described by the supplied PRD.

**Architecture:** A single Node.js ES Modules process serves an Express dashboard, authenticated WebSocket status updates, and one Baileys session. Atomic JSON settings feed an OpenAI client and isolated per-chat queues; session credentials live separately on disk.

**Tech Stack:** Node.js 20+, Express, ws, Baileys, OpenAI SDK, qrcode, pino; native HTML/CSS/JavaScript dashboard.

**Spec:** [PRD-whatsapp-ai-chatbot.md](../../../PRD-whatsapp-ai-chatbot.md).

## Global Constraints

- One WhatsApp account; no database, broadcast messages, voice, video, documents, or v2 features.
- Default provider https://api.openai.com/v1; model gpt-4o-mini; temperature 0.7; 512 tokens; 60-second request timeout.
- Persona "You are a helpful assistant."; prefix !; six complete memory turns; group replies enabled; private-only disabled; typing enabled.
- Password at least 12 characters; session secret at least 32 characters; 12-hour HttpOnly SameSite=Strict cookies.
- 0700 storage directories and 0600 files where supported; API keys encrypted at rest and masked in responses; no message bodies in application logs.
- Native dashboard requires no build step; usable at 360px and with keyboard navigation.

## Review Focus

- Concurrent settings updates must preserve saved keys and leave valid JSON after reload.
- Expired or revoked cookies and cross-origin requests must not access APIs or WebSocket upgrades.
- Repeated restart/logout and stale socket events must never create duplicate live sockets.
- Wrapped/redelivered/old WhatsApp messages must respect filters, limits, and per-chat ordering.
- Provider errors and context overflow must not expose secrets or poison conversation memory.

## Decisions

- The user's instruction to execute the supplied PRD authorizes implementation; its defined design is the working specification.
- Images are retained as text placeholders in memory, as assumed in the PRD.
- Fatal remote logout clears unusable credentials and stops auto-reconnect; the operator starts fresh pairing. Explicit dashboard Log Out clears credentials and immediately creates a pairing socket. This resolves WA-05/DATA-04's conflicting deletion wording.
- API key encryption uses AES-256-GCM with a key derived from SESSION_SECRET. Changing that secret requires re-entering the provider key.
- Extra configurable v1 fields: 5 MB image ceiling, 120-second message age, read receipts off, 20 accepted messages per minute per chat. Safe limits bound queue, deduplication, and memory storage.
- Live provider and WhatsApp acceptance requires operator credentials and a QR scan; automated integration uses real local HTTP endpoints and controlled socket boundaries.
- The workspace has no Git repository. Files are implemented in place, without fabricated Git history or worktree operations.

### Task 1: Settings and AI foundations (ai_storage owner)

**Files:** src/storage/jsonStore.js, src/storage/settingsRepo.js, src/services/{memoryService,aiService,rateLimiter}.js; tests/{settings,memory,ai}.test.js.

**Interfaces:** SettingsRepo({storageDir,encryptionSecret,logger,maxTokensCeiling}) with init(), get(), getPublic(), save(payload), subscribe(fn). MemoryService with get(chatId,limit), append(chatId,user,assistant,limit), clear(chatId), trim(chatId,turnsToKeep). AIService({settingsRepo,memory,logger}) with reply({chatId,text,imageBuffer,mimeType}) and testConnection().

- [x] Write and run failing tests for persistence, validation, masking, encrypted reload, memory, vision, provider switching, retry, overflow, and safe errors.
- [x] Implement settings, memory, and provider service with explicit timeouts and bounded storage.
- [x] Run node --test tests/settings.test.js tests/memory.test.js tests/ai.test.js; expect zero failures.

### Task 2: WhatsApp lifecycle and message pipeline (bot owner)

**Files:** src/bot/{botState,socket,messageHandler,mediaService}.js; tests/{bot,filters}.test.js.

**Interfaces:** BotState extends EventEmitter, snapshot(), update(payload), setQR(dataUrl,expiresInMs); emits status and qr. WhatsAppBot({storageDir,state,settingsRepo,aiService,logger}) with start(), restart(mode), stop(). Message handler consumes repo and AI interfaces from Task 1.

- [x] Write and run failing tests for generation-safe socket restart, transient backoff, fatal logout, credential persistence, filters, ordering, deduplication, age, and bounded image download.
- [x] Implement one serialized lifecycle and one serialized queue per chat, with independent chats processed concurrently.
- [x] Run node --test tests/bot.test.js tests/filters.test.js; expect zero failures.

### Task 3: Secure web application and dashboard (main owner)

**Files:** src/config/env.js, src/web/{auth,server,realtime}.js, src/web/public/{index,login}.html, src/web/public/{app,login}.js, src/web/public/styles.css; tests/{web,env}.test.js.

**Interfaces:** loadEnv(process.env) => validated config. createWebServer({config,settingsRepo,state,bot,aiService,logger}) => {server,listen,close}. Auth middleware protects APIs and upgrades; WebSocket sends initial snapshot then status/QR events without polling.

- [x] Write failing integration tests for login/session, brute-force lockout, authorization, origin enforcement, settings validation/masking, restart mode, health, and WebSocket authentication/events.
- [x] Implement session revocation, safe cookie flags, rate-limited login, authenticated routes, heartbeat, and dashboard forms with inline field errors and confirmation dialogs.
- [x] Run node --test tests/web.test.js tests/env.test.js; expect zero failures.

### Task 4: Entry point, setup, documentation, and verification (main owner)

**Files:** src/index.js, scripts/{setup,check-syntax,check-dashboard}.js, README.md, docs/verification.md, package.json, .env.example, .gitignore.

- [x] Install pinned dependencies; compose services and graceful shutdown; add setup and syntax scripts.
- [x] Document startup, QR pairing, provider presets, limits, hosting, unofficial client risk, and dependency upgrade checks.
- [x] Run npm test and npm run check; expect zero failures.
- [x] Run browser verification against the integrated application at desktop and 360px, keyboard/dialog/login/settings/QR/WebSocket paths, and axe accessibility audit; record actual results.
- [x] Review all v1 acceptance criteria, record automated evidence and operator-only checks, and report exact remaining setup steps.
