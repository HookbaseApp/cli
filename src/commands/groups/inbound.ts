import type { Command } from 'commander';
import {
  sourcesListCommand,
  sourcesCreateCommand,
  sourcesGetCommand,
  sourcesUpdateCommand,
  sourcesDeleteCommand,
  sourcesRotateSecretCommand,
} from '../sources.js';
import {
  destinationsListCommand,
  destinationsCreateCommand,
  destinationsGetCommand,
  destinationsUpdateCommand,
  destinationsDeleteCommand,
  destinationsTestCommand,
} from '../destinations.js';
import {
  routesListCommand,
  routesCreateCommand,
  routesGetCommand,
  routesUpdateCommand,
  routesDeleteCommand,
} from '../routes.js';
import {
  eventsListCommand,
  eventsGetCommand,
  eventsFollowCommand,
} from '../events.js';
import {
  deliveriesListCommand,
  deliveriesGetCommand,
  deliveriesReplayCommand,
  deliveriesBulkReplayCommand,
} from '../deliveries.js';
import {
  transformsListCommand,
  transformsCreateCommand,
  transformsGetCommand,
  transformsDeleteCommand,
} from '../transforms.js';
import {
  schemasListCommand,
  schemasCreateCommand,
  schemasGetCommand,
  schemasDeleteCommand,
} from '../schemas.js';
import {
  filtersListCommand,
  filtersCreateCommand,
  filtersGetCommand,
  filtersDeleteCommand,
} from '../filters.js';
import {
  channelsListCommand,
  channelsCreateCommand,
  channelsLinkCommand,
  channelsDeleteCommand,
} from '../notification-channels.js';

export function registerSourcesCommands(parent: Command): Command {
  const sources = parent
    .command('sources')
    .description('Manage webhook sources');

  sources
    .command('list')
    .alias('ls')
    .description('List all sources')
    .option('--json', 'Output as JSON')
    .action(sourcesListCommand);

  sources
    .command('create')
    .description('Create a new source (add --* advanced flags or answer the "Advanced setup?" prompt)')
    .option('-n, --name <name>', 'Source name')
    .option('-s, --slug <slug>', 'Custom slug')
    .option('-p, --provider <provider>', 'Provider (github, stripe, etc.)')
    .option('-d, --description <text>', 'Description')
    .option('-y, --yes', 'Skip confirmation')
    .option('--transient', 'Enable transient mode (payloads not stored)')
    .option('--methods <list>', 'Comma-separated HTTP verbs the ingest endpoint accepts (e.g. GET,POST). Omit for any method')
    .option('--reject-invalid-signatures', 'Reject requests whose signature fails verification')
    .option('--dedup', 'Enable event deduplication')
    .option('--dedup-window <hours>', 'Dedup window in hours (1-168)')
    .option('--rate-limit <n>', 'Rate limit in requests/min (paid plans)')
    .option('--ip-filter-mode <mode>', 'IP filter mode: none|allowlist|denylist|both (paid plans)')
    .option('--ip-allowlist <csv>', 'Comma-separated allowlist IPs/CIDRs (paid plans)')
    .option('--ip-denylist <csv>', 'Comma-separated denylist IPs/CIDRs (paid plans)')
    .option('--encrypt-fields <csv>', 'Comma-separated field paths to encrypt (Pro+)')
    .option('--mask-fields <csv>', 'Comma-separated field paths to mask (Pro+)')
    .option('--json', 'Output as JSON')
    .action(sourcesCreateCommand);

  sources
    .command('get <source>')
    .alias('show')
    .description('Get source details (accepts ID or slug)')
    .option('--json', 'Output as JSON')
    .action(sourcesGetCommand);

  sources
    .command('update <source>')
    .description('Update a source (accepts ID or slug)')
    .option('-n, --name <name>', 'New name')
    .option('-p, --provider <provider>', 'New provider')
    .option('-d, --description <description>', 'New description')
    .option('--active', 'Set source as active')
    .option('--inactive', 'Set source as inactive')
    .option('--transient', 'Enable transient mode (payloads not stored)')
    .option('--no-transient', 'Disable transient mode')
    .option('--methods <list>', 'Comma-separated HTTP verbs to accept (e.g. GET,POST). Pass "any" or "" to accept any method')
    .option('--json', 'Output as JSON')
    .action(sourcesUpdateCommand);

  sources
    .command('delete <source>')
    .alias('rm')
    .description('Delete a source (accepts ID or slug)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(sourcesDeleteCommand);

  sources
    .command('rotate-secret <source>')
    .description('Rotate the signing secret for a source (accepts ID or slug)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(sourcesRotateSecretCommand);

  return sources;
}

export function registerDestinationsCommands(parent: Command): Command {
  const destinations = parent
    .command('destinations')
    .description('Manage webhook destinations');

  destinations
    .command('list')
    .alias('ls')
    .description('List all destinations')
    .option('--json', 'Output as JSON')
    .action(destinationsListCommand);

  destinations
    .command('create')
    .description('Create a new destination (add --* advanced flags or answer the "Advanced setup?" prompt)')
    .option('-n, --name <name>', 'Destination name')
    .option('-u, --url <url>', 'Destination URL')
    .option('-m, --method <method>', 'HTTP method (POST, PUT, PATCH)')
    .option('--header <kv>', 'Custom request header "Key: Value" (repeatable)', (v: string, prev: string[] = []) => prev.concat(v), [])
    .option('--auth-type <type>', 'Auth: none|bearer|basic (for custom auth headers use --header)')
    .option('--auth-token <token>', 'Bearer token (with --auth-type bearer)')
    .option('--auth-user <user>', 'Username (with --auth-type basic)')
    .option('--auth-pass <pass>', 'Password (with --auth-type basic)')
    .option('--timeout <ms>', 'Request timeout in ms (1000-60000)')
    .option('--rate-limit <n>', 'Rate limit in requests/min (paid plans)')
    .option('--type <type>', 'Destination type: http|s3|r2|gcs|azure_blob|sqs|eventbridge|servicebus|pubsub|oci_queue (warehouse/queue types are Pro+)')
    .option('--config <json>', 'JSON config object for warehouse/queue types')
    .option('--batch-size <n>', 'Batch size for warehouse/queue types (1-1000)')
    .option('--batch-window <s>', 'Batch window in seconds (0-300)')
    .option('--field-mapping <json>', 'JSON array of field mappings for warehouse/queue types')
    .option('--static-ip', 'Enable static IP delivery (Pro+)')
    .option('--no-static-ip', 'Disable static IP delivery')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(destinationsCreateCommand);

  destinations
    .command('get <destination>')
    .alias('show')
    .description('Get destination details (accepts ID or slug)')
    .option('--json', 'Output as JSON')
    .action(destinationsGetCommand);

  destinations
    .command('update <destination>')
    .description('Update a destination (accepts ID or slug)')
    .option('-n, --name <name>', 'New name')
    .option('-u, --url <url>', 'New URL')
    .option('-m, --method <method>', 'New HTTP method')
    .option('--active', 'Set destination as active')
    .option('--inactive', 'Set destination as inactive')
    .option('--static-ip', 'Enable static IP delivery')
    .option('--no-static-ip', 'Disable static IP delivery')
    .option('--json', 'Output as JSON')
    .action(destinationsUpdateCommand);

  destinations
    .command('delete <destination>')
    .alias('rm')
    .description('Delete a destination (accepts ID or slug)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(destinationsDeleteCommand);

  destinations
    .command('test <destination>')
    .description('Test a destination with a sample webhook (accepts ID or slug)')
    .option('--json', 'Output as JSON')
    .action(destinationsTestCommand);

  return destinations;
}

export function registerRoutesCommands(parent: Command): Command {
  const routes = parent
    .command('routes')
    .description('Manage webhook routes');

  routes
    .command('list')
    .alias('ls')
    .description('List all routes')
    .option('--json', 'Output as JSON')
    .action(routesListCommand);

  routes
    .command('create')
    .description('Create a new route (add --* advanced flags or answer the "Advanced setup?" prompt)')
    .option('-n, --name <name>', 'Route name')
    .option('-s, --source <source>', 'Source ID or slug')
    .option('-d, --destination <destination>', 'Destination ID or slug')
    .option('-p, --priority <priority>', 'Priority (higher = runs first)')
    .option('--filter <idOrSlug>', 'Attach an existing filter (id/slug/name)')
    .option('--transform <idOrSlug>', 'Attach an existing transform (id/slug/name) (Transforms plan)')
    .option('--schema <idOrSlug>', 'Attach an existing validation schema (id/slug/name) (Schemas plan)')
    .option('--failover <csv>', 'Comma-separated failover destinations (id/slug, max 3) (paid plans)')
    .option('--failover-after <n>', 'Fail over after N attempts (1-5)')
    .option('--circuit-cooldown <s>', 'Circuit breaker cooldown seconds (Pro+)')
    .option('--circuit-failures <n>', 'Open circuit after N consecutive failures (Pro+)')
    .option('--notify-emails <csv>', 'Comma-separated emails to notify on failure')
    .option('--notify-channel <idOrSlug>', 'Notification channel to link on failure (repeatable) (paid plans)', (v: string, prev: string[] = []) => prev.concat(v), [])
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(routesCreateCommand);

  routes
    .command('get <routeId>')
    .alias('show')
    .description('Get route details')
    .option('--json', 'Output as JSON')
    .action(routesGetCommand);

  routes
    .command('update <routeId>')
    .description('Update a route')
    .option('-n, --name <name>', 'New name')
    .option('-s, --source <sourceId>', 'New source ID')
    .option('-d, --destination <destId>', 'New destination ID')
    .option('-p, --priority <priority>', 'New priority')
    .option('--active', 'Set route as active')
    .option('--inactive', 'Set route as inactive')
    .option('--json', 'Output as JSON')
    .action(routesUpdateCommand);

  routes
    .command('delete <routeId>')
    .alias('rm')
    .description('Delete a route')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(routesDeleteCommand);

  return routes;
}

export function registerEventsCommands(parent: Command): Command {
  const events = parent
    .command('events')
    .description('View webhook events');

  events
    .command('list')
    .alias('ls')
    .description('List recent events')
    .option('-l, --limit <number>', 'Number of events to show', '50')
    .option('-s, --source <sourceId>', 'Filter by source')
    .option('--status <status>', 'Filter by status (delivered, failed, pending)')
    .option('--json', 'Output as JSON')
    .action(eventsListCommand);

  events
    .command('get <eventId>')
    .alias('show')
    .description('Get event details with payload')
    .option('--json', 'Output as JSON')
    .action(eventsGetCommand);

  events
    .command('follow')
    .alias('stream')
    .description('Stream live events')
    .option('-s, --source <sourceId>', 'Filter by source')
    .action(eventsFollowCommand);

  return events;
}

export function registerDeliveriesCommands(parent: Command): Command {
  const deliveries = parent
    .command('deliveries')
    .description('View and manage webhook deliveries');

  deliveries
    .command('list')
    .alias('ls')
    .description('List deliveries')
    .option('-l, --limit <number>', 'Number of deliveries to show', '50')
    .option('-e, --event <eventId>', 'Filter by event')
    .option('-r, --route <routeId>', 'Filter by route')
    .option('-d, --destination <destId>', 'Filter by destination')
    .option('--status <status>', 'Filter by status (success, failed, pending, retrying)')
    .option('--json', 'Output as JSON')
    .action(deliveriesListCommand);

  deliveries
    .command('get <deliveryId>')
    .alias('show')
    .description('Get delivery details')
    .option('--json', 'Output as JSON')
    .action(deliveriesGetCommand);

  deliveries
    .command('replay <deliveryId>')
    .description('Replay a failed delivery')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(deliveriesReplayCommand);

  deliveries
    .command('bulk-replay')
    .description('Replay multiple failed deliveries')
    .option('--status <status>', 'Filter by status', 'failed')
    .option('-l, --limit <number>', 'Max deliveries to replay', '50')
    .option('-y, --yes', 'Skip confirmation (replay all)')
    .option('--json', 'Output as JSON')
    .action(deliveriesBulkReplayCommand);

  return deliveries;
}

export function registerTransformsCommands(parent: Command): Command {
  const transforms = parent
    .command('transforms')
    .description('Manage payload transforms (JSONata, JavaScript, …)');

  transforms
    .command('list')
    .alias('ls')
    .description('List all transforms')
    .option('--json', 'Output as JSON')
    .action(transformsListCommand);

  transforms
    .command('create')
    .description('Create a transform (Transforms plan)')
    .option('-n, --name <name>', 'Transform name')
    .option('-t, --type <type>', 'Type: jsonata|javascript|liquid|xslt')
    .option('-c, --code <code>', 'Transform code (inline)')
    .option('-f, --file <path>', 'Read transform code from a file')
    .option('-d, --description <text>', 'Description')
    .option('--json', 'Output as JSON')
    .action(transformsCreateCommand);

  transforms
    .command('get <transformId>')
    .alias('show')
    .description('Get transform details')
    .option('--json', 'Output as JSON')
    .action(transformsGetCommand);

  transforms
    .command('delete <transformId>')
    .alias('rm')
    .description('Delete a transform')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(transformsDeleteCommand);

  return transforms;
}

export function registerSchemasCommands(parent: Command): Command {
  const schemas = parent
    .command('schemas')
    .description('Manage JSON Schema payload validation');

  schemas
    .command('list')
    .alias('ls')
    .description('List all schemas')
    .option('--json', 'Output as JSON')
    .action(schemasListCommand);

  schemas
    .command('create')
    .description('Create a validation schema (Schemas plan)')
    .option('-n, --name <name>', 'Schema name')
    .option('-f, --file <path>', 'Read the JSON Schema from a file')
    .option('-d, --description <text>', 'Description')
    .option('--json', 'Output as JSON')
    .action(schemasCreateCommand);

  schemas
    .command('get <schemaId>')
    .alias('show')
    .description('Get schema details')
    .option('--json', 'Output as JSON')
    .action(schemasGetCommand);

  schemas
    .command('delete <schemaId>')
    .alias('rm')
    .description('Delete a schema')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(schemasDeleteCommand);

  return schemas;
}

export function registerFiltersCommands(parent: Command): Command {
  const filters = parent
    .command('filters')
    .description('Manage reusable event filters');

  filters
    .command('list')
    .alias('ls')
    .description('List all filters')
    .option('--json', 'Output as JSON')
    .action(filtersListCommand);

  filters
    .command('create')
    .description('Create a filter')
    .option('-n, --name <name>', 'Filter name')
    .option('--logic <logic>', 'Combine conditions with AND or OR', 'AND')
    .option('--condition <spec>', 'Condition "field:operator:value" (repeatable)', (v: string, prev: string[] = []) => prev.concat(v), [])
    .option('-d, --description <text>', 'Description')
    .option('--json', 'Output as JSON')
    .action(filtersCreateCommand);

  filters
    .command('get <filterId>')
    .alias('show')
    .description('Get filter details')
    .option('--json', 'Output as JSON')
    .action(filtersGetCommand);

  filters
    .command('delete <filterId>')
    .alias('rm')
    .description('Delete a filter')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(filtersDeleteCommand);

  return filters;
}

export function registerNotificationChannelsCommands(parent: Command): Command {
  const channels = parent
    .command('notification-channels')
    .alias('channels')
    .description('Manage notification channels (Slack, email, webhook, …)');

  channels
    .command('list')
    .alias('ls')
    .description('List all notification channels')
    .option('--json', 'Output as JSON')
    .action(channelsListCommand);

  channels
    .command('create')
    .description('Create a notification channel (paid plans)')
    .option('-n, --name <name>', 'Channel name')
    .option('-t, --type <type>', 'Type: email|slack|webhook|teams|pagerduty|discord')
    .option('-c, --config <json>', 'Type-specific config as a JSON object')
    .option('--json', 'Output as JSON')
    .action(channelsCreateCommand);

  channels
    .command('link <channelId>')
    .description('Link a channel to a route')
    .option('-r, --route <routeId>', 'Route ID to link')
    .option('--no-on-failure', 'Do not notify on failure')
    .option('--on-success', 'Notify on success')
    .option('--no-on-recovery', 'Do not notify on recovery')
    .option('--json', 'Output as JSON')
    .action(channelsLinkCommand);

  channels
    .command('delete <channelId>')
    .alias('rm')
    .description('Delete a notification channel')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(channelsDeleteCommand);

  return channels;
}

export function registerInboundGroup(parent: Command): Command {
  const inbound = parent
    .command('inbound')
    .description('Inbound webhook management (sources, destinations, routes, events, deliveries)');

  registerSourcesCommands(inbound);
  registerDestinationsCommands(inbound);
  registerRoutesCommands(inbound);
  registerTransformsCommands(inbound);
  registerSchemasCommands(inbound);
  registerFiltersCommands(inbound);
  registerNotificationChannelsCommands(inbound);
  registerEventsCommands(inbound);
  registerDeliveriesCommands(inbound);

  return inbound;
}
