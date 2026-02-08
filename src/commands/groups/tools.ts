import type { Command } from 'commander';
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
} from '../cron.js';
import {
  cronGroupsListCommand,
  cronGroupsCreateCommand,
  cronGroupsGetCommand,
  cronGroupsUpdateCommand,
  cronGroupsDeleteCommand,
  cronGroupsReorderCommand,
} from '../cron-groups.js';
import {
  tunnelsListCommand,
  tunnelsCreateCommand,
  tunnelsConnectCommand,
  tunnelsStartCommand,
  tunnelsDisconnectCommand,
  tunnelsDeleteCommand,
  tunnelsStatusCommand,
  tunnelsGetCommand,
} from '../tunnels.js';
import { tunnelMonitorCommand } from '../dashboard.js';
import {
  apiKeysListCommand,
  apiKeysCreateCommand,
  apiKeysRevokeCommand,
} from '../api-keys.js';

export function registerCronCommands(parent: Command): Command {
  const cron = parent
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

  return cron;
}

export function registerTunnelsCommands(parent: Command): Command {
  const tunnels = parent
    .command('tunnels')
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

  tunnels
    .command('monitor <tunnelId> <port>')
    .description('Launch tunnel monitor TUI')
    .action(tunnelMonitorCommand);

  return tunnels;
}

export function registerApiKeysCommands(parent: Command): Command {
  const apiKeys = parent
    .command('api-keys')
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

  return apiKeys;
}

export function registerToolsGroup(parent: Command): Command {
  const tools = parent
    .command('tools')
    .description('Developer tools (cron, tunnels, api-keys)');

  registerCronCommands(tools);
  registerTunnelsCommands(tools);
  registerApiKeysCommands(tools);

  return tools;
}
