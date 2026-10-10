# Implementation progress

## PDF tables/scans, DOCX and DOC support — 2026-10-10

- Automatic PDF reading combines page-labelled Markdown with high-detail images of every page whenever tables, scans, images, sparse text or column gaps need visual verification. Mixed documents no longer lose scanned pages because another page or heading has searchable text. Simple text PDFs stay text-only; existing native transports remain available.
- Visual reading accepts up to 20 pages and 8 MiB of JPEG data; exceeding limits returns a clear instruction instead of partial reading. A real 300 dpi A4 scan is accepted and downscaled. Local bundled-font paths, internal canvas bounds, incomplete-page warnings and resource cleanup were verified.
- DOCX extraction preserves tables and merged cells in Markdown/HTML. Added binary DOC support without Word/LibreOffice: body, table tabs, Unicode, headers/footers, notes and text boxes. Validation rejects invalid, encrypted and cyclic compound files safely in the bounded worker.
- Added real incoming DOC and mixed-PDF upload/follow-up coverage. Visual PDF context obeys both Files and Vision controls; document contents remain outside ordinary message history and disk storage.
- Fresh verification passed 236/236 tests, 43 syntax checks, and a production audit with zero advisories. Independent helper/integration review cleared the fixes. Live 9Router follow-ups correctly read numeric table entries across both pages for digital, scanned and mixed PDFs.
- Live DOC/DOCX verification received HTTP 503; a separate ordinary-text control also returned provider-unavailable HTTP 503. Local extraction and controlled-provider delivery passed. Saved private settings remained unchanged.
- A complete 79-entry source ZIP passed a fresh production install, 110 packaged document/AI/context/incoming-message tests, and exported CLI health/login/authenticated-settings checks on its assigned port. Overlay and startup preserved synthetic environment files, encrypted settings and pairing marker data. Update instructions require Automatic, Files and Vision for visual PDFs, while preserving existing `secrets.env` and `storage/`.

## PDF/DOCX reading fix — 2026-10-10

- Reproduced loss of file contents on the text-only question after upload. Added a bounded latest-file context in RAM with history/scope/control checks, fixed upload lifetime, byte/chat eviction, and account-reset protection. Normal input history still stores metadata; files are not written to disk.
- Automatic PDF handling now reads text locally, including multi-field PDFs. Valid scanned PDFs retain native fallback; explicit native transports remain available. Parsing shares the existing two-worker limit and disables the library's separate PDF subprocess.
- Added DOCX paragraph/table extraction coverage and real incoming DOCX-to-text-follow-up integration. Seven new follow-up tests failed before integration and passed afterward.
- Fresh verification: 208/208 tests and 37 syntax checks passed. Live synthetic PDF and DOCX acknowledgements were followed by successful content questions through 9Router; saved settings were preserved.
- Independent review cleared the context lifecycle after a regression fix: a failed newer upload now removes the previous file instead of presenting it as the most recent attachment. Both invalid-file and provider-rejection cases were reproduced before the fix and pass afterward.
- A complete source ZIP passed a fresh production install, 82 packaged AI/context/attachment/incoming tests, and CLI startup with health/login/authenticated settings on its assigned port. The overlay and startup preserved synthetic environment files, encrypted settings, and an auth marker. Update instructions call for Automatic attachment format and a nonzero conversation window.

## Incoming attachments — 2026-10-10

- Added images/stickers, documents, voice notes/audio, and video/PTV to the incoming-message pipeline. Private chats accept enabled attachments without captions in the private-chat/group-addressed mode; groups still require a bot tag or reply. Legacy prefix mode remains available.
- Added bounded text and six-format Office extraction, ZIP filename inventory, native multimodal transport, and clear errors for unsupported, corrupt, encrypted, or oversized files. Office parsing uses at most two isolated workers and does not download OCR components.
- Added dashboard media controls, limits, and transport selection. Existing encrypted settings load the new defaults without rewriting the saved file or changing credentials. `secrets.env` and Pterodactyl's allocated-port behavior are preserved.
- Verified recognition of synthetic PNG, PDF, OGG, WAV, MP4, TXT, and DOCX through the configured 9Router Gemini model. Automatic transport uses the verified audio/PDF/video paths; other provider transports remain configurable.
- Verification: 184/184 tests and 35 syntax checks passed on Node 24.20.0. Dashboard checks passed at 1440px/360px with zero detected axe WCAG AA violations or browser errors; production dependency audit reported zero advisories. Independent integration review cleared the OGG and MIME/signature fixes.
- Packaging: a complete source-only Git ZIP passed a fresh production installation, packaged attachment tests, and actual CLI startup with the exported allocated port. Overlay and startup preserved synthetic existing environment files, encrypted settings, and pairing data; the operator's running bot was not restarted.
- Runtime requirement is now Node.js 22.13 or newer; Node.js 24 is recommended. The Node 20 results in the historical record below do not apply to this update.

## Historical implementation record

Plan: docs/superpowers/plans/2026-10-08-whatsapp-ai-chatbot.md

- At project start, the workspace contained only the supplied PRD and no Git repository.
- Implementation follows the supplied v1 design; no additional approval gate is required for the authorized build.
- ai_storage owns settings and AI services; provider_research verifies upstream APIs. Main owns web, bootstrap, package, docs, and integrated checks.
- Task 1 complete: encrypted settings, validation, atomic persistence, bounded memory, provider switching, vision, retry, overflow, safe errors, and account-reset isolation.
- Task 2 complete: generation-safe lifecycle, credential flush, abortable backoff, persistent dedup/queues, filtering, group metadata, bounded trusted media downloads, and stale-operation guards.
- Task 3 complete: protected APIs/WebSocket, revocable signed sessions, login lockout, strict origin checks, native dashboard, settings errors, QR/status, and confirmation dialogs.
- Verification updated on 2026-10-09: 96/96 tests passed on Node 24.20.0 and a checksum-verified standalone Node 20.20.2 binary; all 31 JavaScript syntax checks passed. Browser checks at 1440px/360px passed on 2026-10-08 with zero detected axe WCAG AA violations; the clean production install reported zero dependency advisories.
- Final integration review cleared the media transport, timeout, and stale-account fixes. The test command uses automatic discovery for compatibility across Windows Node versions.
- Local application startup at http://localhost:3000 was verified with HTTP 200 health and authenticated status, and a real WhatsApp QR ready for pairing. .env was generated locally without printing secrets. Live account pairing and provider credentials remain operator steps.
- Deployment fix: anchored the runtime storage ignore rule to `/storage/` and included both previously omitted source modules. The Git distribution regression reproduced the omission before the fix and now passes. A clean staged Git export installed production dependencies and started with HTTP 200 health. Linux-sensitive import paths were audited; Pterodactyl host/port setup is documented.
- Runtime environment fix: blank panel exports now fall back to the project-root `.env`; non-empty overrides keep precedence and strict validation. Six regression tests and focused review passed. A clean Git export started through the actual CLI on Node 20 and Node 24 with blank credentials, from a different working directory, and returned HTTP 200 for health, login, and authenticated status on the allocated port 33506. The existing private credentials were preserved.
