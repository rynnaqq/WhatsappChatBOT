# WhatsApp QR bot on Vercel Hobby

Date: 2026-10-09

Status: Not selected. The operator chose their Pterodactyl server on 2026-10-09. This proposal was not approved or implemented.

## Outcome and constraints

The operator wants the dashboard and bot hosted entirely on Vercel, wants to retain the existing WhatsApp QR pairing flow, and wants free Vercel hosting. The existing single-account bot, AI settings, message filters, text/image replies, and encrypted settings remain the product being deployed.

Those hosting constraints require limited running sessions. This proposal does **not** meet the original PRD's continuous-operation goal. The bot runs for up to 40 minutes after an explicit start, then goes offline. Pairing files and settings survive; the operator starts another session when needed. Monthly Vercel quotas can prevent further sessions. Approval of this design would accept that change in availability.

Vercel Hobby permits Sandbox sessions of at most 45 minutes and includes 5 active CPU-hours and 420 GB-hours of provisioned memory per month. The smallest allocation is 1 vCPU with 2 GB of RAM: continuous operation for 30 days would require 1,440 GB-hours, exceeding the memory allowance alone. These allowances are shared with other usage; 210 hours is a theoretical memory-only ceiling, not a promised monthly runtime. [Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing)

Free hosting does not change any charges from the operator's chosen AI provider. This design does not upgrade the Vercel account or enable paid usage.

## Approaches considered

| Approach | QR pairing | Entirely on Vercel | Free hosting | Availability |
| --- | --- | --- | --- | --- |
| **Proposed: Hobby Function gateway and timed Sandbox worker** | Existing flow | Yes | Within Hobby allowances | Explicit, limited sessions |
| Pro Sandbox with a durable supervisor | Existing flow | Yes | No; rejected by the operator | Periodic reconnection and usage billing |
| Existing bot on Pterodactyl, dashboard on Vercel | Existing flow | No | Depends on the existing server | Can provide continuous operation |

Ordinary Vercel Functions alone cannot preserve the bot's outgoing WhatsApp connection after their invocation ends. Adding an Express import would fix entrypoint detection but would leave this runtime problem. Functions execute the gateway; Sandbox executes the bot. [Vercel Functions](https://vercel.com/docs/functions), [Sandbox persistence](https://vercel.com/docs/sandbox/concepts/persistence)

## Components

### Function gateway

A dedicated Express entrypoint serves the login page, protected dashboard, and existing API paths. It imports Express directly and exports the application in a form supported by Vercel. JavaScript and CSS assets are published from the root `public` directory; dashboard HTML and runtime data are not published there. The normal `npm start` command continues to run the existing application on a conventional server. [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

The gateway proxies authenticated requests to one named Sandbox. It never opens a Baileys connection itself. Requests for pages, assets, health, or status must not start or resume a stopped Sandbox. Only successful operator login or an authenticated, explicit Start action can begin a session. Repeated login while a session is running reuses that session and does not extend its deadline.

The gateway checks the dashboard password before provisioning compute. A private Vercel Blob record holds bounded failed-login counters and a four-minute lease for start/stop/deployment transitions. Transitions have a three-minute operation deadline and recheck lease ownership before each lifecycle change. Reads that decide these transitions bypass Blob caching; conditional writes use ETags to reject conflicting updates. These records are used for mutations, not every status poll. Blob failure or an exhausted quota blocks provisioning and login rather than allowing an unchecked transition. [Private Blob storage](https://vercel.com/docs/vercel-blob/private-storage), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)

Blob's free allowances also apply. Creating a private store and connecting its token to this Vercel project are setup requirements. The gateway does not upload WhatsApp credentials, messages, QR codes, or API keys to that control record. [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)

### Sandbox worker

One named Sandbox runs the existing Node application as a detached process. It uses 1 vCPU, a 40-minute session timeout, one application port, and a Node 24 image verified during implementation. Source is pinned to the deployed Git commit. Production and Preview use different resource names and never share a WhatsApp pairing directory. Preview does not start a bot by default.

Startup waits for the worker's protected health check. Installing dependencies or reconnecting consumes part of the session's time. Worker readiness cannot be reported merely because a detached command was launched. The SDK's reported expiration is the authority for the displayed deadline. The gateway never extends the timeout automatically.

Named Sandbox lookup is passive until an explicit start requests resume. Because running-session SDK calls can auto-resume a stopped Sandbox, passive status reads must use metadata and avoid executing commands against a stopped worker. An integration test must verify that status polling and port access cannot accidentally resume it. [Sandbox SDK reference](https://vercel.com/docs/sandbox/sdk-reference)

The worker's exposed port requires a server-only gateway credential before handling application routes. This credential is derived from `SESSION_SECRET` with a separate purpose label; it is never sent to the browser. Direct requests to the Sandbox domain cannot access QR codes, settings, login, or control actions.

### Persistent Drive

A stable Vercel Drive in `iad1` is mounted at `/data`; `STORAGE_DIR=/data` keeps the existing `auth_info` directory and encrypted `settings.json` on it. The Drive survives stopped or replaced Sandboxes and is independent of source snapshots. Its maximum size is 1 GiB, matching the Hobby allocation. Drives are currently Public Beta and must be available in the operator's account. [Vercel Drives](https://vercel.com/docs/sandbox/concepts/drives)

Only one worker may mount the Drive read-write. A start or deployment transition acquires the control lease, confirms that any previous worker is stopped, and then mounts the Drive. Concurrent transitions that cannot prove exclusive ownership fail safely. No controller action deletes `auth_info`; the existing explicit WhatsApp Log Out and remote logout handling remain responsible for clearing invalid pairing files.

## Operator flow

1. Open the Vercel login page. Explain that login starts a limited bot session and show the 40-minute limit.
2. Submit the password. Apply the existing five-failure, 15-minute lockout using the gateway's shared counters. A correct password permits a start, subject to the lease and available Vercel quotas.
3. Start or reuse the single worker, wait for readiness, and forward login to its existing authentication module. Return its signed, HttpOnly, Secure, SameSite=Strict cookie.
4. Show the existing dashboard, QR pairing, provider settings, and connection controls. Also show the runtime deadline and an explicit Stop bot action.
5. Stop closes the worker normally, flushes outstanding credential/settings writes, and stops the Sandbox without logging out of WhatsApp. The Vercel timeout is the final limit if graceful shutdown cannot complete.
6. After expiration or stop, show that the bot is offline. Passive requests do not renew it. Signing in again explicitly starts another limited session using saved pairing files.

Closing the dashboard does not immediately stop the worker; it continues until Stop or the session deadline. Dashboard logout revokes its login cookie and does not implicitly erase WhatsApp pairing. A worker restart invalidates its in-memory dashboard sessions, as a restart already does in the existing application, so the operator signs in again.

When offline, the bot does not answer incoming messages. On the next start, the existing message age filter remains active; reconnecting must not answer an accumulated backlog or promise delivery for messages received while stopped. Conversation memory resets on process restart, consistent with the PRD.

## Status and security

Vercel mode uses authenticated HTTP status polling every two seconds while the dashboard is visible. `GET /api/status` already returns the QR data URL and expiry. Expired QR codes are removed immediately, polling never starts compute, and hidden tabs reduce polling. Conventional server mode retains the existing WebSocket channel.

This is an explicit Vercel-mode amendment to the PRD's WebSocket-only updates and one-second status target. It avoids depending on unverified WebSocket forwarding through Sandbox's exposed port. QR pairing and automatic QR refresh remain visible in the same card.

The gateway preserves cookies, upstream validation errors, and safe response headers. It replaces client-supplied forwarding/control headers with trusted values. Sandbox routing uses the Sandbox's actual network hostname; after checking the gateway credential, worker middleware normalizes the public host, HTTPS scheme, and client IP for the existing same-origin and authentication checks. This must preserve secure cookie issuance and reject foreign-origin mutations.

Password and secret validation stay unchanged: at least 12 characters for `DASHBOARD_PASSWORD` and at least 32 for `SESSION_SECRET`. The existing stable secret must be retained when moving encrypted settings. Credentials and tokens stay in Vercel environment configuration, excluded from Git and public archives. Logs redact cookies, gateway headers, QR contents, and provider secrets.

Sandbox creation uses Vercel's production OIDC authentication rather than requiring a personal access token in the browser or repository. Actual project authorization is a deployment check, not assumed from a local mock. [Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication)

## Failure behavior

Unavailable Sandbox/Drive access, exhausted free quotas, failed installation, invalid configuration, or a worker that does not become ready produce a clear setup or offline message. Failed startup stops any worker it created so it does not keep consuming the session's compute allowance. The dashboard must not label an unavailable worker Connected. Login failures and controller errors return sanitized responses.

An expired transition lease does not authorize a second live worker. Recovery checks the named Sandbox and Drive attachment, confirms the previous worker is stopped, and then retries. SDK errors containing resource details or secrets are not forwarded to the browser. A deployment updates the worker at an explicit start; it does not erase the Drive or keep creating workers in the background.

There is no Cron loop, Workflow supervisor, or automatic replacement chain in this Hobby design. Such automation would consume the same finite free quota and would not establish free continuous operation.

## Acceptance and verification

- Vercel's build recognizes the gateway entrypoint; public assets and protected HTML load correctly.
- All existing bot, settings, AI, authentication, and conventional-server checks remain applicable and pass.
- Anonymous page requests, invalid login, dashboard polling, and expired cookies do not create or resume a worker.
- Repeated/concurrent starts produce one active worker and preserve one read-write Drive owner.
- Stop and timeout retain pairing and encrypted settings; explicit WhatsApp logout clears only the intended pairing state.
- Cookies, logout revocation, lockout, same-origin checks, gateway-header validation, and QR expiry work through the proxy.
- Two separate Function instances route to the same worker; they do not rely on shared in-memory sessions.
- The dashboard displays the deadline and offline state, requires explicit restart, and never implies continuous operation.
- A real Hobby deployment verifies OIDC access, Drive availability, detached-process readiness, passive lookups, timeout/stop, restart with saved pairing, and an actual phone QR scan. Unit tests and local substitutes do not establish those platform behaviors.

Retained as an unimplemented alternative. The active deployment uses the existing continuously running Node application on the operator's Pterodactyl server; no Vercel conversion or Vercel resource creation is planned.
