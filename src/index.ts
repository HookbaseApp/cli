#!/usr/bin/env node

import { createRequire } from 'module';
import { Command } from 'commander';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { logsCommand } from './commands/logs.js';
import { forwardCommand } from './commands/forward.js';
import { dashboardCommand } from './commands/dashboard.js';
import { registerInboundGroup, registerSourcesCommands, registerDestinationsCommands, registerRoutesCommands, registerEventsCommands, registerDeliveriesCommands } from './commands/groups/inbound.js';
import { registerOutboundGroup, registerWebhooksCommands, registerEndpointsCommands, registerSendCommand, registerMessagesCommands, registerDlqCommands } from './commands/groups/outbound.js';
import { registerToolsGroup, registerCronCommands, registerTunnelsCommands, registerApiKeysCommands } from './commands/groups/tools.js';
import {
  outboundListCommand,
  outboundGetCommand,
  outboundRetryCommand,
} from './commands/outbound.js';
import {
  applicationsListCommand,
  applicationsCreateCommand,
  applicationsGetCommand,
  applicationsUpdateCommand,
  applicationsDeleteCommand,
} from './commands/applications.js';
import * as config from './lib/config.js';
import * as logger from './lib/logger.js';

const program = new Command();

program
  .name('hookbase')
  .description('CLI tool for Hookbase - manage webhooks and localhost tunnels')
  .version(pkg.version)
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
// Grouped Commands
// ============================================================================

registerInboundGroup(program);
registerOutboundGroup(program);
registerToolsGroup(program);

// ============================================================================
// TUI Commands
// ============================================================================

program
  .command('dashboard')
  .alias('dash')
  .description('Launch interactive dashboard (TUI)')
  .action(dashboardCommand);

// ============================================================================
// Convenience Commands
// ============================================================================

program
  .command('logs')
  .description('View recent webhook events (alias for events list)')
  .option('-l, --limit <number>', 'Number of events to show', '50')
  .option('-f, --follow', 'Follow live events')
  .action(logsCommand);

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

// ============================================================================
// Hidden Backward-Compatible Aliases
// ============================================================================
// Old flat commands still work but are hidden from --help output.

function hide(cmd: Command): Command {
  (cmd as any)._hidden = true;
  return cmd;
}

// Inbound flat aliases
hide(registerSourcesCommands(program));
hide(registerDestinationsCommands(program)).alias('dest');
hide(registerRoutesCommands(program));
hide(registerEventsCommands(program));
hide(registerDeliveriesCommands(program));

// Outbound flat aliases
{
  // `apps` alias for webhooks (uses application handlers)
  const apps = program
    .command('apps', { hidden: true })
    .alias('applications')
    .description('Manage webhook applications (outbound)');

  apps
    .command('list')
    .alias('ls')
    .description('List all webhook applications')
    .option('--json', 'Output as JSON')
    .action(applicationsListCommand);

  apps
    .command('create')
    .description('Create a new webhook application')
    .option('-n, --name <name>', 'Application name')
    .option('-u, --uid <uid>', 'Custom UID (for your reference)')
    .option('-d, --description <description>', 'Description')
    .option('-r, --rate-limit <limit>', 'Rate limit per minute')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(applicationsCreateCommand);

  apps
    .command('get <appId>')
    .alias('show')
    .description('Get application details')
    .option('--json', 'Output as JSON')
    .action(applicationsGetCommand);

  apps
    .command('update <appId>')
    .description('Update an application')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <description>', 'New description')
    .option('-r, --rate-limit <limit>', 'New rate limit')
    .option('--active', 'Set application as active')
    .option('--inactive', 'Set application as inactive')
    .option('--json', 'Output as JSON')
    .action(applicationsUpdateCommand);

  apps
    .command('delete <appId>')
    .alias('rm')
    .description('Delete an application')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(applicationsDeleteCommand);
}

hide(registerEndpointsCommands(program)).alias('ep');
hide(registerDlqCommands(program));
hide(registerSendCommand(program));

{
  // `messages` flat alias for outbound messages
  const messages = program
    .command('messages', { hidden: true })
    .description('View and manage outbound webhook messages');

  messages
    .command('list')
    .alias('ls')
    .description('List outbound messages')
    .option('-a, --app <appId>', 'Filter by application')
    .option('-e, --endpoint <endpointId>', 'Filter by endpoint')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --event-type <type>', 'Filter by event type')
    .option('-l, --limit <number>', 'Number of messages to show', '50')
    .option('--json', 'Output as JSON')
    .action(outboundListCommand);

  messages
    .command('get <messageId>')
    .alias('show')
    .description('Get message details')
    .option('--json', 'Output as JSON')
    .action(outboundGetCommand);

  messages
    .command('retry <messageId>')
    .description('Retry a failed message')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(outboundRetryCommand);
}

// Tools flat aliases
hide(registerCronCommands(program));
hide(registerTunnelsCommands(program)).alias('tunnel');
hide(registerApiKeysCommands(program)).alias('keys');

// ============================================================================
// Custom Help
// ============================================================================

program.addHelpText('after', `
Command Groups:
  inbound       Inbound webhook management
    sources       Manage webhook sources
    destinations  Manage webhook destinations
    routes        Manage webhook routes
    events        View webhook events
    deliveries    View and manage deliveries

  outbound      Outbound webhook management
    applications  Manage webhook applications
    endpoints     Manage webhook endpoints
    send          Send a webhook event
    messages      View outbound messages
    dlq           Manage Dead Letter Queue

  tools         Developer tools
    cron          Manage cron jobs
    tunnels       Manage localhost tunnels
    api-keys      Manage API keys

Examples:
  $ hookbase login
  $ hookbase inbound sources list
  $ hookbase inbound sources get my-source-slug
  $ hookbase inbound destinations get my-dest-slug
  $ hookbase outbound applications create
  $ hookbase tools tunnels start 3000
  $ hookbase tools cron groups get my-group-slug
  $ hookbase sources list              (backward-compatible shorthand)

Tip: Sources, destinations, and cron groups accept slugs in place of IDs.
`);

// Parse arguments
program.parse();
