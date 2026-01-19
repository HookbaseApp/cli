#!/usr/bin/env node

import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import {
  sourcesListCommand,
  sourcesCreateCommand,
  sourcesGetCommand,
  sourcesUpdateCommand,
  sourcesDeleteCommand,
  sourcesRotateSecretCommand,
} from './commands/sources.js';
import {
  destinationsListCommand,
  destinationsCreateCommand,
  destinationsGetCommand,
  destinationsUpdateCommand,
  destinationsDeleteCommand,
  destinationsTestCommand,
} from './commands/destinations.js';
import {
  routesListCommand,
  routesCreateCommand,
  routesGetCommand,
  routesUpdateCommand,
  routesDeleteCommand,
} from './commands/routes.js';
import {
  tunnelsListCommand,
  tunnelsCreateCommand,
  tunnelsConnectCommand,
  tunnelsStartCommand,
  tunnelsDisconnectCommand,
  tunnelsDeleteCommand,
  tunnelsStatusCommand,
  tunnelsGetCommand,
} from './commands/tunnels.js';
import {
  eventsListCommand,
  eventsGetCommand,
  eventsFollowCommand,
} from './commands/events.js';
import {
  deliveriesListCommand,
  deliveriesGetCommand,
  deliveriesReplayCommand,
  deliveriesBulkReplayCommand,
} from './commands/deliveries.js';
import {
  apiKeysListCommand,
  apiKeysCreateCommand,
  apiKeysRevokeCommand,
} from './commands/api-keys.js';
import { logsCommand } from './commands/logs.js';
import { forwardCommand } from './commands/forward.js';
import { dashboardCommand, tunnelMonitorCommand } from './commands/dashboard.js';
import {
  cronListCommand,
  cronCreateCommand,
  cronGetCommand,
  cronUpdateCommand,
  cronDeleteCommand,
  cronTriggerCommand,
  cronHistoryCommand,
  cronEnableCommand,
  cronDisableCommand,
  cronBuilderCommand,
  cronFollowCommand,
  cronStatusCommand,
} from './commands/cron.js';
import {
  cronGroupsListCommand,
  cronGroupsCreateCommand,
  cronGroupsGetCommand,
  cronGroupsUpdateCommand,
  cronGroupsDeleteCommand,
  cronGroupsReorderCommand,
} from './commands/cron-groups.js';
import * as config from './lib/config.js';
import * as logger from './lib/logger.js';

const program = new Command();

program
  .name('hookbase')
  .description('CLI tool for Hookbase - manage webhooks and localhost tunnels')
  .version('1.0.0')
  .option('--json', 'Output as JSON (for scripting)')
  .option('-y, --yes', 'Skip confirmation prompts');

// ============================================================================
// Authentication Commands
// ============================================================================

program
  .command('login')
  .description('Authenticate with Hookbase')
  .action(loginCommand);

program
  .command('logout')
  .description('Log out and clear stored credentials')
  .action(logoutCommand);

program
  .command('whoami')
  .alias('status')
  .description('Show current authentication status')
  .option('--json', 'Output as JSON')
  .action((options) => {
    if (!config.isAuthenticated()) {
      if (options.json) {
        console.log(JSON.stringify({ authenticated: false }, null, 2));
      } else {
        logger.info('Not logged in');
        logger.dim('Run "hookbase login" to authenticate');
      }
      return;
    }

    const user = config.getCurrentUser();
    const org = config.getCurrentOrg();

    if (options.json) {
      console.log(JSON.stringify({
        authenticated: true,
        user,
        organization: org,
      }, null, 2));
      return;
    }

    logger.log('');
    logger.log(logger.bold('Hookbase CLI Status'));
    logger.log('');
    logger.log(`User:         ${user?.email || 'API key authentication'}`);
    if (user?.displayName) {
      logger.log(`Display Name: ${user.displayName}`);
    }
    logger.log(`Organization: ${org?.slug || 'none'}`);
    logger.log('');
    logger.dim(`Config: ${config.getConfigPath()}`);
  });

// ============================================================================
// API Keys Commands
// ============================================================================

const apiKeys = program
  .command('api-keys')
  .alias('keys')
  .description('Manage API keys');

apiKeys
  .command('list')
  .alias('ls')
  .description('List all API keys')
  .option('--json', 'Output as JSON')
  .action(apiKeysListCommand);

apiKeys
  .command('create')
  .description('Create a new API key')
  .option('-n, --name <name>', 'API key name')
  .option('-s, --scopes <scopes>', 'Comma-separated scopes (read,write)')
  .option('-e, --expires <days>', 'Expiration in days')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(apiKeysCreateCommand);

apiKeys
  .command('revoke <keyId>')
  .alias('delete')
  .description('Revoke an API key')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(apiKeysRevokeCommand);

// ============================================================================
// Sources Commands
// ============================================================================

const sources = program
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
  .command('get <sourceId>')
  .alias('show')
  .description('Get source details')
  .option('--json', 'Output as JSON')
  .action(sourcesGetCommand);

sources
  .command('update <sourceId>')
  .description('Update a source')
  .option('-n, --name <name>', 'New name')
  .option('-p, --provider <provider>', 'New provider')
  .option('-d, --description <description>', 'New description')
  .option('--active', 'Set source as active')
  .option('--inactive', 'Set source as inactive')
  .option('--json', 'Output as JSON')
  .action(sourcesUpdateCommand);

sources
  .command('delete <sourceId>')
  .alias('rm')
  .description('Delete a source')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(sourcesDeleteCommand);

sources
  .command('rotate-secret <sourceId>')
  .description('Rotate the signing secret for a source')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(sourcesRotateSecretCommand);

// ============================================================================
// Destinations Commands
// ============================================================================

const destinations = program
  .command('destinations')
  .alias('dest')
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
  .command('get <destId>')
  .alias('show')
  .description('Get destination details')
  .option('--json', 'Output as JSON')
  .action(destinationsGetCommand);

destinations
  .command('update <destId>')
  .description('Update a destination')
  .option('-n, --name <name>', 'New name')
  .option('-u, --url <url>', 'New URL')
  .option('-m, --method <method>', 'New HTTP method')
  .option('--active', 'Set destination as active')
  .option('--inactive', 'Set destination as inactive')
  .option('--json', 'Output as JSON')
  .action(destinationsUpdateCommand);

destinations
  .command('delete <destId>')
  .alias('rm')
  .description('Delete a destination')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(destinationsDeleteCommand);

destinations
  .command('test <destId>')
  .description('Test a destination with a sample webhook')
  .option('--json', 'Output as JSON')
  .action(destinationsTestCommand);

// ============================================================================
// Routes Commands
// ============================================================================

const routes = program
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

// ============================================================================
// Tunnels Commands
// ============================================================================

const tunnels = program
  .command('tunnels')
  .alias('tunnel')
  .description('Manage localhost tunnels');

tunnels
  .command('list')
  .alias('ls')
  .description('List all tunnels')
  .option('--json', 'Output as JSON')
  .action(tunnelsListCommand);

tunnels
  .command('create')
  .description('Create a new tunnel (without connecting)')
  .option('-n, --name <name>', 'Tunnel name')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain (Pro plan)')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(tunnelsCreateCommand);

tunnels
  .command('connect <tunnelId> <port>')
  .description('Connect to an existing tunnel')
  .option('--json', 'Output as JSON')
  .action(tunnelsConnectCommand);

tunnels
  .command('start <port>')
  .alias('s')
  .description('Create and connect a tunnel in one step')
  .option('-n, --name <name>', 'Tunnel name')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain (Pro plan)')
  .option('--json', 'Output as JSON')
  .action(tunnelsStartCommand);

tunnels
  .command('get <tunnelId>')
  .alias('show')
  .description('Get tunnel details')
  .option('--json', 'Output as JSON')
  .action(tunnelsGetCommand);

tunnels
  .command('status <tunnelId>')
  .description('Get live tunnel status')
  .option('--json', 'Output as JSON')
  .action(tunnelsStatusCommand);

tunnels
  .command('disconnect <tunnelId>')
  .description('Disconnect a tunnel')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(tunnelsDisconnectCommand);

tunnels
  .command('delete <tunnelId>')
  .alias('rm')
  .description('Delete a tunnel')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(tunnelsDeleteCommand);

// ============================================================================
// Events Commands
// ============================================================================

const events = program
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

// ============================================================================
// Deliveries Commands
// ============================================================================

const deliveries = program
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

// ============================================================================
// Cron Commands
// ============================================================================

const cron = program
  .command('cron')
  .description('Manage cron jobs');

cron
  .command('list')
  .alias('ls')
  .description('List cron jobs')
  .option('-a, --all', 'Show all jobs (including inactive)')
  .option('--json', 'Output as JSON')
  .action(cronListCommand);

cron
  .command('create')
  .description('Create a new cron job')
  .option('-n, --name <name>', 'Job name')
  .option('-s, --schedule <expression>', 'Cron expression (e.g., "0 * * * *")')
  .option('-u, --url <url>', 'URL to call')
  .option('-m, --method <method>', 'HTTP method (POST, GET, etc.)')
  .option('-z, --timezone <timezone>', 'Timezone (default: UTC)')
  .option('-p, --payload <json>', 'Request payload (JSON string)')
  .option('-H, --headers <json>', 'Request headers (JSON object)')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds')
  .option('-g, --group <groupId>', 'Group ID to add job to')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(cronCreateCommand);

cron
  .command('get <jobId>')
  .alias('show')
  .description('Get cron job details')
  .option('--json', 'Output as JSON')
  .action(cronGetCommand);

cron
  .command('update <jobId>')
  .description('Update a cron job')
  .option('-n, --name <name>', 'New name')
  .option('-s, --schedule <expression>', 'New cron expression')
  .option('-u, --url <url>', 'New URL')
  .option('-m, --method <method>', 'New HTTP method')
  .option('-z, --timezone <timezone>', 'New timezone')
  .option('-p, --payload <json>', 'New payload')
  .option('-H, --headers <json>', 'New headers')
  .option('-t, --timeout <ms>', 'New timeout')
  .option('--active', 'Enable job')
  .option('--inactive', 'Disable job')
  .option('--json', 'Output as JSON')
  .action(cronUpdateCommand);

cron
  .command('delete <jobId>')
  .alias('rm')
  .description('Delete a cron job')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(cronDeleteCommand);

cron
  .command('trigger <jobId>')
  .alias('run')
  .description('Manually trigger a cron job')
  .option('--json', 'Output as JSON')
  .action(cronTriggerCommand);

cron
  .command('history <jobId>')
  .alias('executions')
  .description('View execution history for a cron job')
  .option('-l, --limit <number>', 'Number of executions to show', '20')
  .option('--json', 'Output as JSON')
  .action(cronHistoryCommand);

cron
  .command('enable <jobId>')
  .description('Enable a cron job')
  .option('--json', 'Output as JSON')
  .action(cronEnableCommand);

cron
  .command('disable <jobId>')
  .description('Disable a cron job')
  .option('--json', 'Output as JSON')
  .action(cronDisableCommand);

cron
  .command('builder')
  .description('Interactive cron expression builder')
  .action(cronBuilderCommand);

cron
  .command('follow')
  .alias('watch')
  .description('Monitor cron executions in real-time')
  .option('-j, --job <jobId>', 'Monitor specific job only')
  .option('-i, --interval <seconds>', 'Poll interval in seconds', '5')
  .action(cronFollowCommand);

cron
  .command('status')
  .description('Show cron jobs status overview')
  .option('--json', 'Output as JSON')
  .action(cronStatusCommand);

// Cron Groups sub-commands
const cronGroups = cron
  .command('groups')
  .description('Manage cron job groups');

cronGroups
  .command('list')
  .alias('ls')
  .description('List cron groups')
  .option('--json', 'Output as JSON')
  .action(cronGroupsListCommand);

cronGroups
  .command('create')
  .description('Create a new cron group')
  .option('-n, --name <name>', 'Group name')
  .option('-d, --description <description>', 'Group description')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(cronGroupsCreateCommand);

cronGroups
  .command('get <groupId>')
  .alias('show')
  .description('Get cron group details')
  .option('--json', 'Output as JSON')
  .action(cronGroupsGetCommand);

cronGroups
  .command('update <groupId>')
  .description('Update a cron group')
  .option('-n, --name <name>', 'New name')
  .option('-d, --description <description>', 'New description')
  .option('-o, --order <number>', 'New sort order')
  .option('--json', 'Output as JSON')
  .action(cronGroupsUpdateCommand);

cronGroups
  .command('delete <groupId>')
  .alias('rm')
  .description('Delete a cron group (jobs become ungrouped)')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .action(cronGroupsDeleteCommand);

cronGroups
  .command('reorder')
  .description('Interactively reorder cron groups')
  .option('--json', 'Output as JSON')
  .action(cronGroupsReorderCommand);

// ============================================================================
// TUI Commands
// ============================================================================

program
  .command('dashboard')
  .alias('dash')
  .description('Launch interactive dashboard (TUI)')
  .action(dashboardCommand);

tunnels
  .command('monitor <tunnelId> <port>')
  .description('Launch tunnel monitor TUI')
  .action(tunnelMonitorCommand);

// ============================================================================
// Convenience Commands
// ============================================================================

// Logs command (alias for events)
program
  .command('logs')
  .description('View recent webhook events (alias for events list)')
  .option('-l, --limit <number>', 'Number of events to show', '50')
  .option('-f, --follow', 'Follow live events')
  .action(logsCommand);

// Forward command
program
  .command('forward <url>')
  .description('Quick forward webhooks to a URL')
  .action(forwardCommand);

// ============================================================================
// Configuration Commands
// ============================================================================

program
  .command('config')
  .description('Show configuration')
  .option('--json', 'Output as JSON')
  .option('--path', 'Show config file path only')
  .action((options) => {
    if (options.path) {
      console.log(config.getConfigPath());
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(config.getAllConfig(), null, 2));
      return;
    }

    logger.log('');
    logger.log(logger.bold('Configuration'));
    logger.log('');
    logger.log(`Config file:  ${config.getConfigPath()}`);
    logger.log(`API URL:      ${config.getApiUrl()}`);
    logger.log(`Auth Token:   ${config.getAuthToken() ? '***' : 'Not set'}`);
    logger.log(`Organization: ${config.getCurrentOrg()?.slug || 'Not set'}`);
    logger.log('');
    logger.log(logger.bold('Environment Variables'));
    logger.log('');
    logger.log(`HOOKBASE_API_KEY:  ${process.env.HOOKBASE_API_KEY ? 'Set' : 'Not set'}`);
    logger.log(`HOOKBASE_API_URL:  ${process.env.HOOKBASE_API_URL || 'Not set'}`);
    logger.log(`HOOKBASE_ORG_ID:   ${process.env.HOOKBASE_ORG_ID || 'Not set'}`);
    logger.log(`HOOKBASE_DEBUG:    ${process.env.HOOKBASE_DEBUG || 'Not set'}`);
  });

// Parse arguments
program.parse();
