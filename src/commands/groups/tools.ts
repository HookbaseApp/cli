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
  tunnelsProxyCommand,
} from '../tunnels.js';
import { tunnelMonitorCommand } from '../dashboard.js';
import {
  apiKeysListCommand,
  apiKeysCreateCommand,
  apiKeysRevokeCommand,
  apiKeysRotateSecretCommand,
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--static-ip', 'Enable static IP delivery (Pro/Business)')
    .option('--no-static-ip', 'Disable static IP delivery')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronCreateCommand);

  cron
    .command('get <jobId>')
    .alias('show')
    .description('Get cron job details')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--static-ip', 'Enable static IP delivery (Pro/Business)')
    .option('--no-static-ip', 'Disable static IP delivery')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronUpdateCommand);

  cron
    .command('delete <jobId>')
    .alias('rm')
    .description('Delete a cron job')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronDeleteCommand);

  cron
    .command('trigger <jobId>')
    .alias('run')
    .description('Manually trigger a cron job')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronTriggerCommand);

  cron
    .command('history <jobId>')
    .alias('executions')
    .description('View execution history for a cron job')
    .option('-l, --limit <number>', 'Number of executions to show', '20')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronHistoryCommand);

  cron
    .command('enable <jobId>')
    .description('Enable a cron job')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronEnableCommand);

  cron
    .command('disable <jobId>')
    .description('Disable a cron job')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronGroupsListCommand);

  cronGroups
    .command('create')
    .description('Create a new cron group')
    .option('-n, --name <name>', 'Group name')
    .option('-d, --description <description>', 'Group description')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronGroupsCreateCommand);

  cronGroups
    .command('get <group>')
    .alias('show')
    .description('Get cron group details (accepts ID or slug)')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronGroupsGetCommand);

  cronGroups
    .command('update <group>')
    .description('Update a cron group (accepts ID or slug)')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <description>', 'New description')
    .option('-o, --order <number>', 'New sort order')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronGroupsUpdateCommand);

  cronGroups
    .command('delete <group>')
    .alias('rm')
    .description('Delete a cron group (accepts ID or slug, jobs become ungrouped)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(cronGroupsDeleteCommand);

  cronGroups
    .command('reorder')
    .description('Interactively reorder cron groups')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsListCommand);

  tunnels
    .command('create')
    .description('Create a new tunnel (without connecting)')
    .option('-n, --name <name>', 'Tunnel name')
    .option('-s, --subdomain <subdomain>', 'Custom subdomain (Pro plan)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsCreateCommand);

  tunnels
    .command('connect <tunnelId> <port>')
    .description('Connect to an existing tunnel')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsConnectCommand);

  tunnels
    .command('start <port>')
    .alias('s')
    .description('Create and connect a tunnel in one step')
    .option('-n, --name <name>', 'Tunnel name')
    .option('-s, --subdomain <subdomain>', 'Custom subdomain (Pro plan)')
    .option('--filter-source <slug>', 'Only forward events from this source slug (repeatable)', (v: string, prev: string[] = []) => prev.concat(v), [])
    .option('--filter-event <pattern>', 'Only forward events matching this glob (repeatable)', (v: string, prev: string[] = []) => prev.concat(v), [])
    .option('--filter-expr <jsonata>', 'Only forward events where this JSONata expression is truthy')
    .option('--filter-skip-status <code>', 'HTTP status returned to relay for filtered-out requests', '204')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsStartCommand);

  tunnels
    .command('get <tunnelId>')
    .alias('show')
    .description('Get tunnel details')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsGetCommand);

  tunnels
    .command('status <tunnelId>')
    .description('Get live tunnel status')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsStatusCommand);

  tunnels
    .command('disconnect <tunnelId>')
    .description('Disconnect a tunnel')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsDisconnectCommand);

  tunnels
    .command('delete <tunnelId>')
    .alias('rm')
    .description('Delete a tunnel')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsDeleteCommand);

  tunnels
    .command('proxy <port>')
    .description('Start a bidirectional outbound proxy through Hookbase')
    .option('-n, --name <name>', 'Tunnel name')
    .option('-s, --subdomain <subdomain>', 'Custom subdomain (Pro plan)')
    .option('--hosts <hosts>', 'Comma-separated allowed target hostnames (required)')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(tunnelsProxyCommand);

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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(apiKeysListCommand);

  apiKeys
    .command('create')
    .description('Create a new API key')
    .option('-n, --name <name>', 'API key name')
    .option('-s, --scopes <scopes>', 'Comma-separated scopes (read,write,delete)')
    .option('-e, --expires <days>', 'Expiration in days')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(apiKeysCreateCommand);

  apiKeys
    .command('revoke <keyId>')
    .alias('delete')
    .description('Revoke an API key')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(apiKeysRevokeCommand);

  apiKeys
    .command('rotate-secret <keyId>')
    .description('Rotate the secret for an API key (requires a session login)')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(apiKeysRotateSecretCommand);

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
