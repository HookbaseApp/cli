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
| C2 | ~~LOW~~ MED | `lib/api.ts:199,372,515` | Sources/destinations/routes request `?pageSize=100` and don't paginate beyond 100. `getTunnels`/`getCronJobs` send `?pageSize=100` but those endpoints ignore the param and return all rows (≤1000). | Originally left as-is ("known >100 limitation"). **Superseded by H1 (2026-11-12):** the first-page-only lists fed id/slug/name resolution, so it was a live lookup bug. The tunnel/cron note still stands. |

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

## G. Outbound contract re-audit — 2026-10-17

Checked against `api/` branch `feat/outbound-dual-sign` (`send-event.ts`, `outbound-messages.ts`,
`webhook-endpoints.ts`, `webhook-applications.ts`) and the opaque keyset cursors on
`fix/outbound-keyset-cursors`. Tests: `lib/api.outbound.test.ts`, `commands/outbound.test.ts`.

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| G1 | HIGH | `lib/api.ts` `sendWebhookEvent` | `send --endpoints` sent only `endpointIds`, which deployed APIs strip, so the event went to **every** subscribed endpoint. | Send `endpointIds`, plus `endpointId` when exactly one id is given (honoured by every deployment). |
| G2 | MED | `lib/api.ts` + `commands/send.ts` | No idempotency key at all, so re-running `send` duplicated events. | New `-k/--idempotency-key`: sent as body `idempotencyKey` and `Idempotency-Key` header (`request()`/`sessionRequest()` take extra headers). |
| G3 | MED | `lib/api.ts` lists + `commands/{outbound,endpoints,applications}.ts` | No list got past page one: messages/DLQ sent an `offset` the API ignores, `--limit` >100 was silently capped, apps/endpoints showed only 50, `--json` printed `total: undefined`. | `collectPages()` follows the opaque `nextCursor` (never parsed). Apps/endpoints lists and pickers fetch all pages; messages/DLQ `--limit` spans pages; new `--cursor`; `--json` gives `{ messages, hasMore, nextCursor }`. |
| G4 | MED | `commands/endpoints.ts` test + `tui/views/Outbound.tsx` | `endpoints test` read `statusCode`/`duration`/`error`; the API nests `delivery.{responseStatus,responseTimeMs,errorMessage}`, so the output showed `undefined` and `0ms` and never said why a test failed. | Read the `delivery` fields (command and both TUI paths). |
| G5 | LOW-MED | `lib/api.ts` DLQ retry | Single retry used `/:id/replay`, which skips the DLQ retry counter; bulk retry replayed one id at a time ("no bulk endpoint exists" was wrong); the picker printed `(undefined)`. | `POST /dlq/:id/retry`; `POST /dlq/retry-bulk` in chunks of 100 returning `{ queued, skipped, messages }`; the label uses `dlqReason`. |
| G6 | LOW | `commands/endpoints.ts` rotate-secret | No way to set `gracePeriodSeconds`; the response was typed as `{ endpoint, secret }`; the prompt claimed the old secret "stops working immediately" (server default grace is 3600s). | New `-g/--grace-period`; typed `{ secret, previousSecretExpiresAt, secretVersion }`; the prompt and output show the grace window. |
| G7 | LOW | `commands/endpoints.ts` + TUI | Success Rate always `-` and Messages always 0, because `success_rate`/`message_count` are not API fields. | `endpointSuccessRate()` from `totalSuccesses / totalMessages`; Messages reads `totalMessages`. `WebhookEndpoint` is now the camelCase `formatEndpoint()` shape. |
| G8 | LOW | `commands/groups/outbound.ts` | `--status` help listed `delivered` (the API value is `success`). | Help is generated from `OUTBOUND_MESSAGE_STATUSES` (all 7 statuses); the status type stays open-ended. |
| G9 | MED | `tui/views/Outbound.tsx` | The A8/A9/A10 fixes never reached the TUI detail panes: they read `response_status`, `error_message`, `delivered_at`, `attempt_count`, `reason` and `original_message_id`, so errors, reason and attempts never showed. The endpoint pane still had a fake "Event Types" row (A6). | Read `lastResponseStatus`, `lastErrorMessage`, `completedAt`, `attempts`, `dlqReason` and `dlqMovedAt`; drop the fake rows. `WebhookMessage`/`DlqMessage` types now match the API. |

Still missing (not built, out of scope): subscriptions CRUD, event types, export, DLQ bulk delete
(`DELETE /dlq/bulk`), send `labels`/`priority`/`metadata`, endpoint `test` `eventType`/`payload`,
and endpoint retry/circuit/status-code fields. When those commands are added,
`ORG_SCOPED_PATH_PREFIXES` will also need their prefixes.

---

## H. SDK round — 2026-11-12

Checked against `api/` origin/main as of 2026-11-12 (`sources.ts`, `destinations.ts`, `routes.ts`,
`transforms.ts`, `filters.ts`, `deliveries.ts`, `events.ts`, `outbound-messages.ts`,
`webhook-endpoints.ts`, `send-event.ts`), with `mcp-server` 2.16.0 as a reference.

| # | Sev | File | Problem | Fix |
|---|-----|------|---------|-----|
| H1 | HIGH | `lib/api.ts` `getSources`/`getDestinations`/`getRoutes`/`getTransforms`/`getFilters` | Each read only page 1. Sources/destinations/routes asked for `pageSize=100`; transforms and filters sent no `pageSize`, so they got the server default of **20**. These lists feed id/slug/name resolution (`routes create --source/--destination/--transform/--filter/--failover`, `trigger`, `channels link`, the TUI), so anything past the first page was "not found", and `sources/destinations/routes/transforms/filters list` silently truncated. | `collectOffsetPages()` requests `?page=N&pageSize=100` until `pagination.total` is reached or a page comes back empty or short, bounded at 50 pages (5,000 rows). An error on any page is returned as-is. Test: `lib/api.paging.test.ts` (9 of its 10 tests fail on the old `api.ts`). |
| H2 | MED | `lib/api.ts` `replayDelivery` + `commands/deliveries.ts` replay | Typed the response as `{ delivery }`; `POST /deliveries/:id/replay` returns a flat `{ deliveryId, message, modified, destinationOverridden, transformOverridden, transformPersisted, headersOverridden, targetDestinationId }`. The new delivery id was never shown and `--json` printed `undefined`. | Typed `ReplayDeliveryResult`; the command prints the new id, target destination and what was overridden; `--json` prints the envelope. New `--patch`, `--payload`, `--destination`, `--header` (see release notes). Error codes get readable messages. Test: `commands/deliveries.test.ts`. |
| H3 | MED | `commands/deliveries.ts` bulk-replay | Read `replayed`/`failed`; the API returns `{ message, queued, skipped, results }`, so it always printed `Replayed: 0`. | Read `queued`/`skipped` and list each skipped id with its reason. |
| H4 | LOW | `commands/deliveries.ts` list/get, `commands/events.ts` | Time read `response_time_ms`/`responseTimeMs` and Completed read `completed_at`/`completedAt`; the API sends `latencyMs` and `deliveredAt`, so both were always blank. The list printed "of `total`", which the API does not return. `Delivery` was typed snake_case. | Read `latencyMs`/`deliveredAt`; drop the fake total; `Delivery` is the camelCase API row. |
| H5 | LOW | `commands/deliveries.ts`, `events.ts`, `lib/sseStream.ts`, `groups/inbound.ts` | Status colours and `--status` help predate `throttled` (0046), `awaiting_retry` (0132) and `held` (0134); `held` and `awaiting_retry` rendered grey. | `DELIVERY_STATUSES` drives the help; every status has a colour; `deliveries get` shows `holdExpiresAt` as "Held Until" (a held delivery has no `nextRetryAt`). |
| H6 | MED | `commands/destinations.ts` test + `tui/views/Destinations.tsx` | Read `statusCode`/`responseTime`/`duration`; the API returns `status`/`latencyMs`, so every test showed `Status Code: N/A` / `0ms`. A bridge test (a dry run) has neither. | Read `status`/`latencyMs` and show `responseBody`; a bridge dry run shows the resolved event type, whether it is enabled and how many endpoints are subscribed. New `--payload`. |
| H7 | LOW | `commands/destinations.ts` get + TUI | Every non-HTTP destination printed `Bucket`/`File Format`/`Partition`, so queue destinations showed `Bucket: -` and Azure Blob (which has `containerName`) did too. HTTP-only rows (URL, method, auth, static IP, timeout) printed for every type. | `describeDestinationConfig()` per type (warehouse, each queue type, bridge); HTTP-only rows only for HTTP. |
| H8 | LOW | `commands/destinations.ts` create | `create -n X --type s3 --config ...` still prompted for a URL (validated as a URL), so warehouse and queue destinations could not be created from a script. | Non-HTTP types skip the URL/method prompts and send no URL. |
| H9 | LOW | `commands/outbound.ts`, `tui/views/Outbound.tsx`, `groups/outbound.ts` | Outbound status colours and `messages list --status` help predate `awaiting_pull` (0115), `fifo_waiting` (0116) and `held` (0134); they rendered grey and were missing from the help. `stats` had no Held line, and its named counts never added up to Total on an org with polling or FIFO endpoints. | `OUTBOUND_MESSAGE_STATUSES` has all ten; every one has a colour; `messages get` shows `holdExpiresAt` and the bridge hop; `stats` shows Held, plus an Other line for the statuses the summary does not bucket. `send` shows `messagesHeld`. |
| H10 | LOW | `commands/routes.ts` list/get | The Deliveries column and `Deliveries:` line read `delivery_count`/`deliveryCount`, which `GET /routes` and `GET /routes/:id` never return, so they always said 0. | List shows the circuit state instead; get prints a delivery count only when one is sent, and shows the circuit, `holdOnCircuitOpen` and `heldCount`. |
| H11 | LOW | `api` (server) `sources.ts`, fixed in API #131 | `GET /sources/:id`, list and export returned `ipAllowlist`, `ipDenylist`, `encryptFields` and `maskFields` as JSON **strings**, so `sources get --json` printed `"[\"1.2.3.4\"]"`. A create carrying any of them answered 500. | Server-side fix; nothing in the CLI parsed them. Since API #131, **`sources get --json` (and list/export) show these as arrays.** Anything scripting against the old string form must stop `JSON.parse`-ing them. |

---

## Rejected during verification (considered, not bugs)

`api-keys create` scopes-not-array crash · `cron-groups --order` as string ·
event-detail payload-size snake-only read · Dashboard active-destinations
snake-only read · global `-y/--yes` "shadowing" (subcommands redeclare it, so it
works) · cron/tunnels `pageSize` truncation (endpoints ignore the param and
return all rows).
