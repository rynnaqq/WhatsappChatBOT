# Verification

## Cleaner contextual kaomoji choices — 2026-10-17

The built-in feminine and Renako prompts now share guidance favoring plain text and one optional compact face only when it fits an ordinary casual reply. Mood selection and pacing are explicit, and Renako's examples no longer imply that every message needs decoration. This is model guidance, not output filtering or a hard runtime limit; explicit literal/list requests and custom persona prompts keep their existing contracts.

| Check | Result |
| --- | --- |
| Catalog reproduction | A one-off check against the old catalog rejected ten faces containing formatting markers or exceeding twelve Unicode codepoints. The revised catalog passes with 40 unique faces, maximum length ten, and no ASCII backtick/asterisk/tilde or newline. Both actual built-in prompt builders include the curated choices; prior expression-budget instructions are absent. |
| Focused regression | Existing persona, actual-client answer presentation, native sticker delivery, and bold-format tests passed 47/47. Custom prompt exactness, authored response/history contents, literal examples/code, and sticker controls remain covered. |
| Full suite and syntax | `npm test`: 338 passed, zero failures, cancellations, or skips. `npm run check`: all 58 JavaScript files passed on Node 24.20.0. |
| Independent review | No concrete conflicts, formatting hazards, or required fixes were found in the three source diffs. Review verified ordinary-chat limits, explicit-example exceptions, Renako sample restraint, and unchanged control paths. |
| Limits | Live-model adherence, perceived visual appeal, and actual WhatsApp rendering were not evaluated. No user/model text is removed or rewritten by this change. Unchanged browser assets use the preceding browser evidence; browser flows were not rerun for prompt/catalog edits. |
| Source package | The 127-entry ZIP excludes runtime secrets/storage. Fresh `npm ci --omit=dev --ignore-scripts` and 290 packaged feature tests passed. Its exported owned CLI served health, login, authenticated legacy settings, and byte-matched dashboard assets on the allocated port. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom prompt, and pairing-marker bytes. Only the isolated fixture process was started/stopped. Working/staged diff checks passed. |

## Cuter, funnier Renako with light tsundere banter — 2026-10-16

Refined only the existing Renako guide, original dialogue samples, and documentation. The requested casual adaptation adds bashful pride, gentle protests followed by care, and short situational humor. It is occasional and responsive to the user's tone; serious tasks and explicit formats retain priority. No new character facts are asserted as canon.

| Check | Result |
| --- | --- |
| Application regression | `npm test`: 338 passed, zero failures, cancellations, or skips. `npm run check`: all 58 JavaScript files passed on Node 24.20.0. Existing actual-client tests still verify profile delivery, academic guidance, bold correction, sticker controls, memory, and switching back to custom mode. |
| Prompt review | Independent read-only review found no required fixes. It checked the requested mild degree, varied expressions, warmth and willing help, contextual humor, and the final serious-task/output-format priorities. |
| Scope and limitations | This is prompt wording, not a new application branch. Browser assets and persistence code are unchanged, so their earlier browser checks were not repeated. Fixture replies do not establish live-model naturalness, humor, or consistent tsundere behavior; no live model or real WhatsApp conversation was evaluated. |
| Source package | The 127-entry ZIP excludes runtime secrets/storage. Fresh `npm ci --omit=dev --ignore-scripts` and 290 packaged feature tests passed. Its owned exported CLI served health, login, authenticated legacy settings, and byte-matched dashboard assets on the allocated port. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom instructions, and pairing-marker bytes. Only the isolated fixture process was started/stopped. Working and staged diff checks passed. |

## Renako Amaori character preset — 2026-10-16

The approved selectable Renako Amaori — WATANARE preset adds a character-specific guide and original conversational examples. The introductory character anchors come from the [official profile](https://www.watanare-anime.com/#character) and [publisher synopsis](https://sevenseasentertainment.com/series/theres-no-freaking-way-ill-be-your-lover-unless-light-novel/). Academic formatting, expression choices, sticker controls, and bold correction use existing application paths. Older installations retain their selected style; the operator activates Renako through Reply style and Save changes.

| Check | Result |
| --- | --- |
| RED/GREEN evidence | Before implementation, tests rejected `renako` at settings validation, found no character profile in the actual provider request, and found no academic guide for that style. All three pass with the new branch and enum. |
| Full suite and syntax | `npm test`: 338 passed, zero failures, cancellations, or skips. `npm run check`: all 58 JavaScript files passed on Node 24.20.0. |
| Persistence and compatibility | A real SettingsRepo round-trip retains Renako, encrypted credentials, exact saved instructions, owner number, and additional allowed numbers. Reading leaves disk bytes unchanged; an invalid subsequent style is rejected without replacing the saved file. Legacy feminine defaults and existing custom behavior remain covered. |
| Actual AI boundary | A local HTTP fixture through the official client receives the selected character anchors and shared academic/sticker instructions. The service converts Markdown bold, removes the sticker control from text/history, and returns the allowed shy reaction in one request. Switching to custom/off sends its exact new base prompt on the next request without a character overlay or sticker selection. Authored fixture replies establish plumbing, not model-generated character fidelity. |
| Browser | Chromium passed at 1440 × 1000, 768 × 667, 360 × 667, and 320 × 560. Renako selection survives save/reload while prompt/key stay intact; changing back to feminine works. Existing access, provider, media, QR/status, session/dialog, keyboard navigation, font, and overflow flows pass with zero detected axe WCAG AA violations or browser errors. |
| Independent review | No Critical, Important, or Minor findings within the approved scope. Review checked prompt consistency, source character anchors supplied from primary sources, persistence, shared controls, actual-client tests, and dashboard integration. |
| Complete source package | The 127-entry ZIP includes the new character module and persona notes and excludes runtime secrets/storage. A fresh `npm ci --omit=dev --ignore-scripts` and 290 packaged feature tests passed. The exported owned CLI served health, login, authenticated legacy settings, dashboard, CSS, favicon, bundled font, and license on its allocated port; assets matched archive bytes. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom instructions, and pairing-marker bytes. Only the isolated unpaired fixture was started and stopped. Working/staged diff checks passed. |

Character naturalness, long-conversation drift, factual accuracy, and instruction adherence depend on the chosen model and were not evaluated through live-model generation. No live WhatsApp message, operator data, or remote server was accessed. Only synthetic local fixtures and owned unpaired processes are used in application checks. Original dialogue samples are adaptations rather than quotations; no new character artwork or sticker pack is included.

## WhatsApp bold correction — 2026-10-16

The application now converts ordinary balanced, same-line Markdown bold to WhatsApp's single-asterisk syntax at the AI response boundary. For example, `**Jawaban:** **B. Fotosintesis**` becomes `*Jawaban:* *B. Fotosintesis*`. Sticker controls are parsed first; returned text and conversation memory receive the same corrected answer. The feminine guide requests this syntax, while custom system prompts remain unchanged.

| Check | Result |
| --- | --- |
| RED/GREEN evidence | The actual AI-boundary test failed with the previous raw double-star answer and passed after normalization. Additional regressions reproduced grouped/fractional power corruption, nested quoted tilde fences, and indented code-span endings before the corresponding corrections. |
| Full suite and syntax | `npm test`: 335 passed, zero failures, cancellations, or skips. `npm run check`: all 57 JavaScript files passed on Node 24.20.0. Working and staged diff checks passed. |
| Response and memory | Actual AIService/MemoryService tests use a local HTTP provider through the official client. Common answer/explanation labels convert in one request; numbering, blank lines, code, and answer contents survive. Sticker controls do not leak into history, academic stickers remain suppressed, and custom mode sends its exact base prompt. |
| Literal preservation | Focused cases retain native formatting, escaped/unmatched/triple runs, inline and multiline code, indented code, ordinary/long/quoted/unfinished fences, powers with grouped/signed/fractional operands, Unicode math variables, and path globs. Complete code spans release subsequent prose for correction. CRLF and surrounding whitespace survive; common conversions are idempotent. |
| Independent review | Prior literal-corruption findings were fixed and rechecked with no remaining findings within the agreed conservative scope. |
| Complete source package | The 124-entry ZIP includes the formatter and its tests, excluding runtime secrets/storage. Fresh `npm ci --omit=dev --ignore-scripts` and 287 packaged feature tests passed. Its owned exported CLI served health, login, authenticated legacy settings, dashboard, CSS, favicon, bundled font, and license on the allocated port. Static assets matched archive bytes. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom instructions, and pairing-marker bytes. Only the isolated unpaired fixture was started and stopped. |

These checks use synthetic responses and local fixtures. Actual WhatsApp rendering, live model behavior, and remote Pterodactyl deployment were not exercised. Ambiguous delimiter combinations remain as supplied; literal examples should use backticks. Earlier dashboard browser evidence applies to its unchanged assets.

## Owner access and clearer academic replies — 2026-10-15

The dashboard now controls who may use the bot through Everyone, Owner only, and Owner + allowed numbers. Owner identity is an explicitly configured account separate from the paired bot. Restricted modes check the actual sender before intake side effects; the existing private/group and trigger rules still apply. Academic presentation is an additional feminine-style instruction with a clear answer/explanation example, while custom persona prompts and factual answer text remain unchanged.

| Check | Result |
| --- | --- |
| RED/GREEN evidence | New schema tests failed against missing access defaults/unknown fields. Additional regressions reproduced sparse-list acceptance, the second-restart recovery opening, and automatic stickers for MCQ/study prompts; each passed after its targeted fix. |
| Full suite and syntax | `npm test`: 327 passed with zero failures, cancellations, or skips. `npm run check`: all 55 JavaScript files passed. Working and staged diff checks passed. |
| Sender identity | Private/group owner, permitted users, and strangers are covered with real SDK-shaped keys. PN device variants, undefined alternate fields, first-seen trusted PN/LID pairs, cached LID-only mapping, known conflicts, malformed author fields, mapping failures, and never-settling lookup deadlines are tested. Names, body text, mentions, group IDs, and quoted authors cannot supply the incoming identity. |
| Admission and revocation | Tests verify no unauthorized receipts, presence, downloads, AI calls, deduplication entries, or rate consumption. Queued work and media/AI completions recheck permissions. Deferred identity lookups cover policy revocation and socket deactivation before side effects; reauthorization is bounded. An already dispatched provider operation is not retroactively cancelled. |
| Persistence and recovery | Canonical/deduplicated numbers persist with encrypted keys and cloned public arrays. Invalid saves preserve disk and active policy. Legacy files load compatible defaults without rewriting; omitted fields on older-client saves retain the current policy. Invalid files are backed up and access stays closed across another restart until explicit reconfiguration. |
| Actual AI boundary | Local HTTP provider fixtures receive the academic formatting guide through the actual AI service. Numbering, blank lines, single-asterisk labels, formulas, code, and quotations survive returned replies and memory. Academic sticker controls are removed and suppressed. Custom mode sends its exact base prompt. These checks establish guide delivery and text preservation, not arbitrary model compliance or factual accuracy. |
| Dashboard | Chromium flows passed at 1440 × 1000, 768 × 667, 360 × 667, and 320 × 560. All access modes, conditional owner requirement, backend field errors/correction, formatted-number normalization, duplicates, reload, list retention, saved-only summaries, unrelated saves, and masked keys are covered. Native Tab/Shift+Tab visibility and center hit testing include the new controls. Existing provider, QR/status, dialogs, restart/logout, sign-out, font, and overflow checks passed; zero axe WCAG AA violations or browser errors were detected. |
| Independent review | No remaining critical, important, or minor findings after persistent recovery and academic-context regressions were fixed and re-reviewed. |
| Complete source package | The 122-entry source ZIP excludes runtime secrets/storage and includes all new access helpers and tests. Fresh `npm ci --omit=dev --ignore-scripts` and 279 packaged feature tests passed. Its exported CLI served health, login, authenticated legacy settings, dashboard, CSS, favicon, local font, and license. Static bytes matched the archive. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom prompt, and pairing-marker bytes. |

Only owned synthetic fixtures were started and stopped. The operator's saved credentials, pairing, documents, running bot, real WhatsApp delivery, live AI model, and remote Linux server were not accessed. Physical-device keyboards and Safari/Firefox were not exercised. The configured model determines final phrasing and whether it follows the requested answer layout; unreadable source questions still require clarification.

## Dark, minimal dashboard — 2026-10-11

The existing dashboard and login now share a charcoal theme, muted green controls, local Manrope typography, top navigation, and responsive settings columns. Backend routes and saved configuration contracts remain unchanged. The only new application JavaScript keeps a focused settings control visible when native scrolling leaves it beneath a sticky overlay or exposes only a textarea caret.

| Check | Result |
| --- | --- |
| Full suite and syntax | `npm test`: 299 passed, zero failures, cancellations, or skips. `npm run check`: all 51 JavaScript files passed. Working and staged diff checks passed. |
| Responsive browser flows | Chromium checks passed at 1440 × 1000, 768 × 667, 360 × 667, and 320 × 560. Login/reveal, saved settings and masked keys, provider test, persona/sticker settings, dependent toggles, QR/status updates, dialogs, restart/logout, reload, and sign-out remain covered. Long model identifiers do not cause horizontal overflow. |
| Focus regression | Native Tab initially left the desktop prompt partly above the viewport and covered by the header. CSS margins corrected desktop focus; reverse Tab on a shorter screen still exposed only the textarea's final line. The scoped visibility adjustment now passes native Tab and Shift+Tab across every enabled rendered settings control, with full bounds outside sticky overlays and the actual control resolved by center hit testing. |
| Visual and accessibility checks | Desktop, mobile login, and pairing screenshots were inspected. QR stays opaque and unfiltered against its original white background. Axe WCAG AA audits found zero violations; no browser errors or external asset requests were detected. Manrope is registered, loaded, and used locally. |
| Independent review | No remaining critical, important, or minor findings after the focus regression was fixed and browser evidence reviewed. Existing DOM IDs, input names, CSP, font licensing, and form/session semantics were checked. |
| Complete source package | The 118-entry ZIP includes every dashboard asset and excludes runtime secrets/storage. Fresh `npm ci --omit=dev --ignore-scripts` and 240 packaged tests passed. The exported CLI served health, login, authenticated settings, dashboard HTML, CSS, favicon, font, and license; static asset bytes matched the archive. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom prompt, and pairing-marker bytes. |
| Startup smoke timing | An initial check exceeded the former ten-second startup wait with no application error. A separate launch of the same exported CLI became healthy in 5.99 seconds. The fresh smoke check passed using a condition-based 30-second limit; startup plus asset/auth checks took 6.27 seconds. This does not establish a cause for the initial timing variation. |

Checks use synthetic settings, local provider/socket fixtures, and owned unpaired test processes. No live WhatsApp message or production restart was performed. Browser evidence covers Chromium; physical-device soft keyboards and Safari/Firefox were outside this verification.

## Expanded emoji, kaomoji, and sticker variety — 2026-10-11

The feminine style now uses a shared guide of 60 emoji and 40 kaomoji across six moods, with 24 named sticker reactions. It suggests one to three suitable expressions in casual answers and avoids repeating recent choices. Expressions and stickers remain optional; the existing contextual delivery controls still apply. Custom/off behavior, saved settings, and provider configuration retain their existing contracts.

| Check | Result |
| --- | --- |
| RED/GREEN evidence | Tests against the old implementation rejected new reaction controls and failed native delivery because the assets were absent. All focused persona/AI and sticker tests now pass. |
| Full suite and syntax | `npm test`: 299 passed, zero failures, cancellations or skips. `npm run check`: all 51 JavaScript files passed. Working and staged diff checks passed. |
| Runtime guide | All 60 unique emoji, 40 unique kaomoji, and 24 sticker controls appear in the actual casual system prompt. Independent review checked parsing of every catalog ID and exact custom/off prompt preservation. |
| Real AI and delivery boundaries | Local HTTP tests use the actual AI service and official client: expanded reactions are accepted in one provider call, markers stay out of visible text/history, and a sticker-only celebration records its readable fallback. Actual incoming-handler/asset-loader checks deliver quoted native bytes for celebration, thinking, hug, and goodnight. Existing cooldown, refusal, code-literal, addressing, deduplication, attachment, and upload-failure cases remain covered. |
| Artwork | All 24 distinct files decode as transparent 512 × 512 WebP, from 18,108 to 24,266 bytes. The six original files are byte-identical to the preceding revision. The full contact sheet was visually inspected. The offline font-free builder uses the shared allowlist; no new dependency or runtime image converter is needed. |
| Dashboard | Browser checks passed at 1440px and 360px for login, settings persistence, provider test, QR/status, keyboard dialogs, and WCAG AA audits. The help text describes the expanded choices and existing two-minute pause. |
| Independent review | No critical, important, or minor findings. The reviewer verified immutable unique catalogs, matching asset filenames, fixed-ID parsing, original-asset preservation, and compatibility with the existing delivery path. |
| Complete source package | The 114-entry ZIP excludes runtime secrets/storage and includes every asset and the shared catalog. Fresh `npm ci --omit=dev --ignore-scripts` and 240 packaged AI/persona/sticker/document/settings tests passed. Its owned CLI served health, login, and authenticated settings on the exported allocated port. Overlay/startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings, custom instructions, and pairing-marker bytes. |

These checks use synthetic messages, local provider/socket boundaries, and an isolated unpaired fixture process. No live WhatsApp sticker was sent or remote Pterodactyl process restarted. The configured model determines natural phrasing, repetition, and which optional sticker it selects. Manual customization retains fixed filenames and requires a restart to refresh cached bytes; keep custom artwork separately when updating the source pack.

## Feminine persona and native reaction stickers — 2026-10-11

The default feminine style is an additional runtime instruction, so existing document instructions and encrypted provider keys remain saved. Operators can choose Custom prompt only, occasional contextual stickers, request-only stickers, or Off in Bot behavior. Optional model controls select one fixed local WebP asset; the application removes the command suffix from text and ordinary memory. This does not add another model request.

| Check | Result |
| --- | --- |
| RED/GREEN evidence | Existing code failed the new settings, native-media, cooldown and dashboard-control tests before implementation. Review regressions reproduced leaked blank-separated controls, indented/nested code loss, sticker refusals and informational questions being classified as requests. The sad-only upload-failure test returned a happy fallback before correction. All targeted tests now pass. |
| Full suite and syntax | `npm test`: 294 passed, zero failures, cancellations or skips. `npm run check`: all 50 JavaScript files passed. `git diff --check` passed. |
| Real integrated AI path | A controlled local HTTP provider was used with the actual AI service, official client, memory, incoming handler and shipped assets. One completion produced clean emoji/kaomoji text plus quoted native WebP bytes; duplicate upsert dispatch was suppressed. No sticker command appeared in sent text or assistant history. |
| Delivery controls | Per-chat pause, other-chat independence, direct-request bypass, Off/request-only modes, group addressing, deduplication, attachment suppression and inactive-socket checks passed. Unknown IDs cannot become paths or URLs. A failed sticker upload does not add a generic error after successful text. |
| Persona/settings migration | Legacy encrypted settings gain defaults without replacing their custom prompt, key or trigger, or rewriting the old file. Explicit modes persist through masked-key saves; invalid modes leave active settings intact. |
| Asset validation | All six distinct assets decode as transparent 512 × 512 WebP, with actual sizes from 19,348 to 22,950 bytes. Original artwork uses no external fonts; no runtime converter or sticker service is added. The contact sheet was inspected locally. |
| Dashboard | Integrated browser checks passed at 1440px and 360px, including persona/sticker save and reload, masked-key preservation, provider test, existing session/QR controls and keyboard dialogs. Zero detected axe WCAG AA violations, browser errors or horizontal overflow. |
| Independent review | No open critical or important findings after parser, context/request classification and shared fallback corrections. Documentation explicitly qualifies recognized serious-context filtering. |
| Complete source package | A 95-entry ZIP includes all six WebP assets and the new helper, sender, builder and tests, with no runtime secrets or storage. Fresh `npm ci --omit=dev --ignore-scripts` and 235 packaged AI/persona/sticker/document/settings tests passed. The exported CLI served health, login and authenticated settings on its allocated port, loaded legacy persona/sticker defaults and retained the existing custom prompt. Overlay and startup preserved synthetic environment files, encrypted settings and pairing-marker bytes. Only the owned fixture process was started and stopped. |

These checks use synthetic messages and controlled provider/socket boundaries. No live WhatsApp sticker was sent and no remote Pterodactyl process was accessed or restarted. Voice and sticker choice depend on the configured model following instructions. Contextual eligibility recognizes common casual/serious cues; use Only when requested or Off for stricter control. Existing attachment and PDF regression coverage remains included.

## PDF deadline follows dashboard Timeout — 2026-10-11

The repeated PDF timeout reports show the same fixed worker deadline as the preceding incident; the actual Pterodactyl source revision, resources and PDF are still unconfirmed. Local code inspection found that increasing the dashboard's AI Timeout could not extend the fixed 25-second PDF deadline. The latest operator logs separately show two successful replies, then four AI requests returning HTTP 503, including three transient retries.

PDF preparation now receives 75% of a positive finite configured AI Timeout, defaulting to 45 seconds for a 60-second overall operation and capped at 120 seconds. The shared AI abort signal still bounds preparation plus provider work. Other Office files keep the 15-second deadline, and PDF page count, image bytes, canvas dimensions, heap and two-worker limits retain their previous bounds. Use at least 180 seconds for slow servers to permit the full PDF cap; higher existing values need not be reduced.

Worker progress uses a separate message type. The parent retains only allowlisted phases, bounded integer page counts and a fixed reader version, then logs one safe completion/failure event. A progress message cannot resolve or reject the attachment. Termination remains awaited before a slot is released, and logging exceptions do not change the operation's outcome.

| Check | Result |
| --- | --- |
| Regression before fix | Advancing the parent's virtual clock past 25 seconds while a real eight-page worker was still reading reproduced `AttachmentUserFacingError: The PDF took too long to process.`; the targeted run had zero passes and one failure. The configured-budget test now completes with all eight pages retained. |
| Controlled end-to-end PDF | The real AI service prepared a synthetic eight-page, 4,479,391-byte scan in 28.31 seconds under concurrent test load. A local controlled provider received all eight page images and numbered labels in one request; total time was 28.49 seconds. This exceeds the old 25-second limit and succeeds with a 120-second PDF budget. |
| Safe integration log | The completion event reported `pdf-256-budget-v1`, `pdf_complete`, eight completed pages and the allowed/elapsed time. The synthetic filename, key, document text and image data were absent. |
| Deadline and lifecycle tests | Real workers survive the old 25-second virtual cutoff, complete all eight pages, enforce short/default/capped budgets, accept nonterminal progress and release both slots after cancellation. Logger exceptions and private cancellation reasons do not affect results or expose private data. |
| Full suite and syntax | `npm test`: 260 passed, zero failures, cancellations or skips. `npm run check`: all 45 JavaScript files passed. `git diff --check` passed. |
| Independent review | No issues found in budget/default/cap behavior, termination and slot release, progress protocol, safe metadata, AI logger integration or the tests and documentation. Remote completion and provider availability were explicitly outside the evidence available to this review. |
| Complete source package | The complete 81-entry ZIP passed a fresh `npm ci --omit=dev --ignore-scripts`, 187 packaged attachment/document/AI tests and exported CLI health/login/authenticated-settings checks on its allocated port. Overlay and startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings and pairing-marker bytes. Only the owned, isolated fixture process was started and stopped. |

No live provider requests or production-bot restarts were performed. Checks use synthetic documents and controlled local endpoints on Windows; they do not verify the operator's private PDF, remote Linux runtime or the reason its AI endpoint returned HTTP 503.

## Scanned PDF processing deadline — 2026-10-11

The reported error came from the local PDF worker, after media download and before a provider request. A representative eight-page, 4,479,391-byte A4 scan reproduced `The PDF took too long to process.` against the unchanged 25-second worker deadline. A separate eight-page, 2.55 MB scan completed in 50.2 seconds with the deadline temporarily extended only in the ignored profiling helper: OfficeParser took 0.15 seconds and rendering dominated the remainder.

The isolated renderer benchmark localized the cost to PDF.js's RGB-to-RGBA conversion in 16-row chunks, rather than JPEG decoding, native pixel painting, filesystem assets or worker heap size. Increasing the chunk to 256 rows reduced a real page render from 4.18 to 0.48 seconds, with byte-identical JPEG output. The temporary chunk buffer remains bounded to 8 MiB at the permitted 8192-pixel internal width.

The application loads a derived copy of pinned PDF.js 6.2.108 containing that adjustment and a modification notice, retaining the original license. Version, original source hash, patch marker and cached module hash are checked before import. Unique temporary files and atomic rename handle concurrent readers. The sibling location preserves worker imports and asset paths, and the original dependency source is untouched. Installation scripts can remain disabled.

| Check | Result |
| --- | --- |
| Regression before fix | The real eight-page scan preparation failed with the same PDF timeout; no pages were sampled or skipped. |
| Real preparation after fix | Two sequential reads completed in 10.63 and 10.01 seconds; both produced eight distinct 1487×2105 JPEGs totaling 2,102,263 bytes with identical output hashes. |
| Page fidelity | All eight page labels, output resolution bounds and ink in the last row's numeric area passed. The isolated chunk-size comparison preserved exact JPEG bytes. |
| Runtime safeguards | Five real loader tests passed: independent concurrent loaders, untouched original source, cache reuse, corrupted cache rejection, unsupported version, altered source and ambiguous marker rejection. |
| Full suite and syntax | `npm test`: 254 passed, zero failures, cancellations or skips. `npm run check`: all 45 JavaScript files passed. `git diff --check` passed. |
| Independent review | Cleared integrity-before-import, Windows paths, atomic creation/cleanup, relative worker/assets, fidelity tests and preserved safety bounds. |
| Complete source package | The complete 81-entry ZIP passed a fresh `npm ci --omit=dev --ignore-scripts`, 181 packaged attachment/document/AI tests and exported CLI health, login and authenticated-settings checks on its allocated port. Overlay and startup preserved synthetic `secrets.env`, legacy `.env`, encrypted settings and pairing-marker bytes. Only the owned, isolated fixture process was started and stopped. |

PDF limits remain 25 seconds per worker, 128 MiB old-generation heap, two concurrent readers, 20 visual pages and 8 MiB total JPEG data. Final images remain capped at 2400 pixels per edge and four million pixels; internal canvases retain the 8192-edge/16-million-pixel bounds. Preparation still shares the configured total AI deadline. DOC and DOCX parsing and native PDF transports are unchanged and passed the suite.

Checks ran on Windows Node 24.20.0 with synthetic documents. The operator's actual PDF and remote Pterodactyl/Linux runtime were not accessed. No provider calls or production-bot restarts were performed for this performance fix. Abrupt termination during derived-module creation was not fault-injected; normal cleanup paths and subsequent integrity checks were reviewed.

## WhatsApp file download recovery — 2026-10-11

The operator's exact reply was “could not be downloaded”, which comes from media retrieval before any document reader or AI request. A real Baileys client against controlled HTTPS dispatch responses reproduced that error on expired HTTP 404/410 media. The pinned client throws Boom errors with `output.statusCode`, but its built-in refresh checks `error.status`: [download/retry source](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Utils/messages.ts), [HTTP error source](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Utils/messages-media.ts).

The service now refreshes a trusted expired reference at most once and retries within the same deadline. Both manual and dependency-triggered refresh callbacks refuse to continue after timeout. The file size, trusted-host, MIME/content validation and stream bounds still apply. HTTP 403 and network/decryption failures produce safe diagnostics and a resend instruction.

| Check | Result |
| --- | --- |
| Real download regression | Encrypted synthetic PDF with real Baileys and controlled HTTPS 404/410 responses failed before the fallback; both now decrypt to the original bytes after one refresh. |
| Focused media/handler tests | 65 passed, zero failures. Includes bounded refreshes, late callbacks, download/stream limits, trusted references, group/private triggers and log privacy. |
| Full suite and syntax | `npm test` on Node 24.20.0: 248 passed, zero failures, cancellations or skips. `npm run check`: all 43 JavaScript files passed. `git diff --check` passed. |
| Late dependency callback | Reproduced one post-timeout retry before the fix; after the guard, releasing the pending refresh causes zero downstream retries. |
| Safe diagnostics | Controlled HTTP 403/410, DNS `EAI_AGAIN` and bad decryption report status/code and stage. Raw URLs/tokens, errors, filenames, contents and chat identifiers are absent. |
| Current live provider | Synthetic scanned PDF, merged DOCX and legacy DOC were recognized through the last-known HTTPS 9Router endpoint. The prior run's HTTP 503 Word limitation did not recur in these checks. |
| Production AI service | Scanned PDF and merged DOCX were recognized with the existing local settings, changing only the endpoint in memory to the last-known HTTPS address. The local saved endpoint differs from that address; these checks do not establish the remote server's configuration. Saved settings stayed byte-for-byte unchanged. |
| Independent integration review | Prior late-callback blocker was reproduced, corrected and cleared; no remaining download-bound, refresh-reference or log-privacy findings. |
| Complete source package | The complete 79-entry ZIP passed a fresh production install, 175 packaged media/handler/document/AI tests and CLI health/login/authenticated-settings checks on its allocated port. Synthetic environment files, encrypted settings and pairing marker stayed byte-for-byte unchanged. |

The first package CLI check did not reach health readiness. A subsequent startup check in that same extracted project succeeded, and a fresh installation of the unchanged ZIP passed all package checks. The first failure's underlying cause was not captured; startup code was not changed. Only owned, isolated fixture processes were started and stopped.

The operator's documents and remote Pterodactyl container were not accessed, so the actual remote download's HTTP/network code remains unknown. New `media_download_failed` logs provide that distinction. Reader code is unchanged in this update. Large scanned PDFs can still reach the existing 25-second parsing limit even when their dimensions are allowed; split such documents before resending.

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
