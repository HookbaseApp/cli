import type { Command } from 'commander';
import {
  applicationsListCommand,
  applicationsCreateCommand,
  applicationsGetCommand,
  applicationsUpdateCommand,
  applicationsDeleteCommand,
} from '../applications.js';
import {
  endpointsListCommand,
  endpointsCreateCommand,
  endpointsGetCommand,
  endpointsUpdateCommand,
  endpointsDeleteCommand,
  endpointsTestCommand,
  endpointsRotateSecretCommand,
} from '../endpoints.js';
import { sendCommand } from '../send.js';
import {
  outboundListCommand,
  outboundGetCommand,
  outboundRetryCommand,
  dlqListCommand,
  dlqGetCommand,
  dlqRetryCommand,
  dlqBulkRetryCommand,
  dlqDeleteCommand,
} from '../outbound.js';

export function registerWebhooksCommands(parent: Command): Command {
  const webhooks = parent
    .command('applications')
    .alias('webhooks')
    .description('Manage webhook applications');

  webhooks
    .command('list')
    .alias('ls')
    .description('List all webhook applications')
    .option('--json', 'Output as JSON')
    .action(applicationsListCommand);

  webhooks
    .command('create')
    .description('Create a new webhook application')
    .option('-n, --name <name>', 'Application name')
    .option('-u, --uid <uid>', 'Custom UID (for your reference)')
    .option('-d, --description <description>', 'Description')
    .option('-r, --rate-limit <limit>', 'Rate limit per minute')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(applicationsCreateCommand);

  webhooks
    .command('get <appId>')
    .alias('show')
    .description('Get application details')
    .option('--json', 'Output as JSON')
    .action(applicationsGetCommand);

  webhooks
    .command('update <appId>')
    .description('Update an application')
    .option('-n, --name <name>', 'New name')
    .option('-d, --description <description>', 'New description')
    .option('-r, --rate-limit <limit>', 'New rate limit')
    .option('--active', 'Set application as active')
    .option('--inactive', 'Set application as inactive')
    .option('--json', 'Output as JSON')
    .action(applicationsUpdateCommand);

  webhooks
    .command('delete <appId>')
    .alias('rm')
    .description('Delete an application')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(applicationsDeleteCommand);

  return webhooks;
}

export function registerEndpointsCommands(parent: Command): Command {
  const endpoints = parent
    .command('endpoints')
    .description('Manage webhook endpoints');

  endpoints
    .command('list')
    .alias('ls')
    .description('List all webhook endpoints')
    .option('-a, --app <appId>', 'Filter by application')
    .option('--json', 'Output as JSON')
    .action(endpointsListCommand);

  endpoints
    .command('create')
    .description('Create a new webhook endpoint')
    .option('-a, --app <appId>', 'Application ID')
    .option('-u, --url <url>', 'Endpoint URL')
    .option('-d, --description <description>', 'Description')
    .option('-e, --event-types <types>', 'Comma-separated event types (default: *)')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds')
    .option('-r, --rate-limit <limit>', 'Rate limit per minute')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(endpointsCreateCommand);

  endpoints
    .command('get <endpointId>')
    .alias('show')
    .description('Get endpoint details')
    .option('--json', 'Output as JSON')
    .action(endpointsGetCommand);

  endpoints
    .command('update <endpointId>')
    .description('Update an endpoint')
    .option('-u, --url <url>', 'New URL')
    .option('-d, --description <description>', 'New description')
    .option('-e, --event-types <types>', 'New event types')
    .option('-t, --timeout <ms>', 'New timeout')
    .option('-r, --rate-limit <limit>', 'New rate limit')
    .option('--active', 'Set endpoint as active')
    .option('--inactive', 'Set endpoint as inactive')
    .option('--json', 'Output as JSON')
    .action(endpointsUpdateCommand);

  endpoints
    .command('delete <endpointId>')
    .alias('rm')
    .description('Delete an endpoint')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(endpointsDeleteCommand);

  endpoints
    .command('test <endpointId>')
    .description('Test an endpoint with a sample webhook')
    .option('--json', 'Output as JSON')
    .action(endpointsTestCommand);

  endpoints
    .command('rotate-secret <endpointId>')
    .description('Rotate the signing secret for an endpoint')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(endpointsRotateSecretCommand);

  return endpoints;
}

export function registerSendCommand(parent: Command): Command {
  const send = parent
    .command('send')
    .description('Send a webhook event to endpoints')
    .option('-a, --app <appId>', 'Application ID')
    .option('-e, --event-type <type>', 'Event type (e.g., user.created)')
    .option('-p, --payload <json>', 'JSON payload')
    .option('-f, --file <path>', 'Read payload from file')
    .option('--endpoints <ids>', 'Comma-separated endpoint IDs (default: all)')
    .option('--json', 'Output as JSON')
    .action(sendCommand);

  return send;
}

export function registerMessagesCommands(parent: Command): Command {
  const messages = parent
    .command('messages')
    .description('View and manage outbound webhook messages');

  messages
    .command('list')
    .alias('ls')
    .description('List outbound messages')
    .option('-a, --app <appId>', 'Filter by application')
    .option('-e, --endpoint <endpointId>', 'Filter by endpoint')
    .option('-s, --status <status>', 'Filter by status (pending, delivered, failed, exhausted)')
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

  return messages;
}

export function registerDlqCommands(parent: Command): Command {
  const dlq = parent
    .command('dlq')
    .description('Manage Dead Letter Queue messages');

  dlq
    .command('list')
    .alias('ls')
    .description('List DLQ messages')
    .option('-a, --app <appId>', 'Filter by application')
    .option('-e, --endpoint <endpointId>', 'Filter by endpoint')
    .option('-l, --limit <number>', 'Number of messages to show', '50')
    .option('--json', 'Output as JSON')
    .action(dlqListCommand);

  dlq
    .command('get <messageId>')
    .alias('show')
    .description('Get DLQ message details')
    .option('--json', 'Output as JSON')
    .action(dlqGetCommand);

  dlq
    .command('retry <messageId>')
    .description('Retry a DLQ message')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(dlqRetryCommand);

  dlq
    .command('bulk-retry')
    .description('Retry multiple DLQ messages')
    .option('-a, --app <appId>', 'Filter by application')
    .option('-e, --endpoint <endpointId>', 'Filter by endpoint')
    .option('-l, --limit <number>', 'Max messages to retry', '50')
    .option('-y, --yes', 'Skip confirmation (retry all)')
    .option('--json', 'Output as JSON')
    .action(dlqBulkRetryCommand);

  dlq
    .command('delete <messageId>')
    .alias('rm')
    .description('Delete a DLQ message')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(dlqDeleteCommand);

  return dlq;
}

export function registerOutboundGroup(parent: Command): Command {
  const outbound = parent
    .command('outbound')
    .description('Outbound webhook management (webhooks, endpoints, send, messages, dlq)');

  registerWebhooksCommands(outbound);
  registerEndpointsCommands(outbound);
  registerSendCommand(outbound);
  registerMessagesCommands(outbound);
  registerDlqCommands(outbound);

  // Hidden backward-compat: `hookbase outbound list/get/retry` still works
  // (these were the old direct subcommands of `outbound`)
  outbound
    .command('list', { hidden: true })
    .option('-a, --app <appId>', 'Filter by application')
    .option('-e, --endpoint <endpointId>', 'Filter by endpoint')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --event-type <type>', 'Filter by event type')
    .option('-l, --limit <number>', 'Number of messages to show', '50')
    .option('--json', 'Output as JSON')
    .action(outboundListCommand);

  outbound
    .command('get <messageId>', { hidden: true })
    .option('--json', 'Output as JSON')
    .action(outboundGetCommand);

  outbound
    .command('retry <messageId>', { hidden: true })
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(outboundRetryCommand);

  return outbound;
}
