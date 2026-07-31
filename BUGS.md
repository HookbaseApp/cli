# CLI Bug Audit — 2026-07-29

A full audit of `@hookbase/cli` against the live API source (`api/src/routes/*`).
Findings are grouped by theme and ranked by severity. Each entry lists the
`file:line`, the failure, and the fix that was applied. The **commander
`--json`/`optsWithGlobals` shadowing** quirk is excluded (already known/handled).

Legend: **HIGH** = command is broken/crashes · **MED** = wrong or missing output · **LOW** = cosmetic/edge.

---

## A. CLI ↔ API contract drift (outbound & endpoints)

The whole cluster was written against field names, routes, and units the API
does not use. These commands were evidently never exercised end-to-end against
the live API. All verified directly against `api/src/routes/outbound-messages.ts`
and `webhook-endpoints.ts`.

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| A1 | HIGH | `lib/api.ts:1460` | `retryWebhookMessage` POSTs `/outbound-messages/:id/retry`; the API only has `/:id/replay` and `/dlq/:id/retry` → **404 every time**. | POST `/:id/replay`. |
| A2 | HIGH | `lib/api.ts` `updateWebhookEndpoint` | Sends `isActive`; API update schema only accepts `isDisabled` → `--active/--inactive` silently no-ops. | Map `isActive` → `isDisabled: !isActive`. |
| A3 | MED | `lib/api.ts:1533` | `deleteDlqMessage` DELETEs `/outbound-messages/:id`; only `/dlq/:id` exists → **404**. | DELETE `/outbound-messages/dlq/:id`. |
| A4 | MED | `lib/api.ts` + `commands/endpoints.ts` | Sends `rateLimitPerMinute`; API field is `rateLimitPerSecond` (different name **and** unit) → `--rate-limit` ignored. | Switch CLI to native `rateLimitPerSecond` (flag re-documented as req/sec; it never worked before so no behavior is lost). |
| A5 | MED | `lib/api.ts` + `commands/endpoints.ts` | Sends `timeoutMs`; API field is `timeoutSeconds` (1–120) → `--timeout` ignored; detail view always prints `30000ms`. | Switch CLI to native `timeoutSeconds`; detail view reads `timeoutSeconds`. |
| A6 | LOW | `commands/endpoints.ts` | `--event-types` sent as `eventTypes`, which the endpoint schema does not have (event types are managed via subscriptions). Success/detail boxes then print a fabricated `Event Types: *`. | Stop sending the field; warn that it's ignored; drop the fake display line. |
| A7 | MED | `commands/send.ts:139` | Reads `message.id/eventType/status`; `POST /send-event` returns `{ eventId, messagesQueued, endpoints }`. Success box was all `undefined` and told you to run `messages get undefined`. | Render the real `{ eventId, messagesQueued, endpoints }` shape. |
| A8 | MED | `commands/outbound.ts:141,144` | `messages get` reads `responseStatus`/`errorMessage`; API returns `lastResponseStatus`/`lastErrorMessage` → the failure reason (the point of the command) never showed. | Read the `last*` fields. |
| A9 | MED | `commands/outbound.ts:92,138` | Attempts read `attempt_count`/`attemptCount`; API field is `attempts` → always displayed `0`. | Add `?? m.attempts`. |
| A10 | MED | `lib/api.ts` `getDlqMessages` + `commands/outbound.ts:257` | DLQ list read `reason`; the generic list endpoint doesn't return it. | Point `getDlqMessages` at the purpose-built `/dlq/messages` endpoint and read `dlqReason`. |

> **Note:** the API mounts both `/api/organizations/:orgId/…` and bare `/api/…`
> variants (`api/src/index.ts:276-301`), so the CLI's prefix-less paths resolve
> fine — the failures above are route/field mismatches, not the missing prefix.

---

## B. Interactive dashboard (TUI)

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| B1 | HIGH | `tui/App.tsx:454` | `REFRESH_COOLDOWN_MS = 30000` (comment says "2 second"). The throttle wrapped **all** non-initial fetches, including the targeted refresh fired after a mutation → create/delete/toggle looked like it failed for up to 30s. | Exempt targeted (string) refreshes from the throttle; drop the full-refresh window to 2000ms to match intent. Same 30000→2000 in `Dashboard.tsx`, `Analytics.tsx`, `Outbound.tsx`. |
| B2 | MED | `tui/views/Outbound.tsx:734-737` | `y`-to-retry indexes `messages[selectedIndex]` guarded only by `length > 0`; a stale index after a list shrink → `undefined.id` TypeError tears down Ink. | Guard on `messages[selectedIndex]` existence. |
| B3 | LOW | `tui/views/Events.tsx:26` | Same stale-index pattern on `Enter`. | Guard on `events[selectedIndex]`. |
| B4 | MED | `tui/TunnelMonitor.tsx:159-215` | `client` is assigned only after two `await`s; quitting during connect runs cleanup with `client === null`, so the socket + ping + reconnect timers leak and hang the CLI. | Add a `cancelled` flag; bail/close after each await and in cleanup. |
| B5 | MED | `tui/views/Outbound.tsx:1066` | Endpoints list colors on `ep.is_active` only; API sends `isDisabled` → every endpoint shows red "Off". | Use `is_active ?? isActive ?? !isDisabled` (matches the detail view's helper). |
| B6 | LOW | `tui/views/ApiKeys.tsx:354` | Create success sets `step='done'` but never calls `onCreated()` → new key doesn't appear until manual refresh. | Call `onCreated()` on success. |
| B7 | LOW | `tui/views/Outbound.tsx:1096,1151` | Messages/DLQ render `.slice(0,15)` but selection can move to row 16+ (invisible cursor, retries an off-screen row). | Window the rendered slice around `selectedIndex`. |

---

## C. API client robustness

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| C1 | MED | `lib/api.ts:36,88` | `await response.json()` runs unconditionally before the `!ok` check. A non-JSON body (Cloudflare 502/504 HTML, empty 204) throws → reported as a JSON-parse error with `status:0`, hiding the real HTTP status. | Read text first, parse defensively, fall back to `HTTP <status>` messaging. |
| C2 | LOW (doc only) | `lib/api.ts:199,372,515` | Sources/destinations/routes request `?pageSize=100` and don't paginate beyond 100. `getTunnels`/`getCronJobs` send `?pageSize=100` but those endpoints ignore the param and return all rows (≤1000). | Left as-is: 100 is the server's max page size; the tunnel/cron "wrong param" is harmless. Documented as a known >100 limitation. |

---

## D. Tunnel / forward

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| D1 | MED | `commands/tunnels.ts:386` + `lib/tunnel.ts:240` | `--filter-skip-status` is `parseInt`'d with no validation. A bad value → `NaN`; `NaN ?? 204` stays `NaN` (`??` doesn't catch `NaN`) → relay builds `Response(status:NaN)` → **504 on every filtered webhook** → provider retry storm. | Validate at parse (warn + default 204 on invalid); clamp to 100–599 in `tunnel.ts`. |
| D2 | MED | `commands/tunnels.ts` start & proxy | On WS connect failure the command `process.exit(1)`s before the shutdown handler is registered → the just-created tunnel is orphaned toward the plan limit. | Delete the tunnel in the connect-failure path. |
| D3 | LOW | `lib/tunnel.ts:290` | Local responses are force-decoded `toString('utf8')` and the original `content-encoding`/`content-length` are forwarded → gzip/binary bodies are corrupted and mislabeled. | Strip `content-encoding`/`content-length`/`transfer-encoding` after buffering. (True binary passthrough would need relay-side changes — documented.) |
| D4 | LOW | `lib/tunnel.ts:248` | Webhook-controlled text lands unescaped in `x-hookbase-skip-reason`; a `\n` → invalid header → relay 504 instead of the intended skip status. | Strip CR/LF/control chars from the reason before it becomes a header. |

---

## E. Cron & trigger

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| E1 | MED | `commands/cron.ts:1080,1098,1100` | `cron status` "next hour" uses raw `new Date()` on the API's `Z`-less UTC timestamps (the file already has `parseUTCDate` for this) → wrong upcoming jobs and countdowns for non-UTC users. | Use `parseUTCDate`. |
| E2 | LOW | `commands/cron.ts:383,546` | `--timeout` has no commander parser, so it arrives as a **string** and is sent raw as `timeoutMs`. (Postgres coerces numeric text, so it usually works — hence the earlier split verdict — but it's type-unsafe.) | `parseInt` before sending. |
| E3 | LOW | `commands/trigger.ts:159` | `--print` runs after source resolution, so it still requires/prompts for a source and auth even though it sends nothing → blocks in CI. | Short-circuit `--print` (needs only `--provider`+`--event`) before source resolution. |

---

## F. Inbound display

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| F1 | MED | `commands/deliveries.ts:23` | `formatStatus` handles `success/failed/pending/retrying` but the delivery enum is `delivered/failed/failed_over/schema_failed/retrying` → successful deliveries render gray. | Add `delivered` (green), `failed_over` (yellow), `schema_failed` (red). |
| F2 | LOW | `commands/destinations.ts:58` | `d.url.length > 40` is unguarded; a null/absent URL (warehouse destinations) throws and crashes the whole list. | Guard with `(d.url || '')`. |

---

## Rejected during verification (considered, not bugs)

`api-keys create` scopes-not-array crash · `cron-groups --order` as string ·
event-detail payload-size snake-only read · Dashboard active-destinations
snake-only read · global `-y/--yes` "shadowing" (subcommands redeclare it, so it
works) · cron/tunnels `pageSize` truncation (endpoints ignore the param and
return all rows).
