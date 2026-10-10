# Verification

## PDF tables, scans, DOCX and legacy DOC — 2026-10-10

Automatic PDF reading now preserves page-labelled Markdown text and, when visual content is detected and Vision is enabled, sends high-detail JPEGs of every page. This prevents a searchable heading or a text-only first page from hiding scanned tables later in the document. The model is asked to verify row/column associations, merged cells, units, and cross-page continuations. Ordinary text PDFs stay text-only; disabling Vision or selecting an explicit native transport preserves the original PDF route.

DOCX output retains table and merged-cell structure through Markdown/HTML. Legacy binary DOC extraction reads body text, tab-separated table cells, headers, footers, notes, and text boxes in the existing isolated worker. Full compound-file and Word FIB validation rejects invalid or encrypted inputs before extraction, including cyclic allocation chains. It requires no Word or LibreOffice installation.

| Check | Result |
| --- | --- |
| Regression before integration | Digital, scanned and mixed PDF cases lacked visual pages; merged DOCX cells lost structure; valid DOC uploads were rejected. New preparation/cache and real incoming-message regressions failed before integration, then passed. |
| `npm test` on Node 24.20.0 | 236 passed; zero failures, cancellations, or skips. |
| `npm run check` | All 43 JavaScript files passed. |
| `npm audit --omit=dev` | Zero reported production dependency vulnerabilities. |
| PDF page coverage | Real two-page digital, scanned and mixed fixtures each send both numbered pages, including through upload and text-only follow-up. Over 20 visual pages rejects with a split-file instruction instead of partial output. |
| PDF rendering | Real bundled-font reads succeed through local filesystem paths. A 2480×3508, 300 dpi A4 scan is accepted and downscaled; oversized internal canvases and incomplete-parser warnings reject safely. Page, canvas, PDF loading-task, worker and worker-slot cleanup were reviewed. |
| DOCX tables | Real OOXML fixture retains a two-column merged heading and Revenue/Cost row-value associations. |
| Legacy DOC | Licensed real binary fixtures cover table separators, Unicode, headers/footers, notes and text boxes. MIME-specific and generic uploads work through the incoming pipeline and follow-up. Encrypted, obfuscated, spoofed, truncated and cyclic files reject safely. |
| Cache controls | Visual PDF context requires both media and vision controls; disabling either prevents reuse. Ordinary message history excludes document contents and encoded page images. |
| Live configured 9Router model | Digital, scanned and mixed synthetic PDFs each produced correct Total-column values from both pages on a follow-up after a content-free acknowledgement. Saved settings stayed byte-for-byte unchanged. |
| Live Word limitation | DOC/DOCX requests returned HTTP 503, including a repeated bounded probe. A separate ordinary-text control and both text-string/text-array controls also returned HTTP 503 with provider-unavailable responses. Local extraction and controlled-provider delivery passed; live Word recognition was not established in this run. |
| Independent review | No remaining helper or integration blockers after fixes for DOC allocation validation, PDF asset paths, canvas allocation bounds, and parser warnings. Final scan compatibility separates output-page limits from internal image limits. |
| Complete source package | The complete 79-entry ZIP passed a fresh `npm ci --omit=dev --ignore-scripts`, 110 packaged document/AI/context/incoming-message tests, and exported CLI health/login/authenticated-settings checks on its assigned port. Synthetic `secrets.env`, legacy `.env`, encrypted settings and an existing auth marker stayed byte-for-byte unchanged. Only the isolated unpaired fixture process was started and stopped. |

Visual PDF limits are 20 pages and 8 MiB total JPEG data, with no page sampling. Final page images are capped at 2400 pixels per edge and 4 million pixels; internal image canvases allow 8192 pixels per edge and 16 million pixels. Text extraction remains capped at 60,000 characters with a truncation notice. PDF/Office readers share the two-worker concurrency bound, total AI deadline, and per-document limits. Recognition of blurred or very small table entries still depends on the original scan and model.

These checks used public or synthetic fixtures only. Operator documents and the remote Pterodactyl runtime were not accessed, and the operator's running bot was not restarted. Deployment needs the updated source and dependencies, Automatic attachment format, Files enabled, Vision enabled for visual PDFs, and a vision-capable model.

## PDF/DOCX reading and follow-ups — 2026-10-10

Investigation reproduced a lost-content follow-up: the upload request contained the extracted document, but the next text-only request received only a filename/type/size placeholder. Automatic PDFs also depended entirely on native model PDF support. Automatic mode now extracts text PDFs locally in the bounded document worker, as it already does for DOCX. Valid scanned PDFs retain native fallback; explicit native formats preserve the original PDF transport. Malformed PDFs receive a safe parsing error.

A separate latest-file context now reinserts prepared content into same-chat follow-ups without changing normal input-message history or writing file contents to disk. It is bounded by 32 MB total encoded content, 100 chats, the configured conversation window, and a fixed 15-minute upload lifetime. Provider/model/format scope, vision/media controls, and account-generation guards prevent inappropriate reuse; account reset clears it.

| Check | Result |
| --- | --- |
| Follow-up regression | Seven new AI/incoming-message tests first failed because file contents were absent, then passed with the integrated fix. |
| `npm test` on Node 24.20.0 | 208 passed; zero failures, cancellations, or skips. |
| `npm run check` | All 37 JavaScript files passed. |
| Real document parsing | Multi-field text PDF, scanned PDF native fallback, malformed PDF rejection, disabled/size guards, and DOCX paragraph/table extraction passed. PDF parsing uses `separateProcess: false` inside the existing worker; no OCR or new dependencies. |
| Context isolation and limits | Tests cover same-chat access, account reset, history expiry, scope/control invalidation, original upload TTL, LRU/global byte limits, UTF-8 accounting, defensive copies, and retaining file contents during the one context-overflow retry. |
| Failed replacement regression | Provider rejection and an invalid newer upload first reproduced reuse of the previous file. Both now clear the previous context before validation; the new regression cases pass. |
| Focused integration review | Cleared after the failed-replacement fix. Successful uploads still cache only after a successful current-account response. |
| Live configured 9Router | Synthetic PDF and DOCX text was extracted locally. An initial READY acknowledgement omitted the answer; a later text-only question correctly recovered the test word from each uploaded document through the production service. Saved settings remained byte-for-byte unchanged. |
| Complete source ZIP | Includes the latest-file context, parser worker, manifests, dashboard assets, and update instructions. Runtime environment files, storage, and dependencies are excluded. |
| Clean production package | A fresh `npm ci --omit=dev --ignore-scripts` and all 82 packaged AI/context/attachment/incoming-message tests passed. The exported CLI served health, login, and authenticated settings on its assigned port, loaded legacy encrypted settings, and preserved synthetic environment files, settings, and an existing auth marker byte-for-byte. Only the isolated fixture process was started and stopped. |

These live probes used synthetic documents with the authorized key privately. The operator's original failed files were not supplied, and the remote Pterodactyl runtime was not accessed. Full application and provider checks establish the corrected behavior; deployment requires the new source ZIP or checkout and a restart. Earlier browser results below apply to the unchanged dashboard.

## Previous attachment release — 2026-10-10

The current application supports private-chat attachments without a prefix in the private-chat/group-addressed trigger mode. Group attachments require a mention of the linked bot or a reply to its message in the same chat. Existing explicit prefix-mode settings retain their behavior.

| Check | Result |
| --- | --- |
| `npm test` on Node 24.20.0 | 184 passed; zero failures, cancellations, or skips. |
| `npm run check` | All 35 JavaScript files passed. |
| `npm run test:ui` | Login and dashboard passed at 1440px and 360px, including attachment controls, save/reload persistence, and disabled-control behavior. |
| Browser accessibility | Zero detected axe WCAG AA violations, browser errors, or horizontal overflow. |
| `npm audit --omit=dev` | Zero reported production dependency vulnerabilities. |
| Attachment preparation | Image/sticker, audio/voice, video, PDF, text, six Office formats, and ZIP inventory passed controlled tests. Unsupported, corrupt, oversized, encrypted, and conflicting-signature inputs receive safe errors. |
| Integrated incoming messages | The real bounded downloader, attachment preparation, Office worker, and official OpenAI client were exercised together against a controlled HTTP provider. Private captionless media, addressed group media, and unsupported-file replies passed. Ordinary group media does not download or contact the provider. |
| Live configured 9Router model | Synthetic PNG, PDF, OGG, WAV, MP4, TXT, and DOCX content was recognized through the production AI service and automatic transport with `ag/gemini-3.8-flash-high`. The saved provider settings remained byte-for-byte unchanged. |
| Existing settings | Missing media fields gain defaults without rewriting the old settings file, replacing credentials, or changing the reply trigger. Masked-key saves preserve the encrypted provider key. |
| Focused integration review | Cleared after fixes for generic OGG MIME and document MIME/signature conflicts. Actual OGG bytes map to audio/video OGG; ZIP-backed Office declarations remain valid. |
| Complete Git ZIP | Source modules, worker, manifests, and dashboard assets are included; runtime secrets, storage, and dependencies are excluded. The ZIP overlays an existing synthetic installation without changing protected files. |
| Clean production package | Installed with `npm ci --omit=dev --ignore-scripts`; packaged attachment and incoming-message tests passed. The exported CLI served health, login, and authenticated settings on the exported allocation, loaded legacy encrypted settings with new defaults, and preserved both environment files, settings, and the existing auth marker byte-for-byte. Only the isolated fixture process was started and stopped. |

Audio, video, and PDF require a capable model. The verified 9Router Gemini path uses `audio_url` for audio and `image_url` data URIs with the actual PDF/video MIME; a standard file part returned a successful completion without recognizing the synthetic content on the configured router. Automatic selection is limited to `ag/gemini` model IDs, with explicit transport choices for other aliases and providers.

Office extraction reads text, without reconstructing embedded images or layout. ZIP support lists filenames rather than recursively extracting contents. Workers have memory, archive-expansion, time, and concurrency limits; at most two Office readers run together. Files and extracted contents are excluded from conversation history. Node.js 22.13 or newer is required by OfficeParser; Node.js 24 is recommended. The older Node 20 results below apply only to the earlier application.

Live provider checks used synthetic fixtures and the authorized saved key privately. Full media delivery from the operator's phone, live reconnect of that paired account, and deployment to the remote Pterodactyl container were not performed by these checks. The tests establish incoming-message behavior and live model recognition separately.

## Historical v1 checks — 2026-10-08/09

Startup and environment checks updated on 2026-10-09 in the supplied Windows workspace. Browser and accessibility results below were verified on 2026-10-08; the environment fix does not change the dashboard.

| Check | Result |
| --- | --- |
| Pinned dependency installation | Passed; package-lock.json saved. |
| `npm test` on Node 24.20.0 | 96 tests passed; zero failures or skips. |
| Standalone official Node 20.20.2: `node.exe --test` with the explicit files in `tests/` | 96 tests passed; zero failures or skips. |
| Node 20 dependency imports | Baileys socket/auth/media exports and the private Undici dispatcher loaded successfully. |
| `npm run check` | All 31 application, script, and test JavaScript syntax checks passed. |
| `npm run test:ui` | Desktop 1440px and mobile 360px passed. |
| Browser accessibility | Zero detected axe WCAG 2 A/AA and WCAG 2.1 AA violations on login and dashboard. |
| `npm audit --omit=dev` | Zero reported production dependency vulnerabilities. |
| Real application startup | Dashboard served locally, Baileys started, and an authenticated status request reported `qr_required` with a real QR image. |
| Git distribution regression | A fresh Git staging fixture includes every source module and dashboard asset, while excluding `.env` and root storage credentials. |
| Clean Git export startup | Exported the staged Git tree, installed production dependencies with `npm ci --omit=dev`, and started the actual CLI on Node 24.20.0 and Node 20.20.2 with blank panel exports and a working directory outside the project. Health, login, and authenticated status returned HTTP 200 on port 33506; WhatsApp reached `connecting`. |
| Invalid non-empty CLI override | A short exported `SESSION_SECRET` still overrides the file and exits with the original validation error; neither credential was reflected in the error. |

The Node 20 check used the official Windows x64 archive, verified against Node.js's published SHA-256 checksum. The test script uses Node's automatic test discovery for compatibility across Windows Node 20 and Node 24. The compatibility check supplied the current test files explicitly to exclude archived verification fixtures. Each clean-export smoke process was stopped after verification, and its private environment file remained unchanged.

## Deployment packaging correction

The original Git commit omitted `src/storage/settingsRepo.js` and `src/storage/jsonStore.js`: its unanchored `storage/` ignore rule matched both runtime storage and application source. Local tests loaded the existing untracked files, so they did not detect an incomplete Git distribution. The rule now excludes only `/storage/`, and both source modules are included in Git.

The new regression reproduced the exact two-file omission before the fix. The corrected Git export starts successfully with freshly installed production dependencies even when npm blocks the optional Baileys/protobufjs install scripts. The Pterodactyl server itself was not accessed; the operator must deploy the updated repository and configure its allocated host/port as described in README.md.

## Runtime environment correction

Blank process variables exported by a hosting panel previously masked valid credentials in `.env`. The CLI now reads `.env` from the project root and merges only non-empty process values over it before applying the existing strict validation. This also resolves startup from a different working directory. Non-empty overrides continue to take precedence, so an invalid non-empty panel value must be corrected or cleared.

Six regression tests cover blank fallback, invalid non-empty override rejection, environment-only deployment, mixed/default values without input mutation, sanitized file-read errors, and project-root file resolution. Focused review found no blockers. Clean-export startup verified the original blank-export scenario through the actual CLI on both supported runtime versions without changing the existing generated credentials.

## Automated acceptance evidence

- Environment validation rejects missing/weak secrets, malformed ports, invalid log levels, and invalid proxy flags. Setup generates valid secrets without printing them or overwriting an existing `.env`.
- Password login, strict private cookies, expiry/signature validation, immediate logout revocation, five-attempt IP lockout, malformed-cookie handling, and origin validation are tested. APIs authenticate before parsing/validating private requests. Anonymous and foreign-origin WebSocket upgrades are rejected.
- Settings round-trip through AES-256-GCM encryption and atomic serialized writes. Public copies contain only a fixed key mask; unchanged masks preserve keys during concurrent saves. Validation errors preserve the previous active configuration. Invalid disk JSON is backed up; unreadable files are not overwritten.
- Local HTTP integration exercises the official OpenAI client on `/v1`, `/api/v1`, and `/openai/v1` base paths with authorization, model selection, settings, text, and vision arrays. Tests cover hot provider/model switching, transient errors, exactly three retries, timeout, nonretryable authentication failures, one context-overflow retry, empty completions, and safe error messages.
- Conversation windows retain complete turns per chat and evict bounded idle history. Images retain text placeholders. Logout clears account memory and prevents old in-flight work from restoring it.
- Controlled Baileys sockets verify QR/state events, credentials, transient backoff, continued retry after construction failures, repeated restart, stale events, logout, credential flush, and shutdown cancellation. Deduplication/rate state and chat serialization survive same-account socket replacement.
- Message tests cover every message in notify events, self/broadcast/history/age filters, wrapped text/images, private/group priority, group sender-key metadata, exact prefixes, read/typing behavior, rate/queue bounds, and replies quoted to the originating message.
- Media tests reject oversized files before download and oversized streams before encoding, validate JPEG/PNG/WebP/GIF signatures, restrict initial/redirect/reupload URLs to trusted WhatsApp media hosts, terminate stalled downloads, and suppress inference from an old closed account handler.
- Browser checks cover failed/successful login, complete settings saves, key clearing, provider test, private/group interaction, QR/status pushes, keyboard dialog activation/Escape/focus restoration, both session actions, reload persistence, and sign-out. No horizontal page overflow or browser JavaScript errors were detected. Artifacts are in `test-results/` and contain only synthetic test data.

## Operator acceptance still required

These checks require access to the operator's phone and provider account; they were not represented as completed by local substitutes:

- Scan the real QR and confirm the linked account shows Connected within five seconds.
- Save a real provider key/model and confirm actual text and vision replies in WhatsApp.
- Verify live model/account availability and quotas against OpenAI, OpenRouter, Ollama, and Groq as relevant. Local HTTP tests establish the protocol contract, not live provider certification.
- Confirm live reconnect and credential persistence with a paired account after network loss and process restart.

The PRD's v2 roadmap is excluded from v1. Its conflicting remote-logout/storage wording is resolved as documented in the implementation plan: invalidate fatal logged-out credentials and wait for an operator; explicit dashboard logout starts fresh pairing.

## Implementation boundaries

The dashboard has no frontend build step. Bot settings and credentials persist on disk; conversation memory and dashboard sessions are process-local. Access beyond the machine requires an intentional HOST setting and HTTPS deployment. WhatsApp media is restricted to subdomains of `whatsapp.net`; a future upstream media-host change requires an explicit policy update. No live provider request was made using operator credentials during the initial v1 checks; the newer attachment verification above includes authorized synthetic live-provider requests.
