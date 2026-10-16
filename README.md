# Relay · WhatsApp AI Chatbot

A self-hosted WhatsApp assistant with a live web dashboard. Link one WhatsApp account, configure an OpenAI-compatible provider, and reply to text, images, voice notes, audio, videos, stickers, and documents.

## Quick start

Use Node.js 24 LTS for deployment. Document extraction requires Node.js 22.13 or newer; Node.js 20 is no longer supported. The application uses ES Modules.

```sh
npm install
npm run setup
npm start
```

Open **http://localhost:3000**. The setup command creates a private `secrets.env` file with a random `DASHBOARD_PASSWORD` and `SESSION_SECRET`; read the password from that file to sign in. Running setup again keeps existing credentials. If only a legacy `.env` exists, setup copies it to `secrets.env` without changing its contents.

1. In **AI provider**, enter the provider URL, key, and model. Save changes and use **Test connection**.
2. In WhatsApp on your phone, open **Linked devices → Link a device**, then scan the dashboard QR code.
3. From a different WhatsApp account, send `!Hello`. With the default prefix, messages without `!` are ignored.
4. For images, stickers, and visual PDF reading, enable **Vision enabled** and use a vision-capable model. For documents, voice notes, audio, and videos, enable **Files, audio and video**. PDF tables and scans need both controls for local page rendering. In prefix mode, include the prefix in the caption; use the private-chat trigger below to send attachments directly without captions.

To answer ordinary private messages without commands while keeping groups addressed to the bot, set **Bot behavior → Reply trigger → Private chats + group tags/replies** and save. Eligible private messages from permitted users are accepted, including enabled attachments with or without captions. In a group, tag the linked WhatsApp account in the caption or send the attachment as a reply to a message from that account in the same chat. Group tags of other people and replies to other people are ignored; a bare group tag with no question or attachment is ignored. Existing settings saved as the former **Tags or replies only** mode automatically use this updated behavior.

The server binds to `127.0.0.1` by default. Set `HOST=0.0.0.0` to reach it from your LAN. Use HTTPS when exposing the dashboard beyond your local machine.

## Owner and allowed users

Open **Access → Who can use the bot** in the dashboard:

| Bot access | Who may send requests |
| --- | --- |
| Everyone | All users who meet your existing chat and trigger rules. This is the compatible default for new and older valid settings. |
| Owner only | Only the configured owner's WhatsApp number. |
| Owner + allowed numbers | The owner and numbers in the saved allowlist. An empty list permits only the owner. |

For restricted access, enter your **Owner WhatsApp number**, add the additional numbers you want to permit, choose the mode, and **Save changes**. Use a separate account from the paired bot: messages sent by the bot's own account remain ignored. International numbers need their country code, such as `+6281234567890`, not `081234567890`. Spaces, parentheses, and hyphens are accepted and removed when saved. The list accepts one number per line or comma/semicolon separators, with at most 100 numbers; duplicates are removed. Switching modes retains the owner and list for later use. The overview shows the saved access mode.

Permissions apply to the incoming user in both private chats and groups. Adding a group or quoting/tagging an owner cannot grant access. The owner still follows the saved reply trigger, private/group settings, freshness, and rate limits. Unauthorized messages are ignored before read receipts, typing, file downloads, and AI requests. Pending work is checked again after asynchronous steps and before delivery when a number is removed. An already dispatched provider request is not retroactively cancelled.

WhatsApp phone-number aliases and known LID mappings are supported. Numeric LIDs are never treated as phone numbers; a LID-only sender without a known phone mapping is ignored until an identity can be established. Access settings control WhatsApp use and do not grant dashboard sign-in. Existing saved instructions, keys, pairing, and triggers stay intact. Saves from older clients cannot silently clear an existing access policy. Invalid stored settings are backed up and recover with access closed until you reconfigure the owner/provider in the dashboard.

## Voice and outgoing stickers

**Bot behavior → Reply style → Feminine & warm** adds a warm, natural feminine voice to your saved instructions. Its mood guide offers **60 emoji and 40 compact kaomoji**, grouped into greetings, playful joy, bashful appreciation, comfort, reactions, and cozy everyday chat. Both built-in styles now favor plain text, with at most one optional kaomoji in an ordinary casual reply. Choices follow the actual mood: `(≧▽≦)` for joy, `(〃▽〃)` or `>.<` for shyness, and `(・・?)` for light confusion. After a reply with a face, the guide prefers plain text next; it avoids face chains, decorative lines, and emoji piled onto a face. Without a kaomoji, zero to two suitable emoji are enough. Explicit requests for lists or literal examples still take priority. The assistant follows the user's language and keeps document, technical, and serious answers focused. Choose **Custom prompt only** to use your saved voice without this extra style. Updating an older installation enables the feminine style without replacing its saved system prompt or provider credentials.

**Bot behavior → Reply style → Renako Amaori — WATANARE** adds a fictional character portrayal with practiced cheerfulness, flustered self-corrections, comic overthinking, and sincere friendship, drawing on the [official character profile](https://www.watanare-anime.com/#character) and [publisher's introduction](https://sevenseasentertainment.com/series/theres-no-freaking-way-ill-be-your-lover-unless-light-novel/). The requested casual style is especially cute and funny with occasional, gentle tsundere banter. It adapts naturally to aku/kamu Indonesian, uses varied expressions when suitable, and keeps task answers focused. Select it and **Save changes**; your existing prompt, keys, access policy, and sticker controls stay saved. Older installations retain their existing style. See [the persona notes](docs/personas/renako.md) for scope and original dialogue examples.

For schoolwork and multiple-choice questions, both built-in styles ask for direct answers with WhatsApp-native labels, separate explanations, and a blank line between blocks:

```text
1.
*Jawaban: B. Fotosintesis*

*Penjelasan:* Tumbuhan menggunakan energi cahaya untuk membentuk glukosa.

2.
*Jawaban: C. ...*

*Penjelasan:* Alasan pilihan C benar.
```

Original numbering and order are preserved; long sets may start with a compact answer key. Explicit requests such as “huruf jawabannya saja” or a custom format take precedence. The guide avoids greetings, decorative headings, tables, emoji, and kaomoji around academic answers, and asks the model to flag unreadable or missing options. Automatic stickers are also suppressed for recognized homework/quiz/exam contexts. A directly requested sticker still follows the existing sticker setting. Answer layout and factual correctness depend on the configured model. For long answer sets, increase **Max output tokens** if the existing cap cuts the reply short.

Before delivery, balanced Markdown bold in ordinary prose is converted to WhatsApp's single-asterisk format: `**Jawaban:**` becomes `*Jawaban:*`. The same text is saved in conversation memory. This also applies in custom persona mode without changing its system prompt. Inline, fenced, and indented code, escaped stars, common powers, and path wildcards are preserved. Put literal formatting examples inside backticks. Ambiguous, unmatched, and triple-asterisk runs are left as supplied; this is a narrow bold correction rather than a full Markdown converter.

**Sticker replies → Occasionally, to suit the chat** lets the model choose one of **24 original pink-ribbon cat reactions**, including laughter, hugs, gratitude, thinking, goodnight, coffee, celebration, and farewell. They arrive as native WhatsApp stickers alongside the text, quoting the incoming message. Automatic reactions are limited to one per chat every two minutes and are suppressed for file uploads and recognized serious or technical requests. The model is also instructed to avoid reactions in sensitive exchanges. The model can skip a sticker; they are not added to every answer.

You can request one directly, for example **“Kirim stiker lucu dong”** or **“Send me a cute sticker please”**. Direct requests bypass the automatic pause. Choose **Only when requested** or **Off** to reduce or disable stickers. The existing private-chat/group-tag trigger still controls which messages the bot accepts; stickers do not start new conversations or bypass group addressing.

The 24 transparent WebP files under `assets/stickers/` ship with the source. Keep that directory when uploading the bot. You can replace individual images using the filenames and instructions in [the sticker pack guide](assets/stickers/README.md). No additional service, API key, or runtime image converter is needed. A failed sticker upload leaves a successfully sent text reply intact; sticker-only replies have a text fallback. Emoji and kaomoji travel as ordinary text. Sticker choice and conversational phrasing depend on the configured model following the runtime instructions.

## Dashboard

The dashboard and sign-in screen use a dark theme with muted green accents, locally bundled Manrope typography, and clear connection states. The top navigation jumps to Connection, AI provider, Bot behavior, Access, and Advanced. Provider and behavior settings sit side by side on wider screens and stack on phones; pairing codes retain their original black-and-white contrast.

Save changes applies the full settings form. Existing configuration, masked keys, WhatsApp pairing, and reply preferences stay in place when updating. Keep the complete `src/web/public/` directory, including `fonts/`. The dashboard makes no external font or CDN requests. Install backend and dashboard source together for access-control updates. After an update, use Ctrl+F5 if your browser still shows the previous styling.

## Hosting requirements

Run the bot and dashboard together as one continuously running Node.js process with persistent writable storage. Pterodactyl / Botkeep with a Node.js 24 image supports this deployment model; keep `secrets.env` and the root `storage/` directory across restarts and redeployments.

The complete v1 application is not configured for Vercel. Vercel's Express detection expects a recognized entry file to import Express and expose its application; this project's entry point composes the bot and a web-server factory instead. Adding an Express entry point would also require adapting the runtime: Vercel runs Express as a Function, local storage is ephemeral, and function instances do not share this application's in-memory sessions or WhatsApp state. Vercel now supports WebSockets in public beta, but their connection lifetime is bounded by the function duration. A separate persistent bot backend would be required for a Vercel-hosted dashboard.

References: [Vercel Express deployment](https://vercel.com/docs/frameworks/backend/express), [Vercel WebSocket lifecycle](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), [Vercel local storage limitations](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).

## Pterodactyl / Botkeep deployment

Deploy the complete current `main` branch. An earlier commit omitted `src/storage/settingsRepo.js` and `src/storage/jsonStore.js` because the runtime storage ignore rule also matched source code. The corrected rule excludes only the root `/storage/` directory. Updating npm packages alone cannot restore these application files.

1. Stop the server in the panel, then update the checkout with `git pull --ff-only` or redeploy the latest repository files. Preserve your existing `secrets.env` and root `storage/` data. Preserve a legacy `.env` until setup has copied it to `secrets.env`.
2. Run `npm ci --omit=dev`. Run `npm run setup` if `secrets.env` has not been created; it preserves an existing file. When only a legacy `.env` exists, setup copies it unchanged to `secrets.env`, preserving the existing `SESSION_SECRET` and encrypted provider key access.
3. The bot automatically uses Pterodactyl's exported `SERVER_PORT`, even if `secrets.env` or a Startup `PORT` still contains an old port. It also binds to `0.0.0.0` on Pterodactyl; leave the Startup `HOST` blank or set it to `0.0.0.0`. Keep valid `DASHBOARD_PASSWORD` and `SESSION_SECRET` values.
4. Set the startup command to `npm start`, then start the server and open the dashboard using the panel's allocated address and port.

Changing the primary allocation takes effect on the next server start; no `secrets.env` port edit is needed. Pterodactyl documents `SERVER_PORT` as the primary allocation's port in its [built-in environment variables](https://docs.pterodactyl.io/v1/guides/egg-creation/egg-variables). If a custom host does not export it, set `PORT` to the allocated port and `HOST=0.0.0.0` manually.

The optional npm install-script notices shown for Baileys and protobufjs do not cause the missing local module error. If that error remains after updating, check that both files above exist under `/home/container/src/storage/`; the deployed checkout is still incomplete.

If startup reports `DASHBOARD_PASSWORD` or `SESSION_SECRET` configuration errors, the effective credentials are missing or too short:

- In the panel File Manager, place `secrets.env` directly in `/home/container`, beside `package.json`. The filename must be `secrets.env`; `secrets.env.example` is a template.
- `npm run setup` generates private credentials when both `secrets.env` and legacy `.env` are absent. It preserves an existing `secrets.env`. If only `.env` exists, setup copies its contents unchanged into `secrets.env` instead of generating new credentials. For an existing file, fill `DASHBOARD_PASSWORD` with 12–1,024 characters and `SESSION_SECRET` with a random value of at least 32 characters.
- Empty Startup variables fall back to values in the project-root `secrets.env`, or to legacy `.env` only when `secrets.env` is absent. The files are never merged. A non-empty Startup value still overrides the selected file, so replace a short `SESSION_SECRET` with the complete valid value from `secrets.env`, or clear that Startup field to use the file. Required credentials are still validated before startup.
- Leave the Startup `HOST` blank or use `0.0.0.0`, and restart after changing the allocation or startup configuration. Keep a previously used valid `SESSION_SECRET` stable so saved provider keys remain decryptable.

## Configuration

Configuration is loaded from the project-root `secrets.env` at startup, regardless of the process working directory. Legacy `.env` is used only when `secrets.env` is absent; the two files are never merged. Non-empty process environment values override the selected file. An exported `SERVER_PORT` takes priority over both exported and file `PORT`; without it, `PORT` keeps its usual precedence and local default. A `SERVER_PORT` written only in either file does not activate Pterodactyl detection. Bot and provider settings are edited in the dashboard and apply to the next request without restarting the server.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Required | 12–1,024 characters. The server rejects missing or weak values. |
| `SESSION_SECRET` | Required | At least 32 characters; signs sessions and derives the API-key encryption key. |
| `SERVER_PORT` | Provided by Pterodactyl | Current primary allocation; overrides `PORT` when exported by the server. |
| `PORT` | `3000` | HTTP and WebSocket port when no exported `SERVER_PORT` is available. |
| `HOST` | `127.0.0.1` locally; `0.0.0.0` on Pterodactyl | Listen address. A non-empty exported `HOST` overrides either default. |
| `STORAGE_DIR` | `./storage` | WhatsApp credentials and settings; relative to the working directory. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |
| `TRUST_PROXY` | `false` | Use `true` behind **one trusted reverse proxy** that sanitizes forwarded headers. |
| `SESSION_TTL_HOURS` | `12` | Dashboard-session lifetime, from 1 to 168 hours. |
| `MAX_TOKENS_CEILING` | `32768` | Server-side upper limit for the dashboard's token setting; at least 512. |

Default behavior: `!` prefix, six complete conversation turns, group replies enabled, private-only disabled, typing enabled, read receipts off. Advanced settings default to a 60-second AI request budget, 5 MB images/stickers, 10 MB documents/audio/video, a 120-second freshness window, and 20 accepted messages per minute per chat. Both size limits can be set from 1 to 20 MB. New media settings load with defaults without changing an existing provider key, persona, or reply trigger.

The default persona uses natural WhatsApp conversation, matches the user's language and tone, and keeps casual replies short without unsolicited coding-task summaries. Customize **System prompt / Persona** in the dashboard's bot settings; saved personas stay in place when you update the application.

**Private chats only takes precedence over group replies.** These restrictions apply to both reply triggers. In command-prefix mode, an empty prefix accepts every eligible inbound message. In **Private chats + group tags/replies** mode, the prefix is ignored: private chats accept every eligible inbound message, while group messages must tag the linked account or quote a message authored by it in the same chat. Phone-number and WhatsApp LID addresses are supported. Status updates, broadcasts, self messages, historical batches, duplicates, and old messages are ignored. Accepted files that cannot be read receive a clear response.

## Incoming attachments

Send an attachment in a private chat, optionally with a question in its caption. Without a caption, the bot describes images/videos, transcribes audio, or summarizes documents. In groups, send it with a bot mention or as a reply to the bot; ordinary group attachments do not trigger downloads or AI requests.

Expired WhatsApp media links returning HTTP 404/410 are refreshed once before retrying the download, within the original download deadline. If the file is still unavailable, send it again as a new attachment selected from your device. A “could not be downloaded” reply means the file has not reached document parsing or the AI provider. The console's `media_download_failed` event reports a safe HTTP status or network/decryption code; `message_failed` includes the processing stage and the public reply. These diagnostics omit media URLs, keys, filenames, file contents and raw errors.

| Attachment | Processing |
| --- | --- |
| Images and WhatsApp stickers | Sent to the model as an image; vision must be enabled. |
| Voice notes and audio | Sent to an audio-capable model for transcription or answering questions. |
| Videos | Sent to a video-capable model for description or questions about the clip. |
| PDF | Automatic mode sends page-labelled text. When tables, scans, images, or column gaps are detected and Vision is enabled, every page is also rendered as a high-detail image so the model can check layout and numbers. Explicit native formats send the original PDF. |
| Word DOCX | Local paragraph and table extraction, including merged cells represented in Markdown/HTML. Embedded pictures and exact page formatting are not reconstructed. |
| Word DOC | Local binary Word extraction, including body text, tab-separated table cells, headers, footers, notes, and text boxes when present. Encrypted or invalid documents are rejected. Embedded pictures and exact page formatting are not reconstructed. |
| Excel XLSX, PowerPoint PPTX; OpenDocument ODT, ODS, ODP | Text extracted locally in a bounded worker. Embedded pictures, charts, and exact formatting are not reconstructed. |
| TXT, CSV, JSON, HTML, XML, source code | Decoded as text, never executed. Long content is truncated with a notice. |
| ZIP | Lists the archive's entries; does not recursively read or unpack their contents. |
| Unsupported binary, corrupted, or encrypted files | Clear error explaining that the file could not be read; no claim that its contents were understood. |

Keep **Attachment format → Automatic**, **Files, audio and video**, and **Vision enabled** on for improved PDF table and scan reading. The model receives extracted text plus numbered JPEG images of every page whenever visual reading is needed, including mixed PDFs with searchable text on some pages and scans on others. It is instructed to check column headers, row labels, merged cells, units, and table continuations across pages, and to identify unclear numbers rather than guess. Ordinary text PDFs and DOC/DOCX files are read locally as text.

If Vision is disabled, PDFs that need visual reading retain the original native PDF instead of silently dropping scanned content. For `ag/gemini…` models in 9Router, native audio uses `audio_url`, while native PDFs and videos use `image_url` data URIs with their actual MIME type. These native paths were verified with the configured router; its standard file parts returned answers without recognizing the attached content. For another 9Router Gemini model alias, choose **9Router Gemini** explicitly. **Standard files** uses `file.file_data` parts. Both explicit formats send the original PDF and let the provider perform its own document reading.

Other OpenAI-compatible providers and models may support fewer attachment types or require another API; a successful **Test connection** verifies a text request only. A rejected attachment tells you to check model support. Audio, video, visual PDF pages, and native PDF uploads require a compatible multimodal model. Ordinary text PDFs and Office documents can use a text-capable model in Automatic mode. Recognition of small or blurred table entries still depends on scan quality and the selected model.

Documents are limited to 60,000 extracted characters, with an explicit truncation notice. Visual PDF reading supports up to 20 pages and 8 MiB of generated JPEG data; it renders every page or returns a clear limit error, without sampling or dropping later pages. Final page images are limited to 2400 pixels per edge and 4 million pixels. Internal image canvases allow up to 8192 pixels per edge and 16 million pixels, including typical 300 dpi A4 scans. Split long PDFs, or optimize unusually large page images, before reuploading.

Document parsing has separate limits on expanded archive size, entry count, worker memory, and time. PDF processing uses up to 75% of the dashboard's AI Timeout, capped at 120 seconds; the default 60-second Timeout permits 45 seconds for reading and leaves time for the model response. Other Office documents retain a 15-second limit. The total AI deadline still includes document preparation and the provider request. For a slow Pterodactyl server, use an AI Timeout of at least 180 seconds and resend the PDF; the PDF reader can then use its full 120-second cap. Keep a higher saved Timeout if one is already set. At most two PDF/Office readers run together; a busy reader asks you to retry. No Word, LibreOffice, FFmpeg, Python, or OCR downloads are required on the server. PDF rendering uses bundled PDF.js assets and the canvas package's platform binary; parsing stays inside the bounded worker and does not launch a separate parser process.

PDF processing failures emit a `document_processing_failed` log with the reader version, last processing phase, completed-page count and elapsed/allowed time. This identifies a slow import, extraction or page render without logging the document's name, contents or encoded images.

A `document_processed` event confirms local reading completed. If the following AI request fails with HTTP 503, the configured AI endpoint returned an unavailable response; increasing the PDF processing budget does not repair that provider response.

PDF scan rendering uses a compatibility adjustment for the pinned PDF.js build to avoid slow pixel conversion. The application verifies that build and loads a derived rendering module while preserving the installed source. This works with dependency installation scripts disabled; the existing page, image, memory and time limits still apply.

After a successful upload, ask questions about the most recent file in the same chat. Its prepared contents remain in a separate RAM-only context for up to 15 minutes while the upload is still inside the configured conversation window. Set **Memory / context** above zero for follow-ups. The context holds at most 100 chats and 32 MB of encoded content in total; the least recently used contexts may be evicted earlier. A newer upload replaces the previous context, even if the newer file cannot be processed. Restart, account logout, leaving the history window, disabling the relevant media control, or changing the provider/model/attachment format invalidates the context. Reupload the file if its context has expired. Neither file bytes nor extracted contents are written to disk or added to the ordinary input-message history.

Primary references: [9Router Gemini attachment translation](https://github.com/decolua/9router/blob/ce4460ef79382bfddb4aa5fc0ff9f3cb0d5f95a8/open-sse/translator/formats/gemini.js), [Gemini audio](https://ai.google.dev/gemini-api/docs/generate-content/audio), [Gemini file inputs](https://ai.google.dev/gemini-api/docs/file-input-methods), [OfficeParser](https://github.com/harshankur/officeParser), [PDF.js page rendering](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs), [Word Extractor](https://github.com/morungos/node-word-extractor), [Microsoft Word FIB flags](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/26fb6c06-4e5c-4778-ab4e-edbf26a545bb).

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
- `storage/settings.json` is written atomically through a serialized queue. The provider key is encrypted with AES-256-GCM; API responses expose only a fixed mask. Invalid settings are backed up before defaults are used. Runtime files, `secrets.env`, legacy `.env`, logs, and test screenshots are Git-ignored.
- WhatsApp authentication lives in `storage/auth_info`. Back up this directory and `secrets.env` privately. Directory/file permissions are restricted on platforms supporting POSIX modes; use equivalent private ACLs on Windows.
- Conversation memory stays in RAM and holds only text. Attachment input history stores a metadata placeholder plus its caption. A separate bounded RAM-only context keeps the latest file available for follow-up questions as described above. Both clear on process restart or account logout; abandoned old-account work cannot restore them.
- Application logs contain events, message IDs, processing stages, safe status/error codes and public failure replies, with no message bodies or provider credentials. Baileys' internal logger is silent. Incoming content and current conversation history are sent to the configured AI provider.
- Media downloads accept only HTTPS hosts under `whatsapp.net`; redirects are rejected and reupload results are validated. Downloads are bounded by declared and actual byte count and deadline; their private network dispatcher is destroyed when finished or timed out.

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

Settings validation returns `400` with a flat `fields` map. Sending `"********"` for an unchanged saved key preserves it. Schema additions to the PRD: `ai.maxImageMB`, `ai.mediaEnabled`, `ai.maxFileMB`, `ai.attachmentTransport`, `bot.personaStyle` (`feminine` / `custom`), `bot.stickerReplies` (`contextual` / `on-request` / `off`), `bot.accessMode` (`everyone` / `owner-only` / `allowlist`), `bot.ownerNumber` (international digits or empty in Everyone mode), `bot.allowedNumbers` (array of up to 100 international numbers), `bot.replyTrigger`, `bot.maxMessageAgeSeconds`, `bot.markRead`, and `bot.rateLimitPerMinute`. Omitted access fields on a save retain the current policy; explicitly choose `everyone` to reopen access.

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

Baileys is pinned to `7.0.0-rc14`, the supported 7.x security line; a stable 7.0 release was not available at implementation time. The OpenAI SDK is pinned to `6.49.0` and OfficeParser to `8.1.1`. OfficeParser requires Node.js 22.13 or newer; deploy on Node.js 24 LTS. References: [Baileys security policy](https://github.com/WhiskeySockets/Baileys/blob/master/SECURITY.md), [Baileys releases](https://github.com/WhiskeySockets/Baileys/releases), [OpenAI SDK v6.49.0](https://github.com/openai/openai-node/blob/v6.49.0/README.md), [OfficeParser package requirements](https://github.com/harshankur/officeParser/blob/master/package.json).

Before upgrading: run the suite and browser checks, inspect dependency advisories, verify media download and Baileys exports, then test QR pairing, credential reload, transient reconnect, restart, logout, text, and vision on a dedicated account. The v2 roadmap in the PRD remains outside this release.
