# @hookbase/cli

The official CLI for [Hookbase](https://hookbase.app) - manage webhooks, create localhost tunnels, and monitor deliveries from your terminal.

## Installation

```bash
npm install -g @hookbase/cli
```

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

- [CLI Commands Reference](https://docs.hookbase.app/cli/commands)
- [API Documentation](https://docs.hookbase.app/api/)
- [Tunnels Guide](https://docs.hookbase.app/guide/tunnels)

## License

MIT
