# @hookbase/cli

The official CLI for [Hookbase](https://hookbase.app) - manage webhooks, create localhost tunnels, and monitor deliveries from your terminal.

## Installation

```bash
npm install -g @hookbase/cli
```

## Updating

The CLI checks for a newer version once a day (in the background, non-blocking) and
prints a short notice when one is available. To update:

```bash
hookbase upgrade            # update to the latest published version
hookbase upgrade --check    # only report whether an update is available
hookbase upgrade --dry-run  # if an update exists, print the install command instead of running it
```

`upgrade` auto-detects how the CLI was installed (npm, pnpm, yarn, bun, or volta)
and runs the matching global-install command.

To silence the update notice, set `NO_UPDATE_NOTIFIER=1`. Notices are also
automatically suppressed in CI, when output is piped (non-TTY), and for
`--json` output.

## Quick Start

```bash
# Login to your account
hookbase login

# Start a tunnel to receive webhooks locally
hookbase tunnels start 3000

# Or launch the interactive dashboard
hookbase dashboard
```

## Features

- **Full API Access** - Create and manage sources, destinations, routes, transforms, schemas, filters, and notification channels
- **Localhost Tunnels** - Expose local servers to receive webhooks during development
- **Interactive Dashboard** - Visual TUI with keyboard navigation
- **Live Event Streaming** - Watch webhook events and deliveries in real-time (SSE)
- **Delivery Management** - View, debug, and replay failed deliveries
- **Outbound Webhooks** - Manage applications, endpoints, messages, and the Dead Letter Queue
- **Cron Jobs** - Schedule and monitor recurring webhook triggers
- **Org & Team Management** - Members, invites, 2FA, and audit logs (via browser-authenticated session)
- **Platform Status** - Check Hookbase's own uptime from the terminal
- **CI/CD Ready** - JSON/XML/YAML output and environment variable support

## Commands

Commands are organized into three groups — `inbound`, `outbound`, and `tools` — plus
top-level account/org commands. Most resource commands also work as flat,
backward-compatible shorthand (e.g. `hookbase sources list` instead of
`hookbase inbound sources list`).

Run `hookbase --help` or `hookbase <command> --help` at any level for the full,
up-to-date list of subcommands and flags.

### Authentication & Account
```bash
hookbase login                # Authenticate (browser session or API key)
hookbase logout               # Clear credentials
hookbase whoami                # Show current auth status (API key and/or session)
hookbase status                # Show Hookbase platform status (API, ingestion, delivery)

hookbase session login         # Start a browser-authenticated session (device flow)
hookbase session status        # Show session status
hookbase session logout        # Clear the stored session

hookbase 2fa setup             # Start 2FA setup (QR/otpauth URL)
hookbase 2fa verify <code>     # Finish enabling 2FA (prints recovery codes once)
hookbase 2fa disable           # Disable 2FA
```
> `session login`, `2fa`, org member management, and API key rotation require a
> browser-authenticated session (not just an API key) — they act on your user
> account, not a single organization.

### Organizations
```bash
hookbase org list                       # List your organizations
hookbase org switch <idOrSlug>          # Switch the active organization

hookbase org members list               # List organization members
hookbase org members invite --email ... --role member
hookbase org members set-role <userId> <role>
hookbase org invites list               # List pending invites
```

### Inbound: Sources, Destinations, Routes
```bash
hookbase inbound sources list                 # List webhook sources
hookbase inbound sources create               # Create a new source
hookbase inbound sources get <slug>           # Get source details (ID or slug)
hookbase inbound sources rotate-secret <slug> # Rotate a source's signing secret

hookbase inbound destinations list            # List destinations
hookbase inbound destinations create          # Create a destination
hookbase inbound destinations test <slug>     # Send a sample webhook to test it

hookbase inbound routes list                  # List routes
hookbase inbound routes create                # Create a route
hookbase inbound routes circuit-status <id>   # Circuit breaker status (Pro+)
```

### Inbound: Transforms, Schemas, Filters, Notification Channels
```bash
hookbase inbound transforms list              # List payload transforms (JSONata/JS)
hookbase inbound transforms create            # Create a transform (Transforms plan)

hookbase inbound schemas list                 # List JSON Schema validators
hookbase inbound schemas validate <id> --payload '{"a":1}'

hookbase inbound filters list                 # List reusable event filters

hookbase inbound channels list                # List notification channels (Slack, email, webhook)
hookbase inbound channels test <id>           # Send a test notification
hookbase inbound channels link <id>           # Link a channel to a route
```

### Events & Deliveries
```bash
hookbase events list              # List recent events (alias: hookbase logs)
hookbase events follow            # Stream live events
hookbase deliveries list          # List deliveries
hookbase deliveries replay <id>   # Replay a failed delivery
hookbase deliveries bulk-replay --status failed
hookbase stream                   # Stream live events/deliveries in real time (SSE)
```

### Outbound: Applications, Endpoints, Messages, DLQ
```bash
hookbase outbound applications list           # List webhook applications
hookbase outbound endpoints create            # Create a webhook endpoint
hookbase outbound endpoints test <id>         # Test an endpoint
hookbase outbound endpoints reset-circuit <id>
hookbase outbound send --app <id> --event-type user.created --payload '{}'
hookbase outbound messages list               # List outbound messages
hookbase outbound messages attempts <id>      # List delivery attempts for a message
hookbase outbound dlq list                    # List Dead Letter Queue messages
hookbase outbound dlq bulk-retry              # Retry multiple DLQ messages
hookbase outbound stats                       # Delivery stats summary + DLQ breakdown
```

### Tunnels
```bash
hookbase tunnels start 3000            # Create and connect a tunnel
hookbase tunnels list                  # List all tunnels
hookbase tunnels connect <id> <port>   # Connect to existing tunnel
hookbase listen 3000                   # Shorthand alias for tunnels start
```

### Cron Jobs
```bash
hookbase tools cron list                 # List cron jobs
hookbase tools cron create               # Create a cron job
hookbase tools cron trigger <jobId>      # Manually trigger a run
hookbase tools cron follow               # Monitor executions in real time
hookbase tools cron groups list          # List cron job groups
```

### API Keys
```bash
hookbase api-keys list                # List API keys
hookbase api-keys create              # Create a new API key
hookbase api-keys revoke <id>         # Revoke an API key
hookbase api-keys rotate-secret <id>  # Rotate a key's secret (requires a session login)
```

### Audit Logs
```bash
hookbase audit-logs list              # List audit log entries
hookbase audit-logs export            # Export audit logs as CSV
```

### Other
```bash
hookbase forward <url>       # Quick forward webhooks to a URL
hookbase trigger             # Send a test webhook event to a source (signed by default)
hookbase init                # Scaffold a webhook handler project (express, fastify, hono, nextjs, cloudflare-worker)
hookbase config              # Show configuration
```

### Interactive Dashboard
```bash
hookbase dashboard    # Launch TUI dashboard
```

Navigate with `Tab` or number keys `1-6`, use arrow keys to browse lists, `Enter` to select, and `Esc` to go back.

## Environment Variables

```bash
HOOKBASE_API_KEY    # API key for authentication
HOOKBASE_API_URL    # Custom API URL
HOOKBASE_ORG_ID     # Default organization ID (overrides the configured current org)
HOOKBASE_ORG_SLUG   # Org slug to pair with HOOKBASE_ORG_ID
HOOKBASE_DEBUG      # Set to 1/true for verbose debug output
```

## CI/CD Usage

```bash
export HOOKBASE_API_KEY="whr_live_xxx"
hookbase sources list --json
hookbase deliveries bulk-replay --status failed --yes
```

## Documentation

- [CLI Commands Reference](https://www.hookbase.app/docs/receive/cli/commands)
- [API Documentation](https://www.hookbase.app/docs/receive/api)
- [Tunnels Guide](https://www.hookbase.app/docs/receive/guide/tunnels)

## License

MIT
