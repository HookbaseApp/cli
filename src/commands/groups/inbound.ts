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
    .description('Create a new source')
    .option('-n, --name <name>', 'Source name')
    .option('-s, --slug <slug>', 'Custom slug')
    .option('-p, --provider <provider>', 'Provider (github, stripe, etc.)')
    .option('-y, --yes', 'Skip confirmation')
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
    .description('Create a new destination')
    .option('-n, --name <name>', 'Destination name')
    .option('-u, --url <url>', 'Destination URL')
    .option('-m, --method <method>', 'HTTP method (POST, PUT, PATCH)')
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
    .description('Create a new route')
    .option('-n, --name <name>', 'Route name')
    .option('-s, --source <sourceId>', 'Source ID')
    .option('-d, --destination <destId>', 'Destination ID')
    .option('-p, --priority <priority>', 'Priority (higher = runs first)')
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

export function registerInboundGroup(parent: Command): Command {
  const inbound = parent
    .command('inbound')
    .description('Inbound webhook management (sources, destinations, routes, events, deliveries)');

  registerSourcesCommands(inbound);
  registerDestinationsCommands(inbound);
  registerRoutesCommands(inbound);
  registerEventsCommands(inbound);
  registerDeliveriesCommands(inbound);

  return inbound;
}
