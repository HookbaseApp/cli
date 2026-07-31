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

- **Full API Access** - Create and manage sources, destinations, routes, and more
- **Localhost Tunnels** - Expose local servers to receive webhooks during development
- **Interactive Dashboard** - Visual TUI with keyboard navigation
- **Live Event Streaming** - Watch webhook events in real-time
- **Delivery Management** - View, debug, and replay failed deliveries
- **CI/CD Ready** - JSON output and environment variable support

## Commands

### Authentication
```bash
hookbase login          # Authenticate with Hookbase
hookbase logout         # Clear credentials
hookbase whoami         # Show current user
```

### Resources
```bash
hookbase sources list        # List webhook sources
hookbase sources create      # Create a new source

hookbase destinations list   # List destinations
hookbase destinations create # Create a destination

hookbase routes list         # List routes
hookbase routes create       # Create a route
```

### Tunnels
```bash
hookbase tunnels start 3000           # Create and connect a tunnel
hookbase tunnels list                  # List all tunnels
hookbase tunnels connect <id> <port>   # Connect to existing tunnel
```

### Events & Deliveries
```bash
hookbase events list              # List recent events
hookbase events follow            # Stream live events
hookbase deliveries list          # List deliveries
hookbase deliveries replay <id>   # Replay a failed delivery
```

### API Keys
```bash
hookbase api-keys list       # List API keys
hookbase api-keys create     # Create a new API key
hookbase api-keys revoke <id> # Revoke an API key
```

### Interactive Dashboard
```bash
hookbase dashboard    # Launch TUI dashboard
```

Navigate with `Tab` or number keys `1-6`, use arrow keys to browse lists, `Enter` to select, and `Esc` to go back.

## Environment Variables

```bash
HOOKBASE_API_KEY   # API key for authentication
HOOKBASE_API_URL   # Custom API URL
HOOKBASE_ORG_ID    # Default organization ID
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
