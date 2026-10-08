# v1 Verification

Verified on 2026-10-08 in the supplied Windows workspace.

| Check | Result |
| --- | --- |
| Pinned dependency installation | Passed; package-lock.json saved. |
| `npm test` on Node 24.20.0 | 90 tests passed; zero failures or skips. |
| Standalone official Node 20.20.2: `node.exe --test` | 90 tests passed; zero failures or skips. |
| Node 20 dependency imports | Baileys socket/auth/media exports and the private Undici dispatcher loaded successfully. |
| `npm run check` | All 29 application, script, and test JavaScript syntax checks passed. |
| `npm run test:ui` | Desktop 1440px and mobile 360px passed. |
| Browser accessibility | Zero detected axe WCAG 2 A/AA and WCAG 2.1 AA violations on login and dashboard. |
| `npm audit --omit=dev` | Zero reported production dependency vulnerabilities. |
| Real application startup | Dashboard served locally, Baileys started, and an authenticated status request reported `qr_required` with a real QR image. |
| Git distribution regression | A fresh Git staging fixture includes every source module and dashboard asset, while excluding `.env` and root storage credentials. |
| Clean Git export startup | Exported the staged Git tree, installed production dependencies with `npm ci --omit=dev`, and started the exported application on Node 24.20.0. Health returned HTTP 200 and WhatsApp reached `connecting`. |

The Node 20 check used the official Windows x64 archive, verified against Node.js's published SHA-256 checksum. The test script uses Node's automatic test discovery for compatibility across Windows Node 20 and Node 24. The final running application returned HTTP 200 for health and authenticated status.

## Deployment packaging correction

The original Git commit omitted `src/storage/settingsRepo.js` and `src/storage/jsonStore.js`: its unanchored `storage/` ignore rule matched both runtime storage and application source. Local tests loaded the existing untracked files, so they did not detect an incomplete Git distribution. The rule now excludes only `/storage/`, and both source modules are included in Git.

The new regression reproduced the exact two-file omission before the fix. The corrected Git export starts successfully with freshly installed production dependencies even when npm blocks the optional Baileys/protobufjs install scripts. The Pterodactyl server itself was not accessed; the operator must deploy the updated repository and configure its allocated host/port as described in README.md.

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

The dashboard has no frontend build step. Bot settings and credentials persist on disk; conversation memory and dashboard sessions are process-local. Access beyond the machine requires an intentional HOST setting and HTTPS deployment. WhatsApp media is restricted to subdomains of `whatsapp.net`; a future upstream media-host change requires an explicit policy update. No live provider request was made using operator credentials.
