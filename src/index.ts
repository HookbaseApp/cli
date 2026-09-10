#!/usr/bin/env node

import { createRequire } from 'module';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import updateNotifier from 'update-notifier';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { forwardCommand } from './commands/forward.js';
import { dashboardCommand } from './commands/dashboard.js';
import { streamCommand } from './commands/stream.js';
import { triggerCommand } from './commands/trigger.js';
import { tunnelsStartCommand } from './commands/tunnels.js';
import { initCommand } from './commands/init.js';
import { registerInboundGroup, registerSourcesCommands, registerDestinationsCommands, registerRoutesCommands, registerTransformsCommands, registerSchemasCommands, registerFiltersCommands, registerNotificationChannelsCommands, registerEventsCommands, registerDeliveriesCommands } from './commands/groups/inbound.js';
import { registerOutboundGroup, registerEndpointsCommands, registerSendCommand, registerDlqCommands } from './commands/groups/outbound.js';
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
import { upgradeCommand } from './commands/upgrade.js';
import {
  orgListCommand,
  orgSwitchCommand,
  orgMembersListCommand,
  orgMembersInviteCommand,
  orgMembersRemoveCommand,
  orgMembersSetRoleCommand,
  orgInvitesListCommand,
  orgInvitesRevokeCommand,
} from './commands/organizations.js';
import { auditLogsListCommand, auditLogsExportCommand } from './commands/audit-logs.js';
import { sessionLoginCommand, sessionLogoutCommand, sessionStatusCommand } from './commands/session.js';
import {
  twoFactorStatusCommand,
  twoFactorSetupCommand,
  twoFactorVerifyCommand,
  twoFactorDisableCommand,
  twoFactorRecoveryCodesCommand,
} from './commands/twofactor.js';
import * as config from './lib/config.js';
import * as logger from './lib/logger.js';
import { formatOutput } from './lib/output.js';

// ============================================================================
// Update Notification
// ============================================================================
// Throttled, cached, non-blocking check (a detached background process does the
// actual npm-registry lookup). Only prints when a newer version is cached, on an
// interactive TTY. update-notifier already suppresses itself in CI, when stdout
// is not a TTY, and when NO_UPDATE_NOTIFIER / --no-update-notifier is set. We
// additionally skip it for machine-readable (--json) output and for the
// `upgrade`/`update` command itself (which reports versions on its own).
{
  // The root program's options (--json, -y/--yes) are all boolean, so the first
  // non-dash argv token is the invoked subcommand. Match on that rather than
  // `includes()` so we don't suppress the notice for e.g. `applications update`.
  const argv = process.argv.slice(2);
  const subcommand = argv.find((a) => !a.startsWith('-'));
  const suppress =
    argv.includes('--json') || subcommand === 'upgrade' || subcommand === 'update';
  if (!suppress) {
    try {
      const notifier = updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 });
      if (notifier.update) {
        notifier.notify({
          defer: false,
          isGlobal: true,
          message:
            `Update available ${logger.dimText(notifier.update.current)} → ${logger.green(notifier.update.latest)}\n` +
            `Run ${logger.cyan('hookbase upgrade')} to update`,
        });
      }
    } catch {
      // Never let an update check interfere with the CLI.
    }
  }
}

const program = new Command();

// Positional options: an option only binds to the command it's declared on if
// it appears after that command's name on the CLI. Without this, Commander's
// default (non-positional) parsing greedily grabs any flag that matches an
// ancestor's own option set — since --json/-y are declared both here on the
// root AND locally on almost every subcommand (for per-command --help text),
// the root was silently swallowing the value before subcommands ever saw it,
// e.g. `hookbase whoami --json` printed human text, not JSON.
program.enablePositionalOptions();

program
  .name('hookbase')
  .description('CLI tool for Hookbase - manage webhooks and localhost tunnels')
  .version(pkg.version)
  .option('--json', 'Output as JSON (for scripting)')
  .option('--xml', 'Output as XML (for scripting)')
  .option('--yaml', 'Output as YAML (for scripting)')
  .option('-y, --yes', 'Skip confirmation prompts');

// ============================================================================
// Authentication Commands
// ============================================================================

program
  .command('login')
  .description('Authenticate with Hookbase (prompts to choose a web browser or an API key)')
  .option('-w, --web', 'Log in with a web browser, skipping the prompt')
  .option('--with-token', 'Log in with an API key, skipping the prompt')
  .action(loginCommand);

program
  .command('logout')
  .description('Log out and clear stored credentials')
  .action(logoutCommand);

program
  .command('status')
  .description('Show Hookbase platform status (API, ingestion, delivery, etc.)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(statusCommand);

program
  .command('whoami')
  .description('Show current authentication status (API key and session)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action((options) => {
    const apiKeyAuthenticated = config.isAuthenticated();
    const user = apiKeyAuthenticated ? config.getCurrentUser() : null;
    const org = config.getCurrentOrg();
    const sessionUser = config.hasSession() ? config.getSessionUser() : null;

    if (options.json || options.xml || options.yaml) {
      console.log(formatOutput({
        authenticated: apiKeyAuthenticated,
        user,
        organization: org,
        session: sessionUser ? { authenticated: true, user: sessionUser } : { authenticated: false },
      }, options.xml, options.yaml));
      return;
    }

    if (!apiKeyAuthenticated && !sessionUser) {
      logger.info('Not logged in');
      logger.dim('Run "hookbase login" to authenticate');
      return;
    }

    logger.log('');
    logger.log(logger.bold('Hookbase CLI Status'));
    logger.log('');

    // Only show sections that are actually authenticated — a user who only
    // ever uses one method doesn't need to see the other flagged as "not
    // logged in" every time. Both show if both happen to be active.
    if (apiKeyAuthenticated) {
      logger.log(logger.bold('API key auth:'));
      logger.log(`  User:         ${user?.email || 'API key authentication'}`);
      if (user?.displayName) {
        logger.log(`  Display Name: ${user.displayName}`);
      }
      logger.log(`  Organization: ${org?.slug || 'none'}`);
    }
    if (apiKeyAuthenticated && sessionUser) {
      logger.log('');
    }
    if (sessionUser) {
      logger.log(logger.bold('Session auth:'));
      logger.log(`  User:         ${sessionUser.email}`);
      logger.log(`  Display Name: ${sessionUser.displayName}`);
    }
    logger.log('');
    logger.dim(`Config: ${config.getConfigPath()}`);
  });

// ============================================================================
// Organization Commands
// ============================================================================

const org = program
  .command('org')
  .description('Manage organizations');

org
  .command('list')
  .alias('ls')
  .description('List your organizations')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgListCommand);

org
  .command('switch <idOrSlug>')
  .description('Switch the active organization (accepts ID, slug, or name)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgSwitchCommand);

const orgMembers = org
  .command('members')
  .description('Manage organization members');

orgMembers
  .command('list')
  .alias('ls')
  .description('List organization members')
  .option('--org <orgId>', 'Organization ID (defaults to the current organization)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgMembersListCommand);

orgMembers
  .command('invite')
  .description('Invite a new member')
  .option('-e, --email <email>', 'Email address to invite')
  .option('-r, --role <role>', 'Role: admin, member, or viewer')
  .option('--org <orgId>', 'Organization ID (defaults to the current organization)')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgMembersInviteCommand);

orgMembers
  .command('remove <userId>')
  .alias('rm')
  .description('Remove a member from the organization')
  .option('--org <orgId>', 'Organization ID (defaults to the current organization)')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgMembersRemoveCommand);

orgMembers
  .command('set-role <userId> <role>')
  .description('Change a member\'s role (admin, member, or viewer)')
  .option('--org <orgId>', 'Organization ID (defaults to the current organization)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgMembersSetRoleCommand);

const orgInvites = org
  .command('invites')
  .description('Manage pending organization invites');

orgInvites
  .command('list')
  .alias('ls')
  .description('List pending invites')
  .option('--org <orgId>', 'Organization ID (defaults to the current organization)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgInvitesListCommand);

orgInvites
  .command('revoke <inviteId>')
  .description('Revoke a pending invite')
  .option('--org <orgId>', 'Organization ID (defaults to the current organization)')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(orgInvitesRevokeCommand);

// ============================================================================
// Audit Logs Commands
// ============================================================================

const auditLogs = program
  .command('audit-logs')
  .description('View and export organization audit logs');

auditLogs
  .command('list')
  .alias('ls')
  .description('List audit log entries')
  .option('-a, --action <action>', 'Filter by action')
  .option('-e, --entity-type <type>', 'Filter by entity type')
  .option('-u, --user-id <userId>', 'Filter by user ID')
  .option('-l, --limit <number>', 'Number of entries to show', '50')
  .option('-o, --offset <number>', 'Offset for pagination')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(auditLogsListCommand);

auditLogs
  .command('export')
  .description('Export audit logs as CSV')
  .option('-o, --output <path>', 'Write CSV to a file instead of stdout')
  .action(auditLogsExportCommand);

// ============================================================================
// Session (JWT device-auth) Commands
// ============================================================================

const session = program
  .command('session')
  .description('Manage a browser-authenticated session (required for 2FA, org member management, API key rotation)');

session
  .command('login')
  .description('Log in with a session via the device authorization flow')
  .action(sessionLoginCommand);

session
  .command('logout')
  .description('Clear the stored session')
  .action(sessionLogoutCommand);

session
  .command('status')
  .description('Show current session status')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(sessionStatusCommand);

// ============================================================================
// Two-Factor Authentication (2FA/TOTP) Commands
// ============================================================================

const twoFactor = program
  .command('2fa')
  .description('Manage two-factor authentication (requires a session login)');

twoFactor
  .command('status')
  .description('Show whether 2FA is enabled')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(twoFactorStatusCommand);

twoFactor
  .command('setup')
  .description('Start 2FA setup (prints a QR/otpauth URL and manual-entry secret)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(twoFactorSetupCommand);

twoFactor
  .command('verify <code>')
  .description('Verify a code to finish enabling 2FA (prints recovery codes once)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(twoFactorVerifyCommand);

twoFactor
  .command('disable')
  .description('Disable 2FA (prompts for a current code and your password)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(twoFactorDisableCommand);

twoFactor
  .command('recovery-codes <code>')
  .description('Regenerate recovery codes (invalidates old ones)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(twoFactorRecoveryCodesCommand);

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

program
  .command('stream')
  .description('Stream live events/deliveries in real time (SSE)')
  .option('-o, --outbound', 'Stream outbound messages/deliveries instead of inbound events')
  .option('-s, --source <sourceId>', 'Filter inbound events by source ID')
  .option('-a, --application <applicationId>', 'Filter outbound messages by application ID (--outbound only)')
  .option('-e, --endpoint <endpointId>', 'Filter outbound messages by endpoint ID (--outbound only)')
  .option('--json', 'Emit newline-delimited JSON instead of formatted text')
  .action(streamCommand);

program
  .command('listen <port>')
  .description('Listen for webhook events forwarded to localhost (alias for tunnels start)')
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

program
  .command('init')
  .description('Scaffold a webhook handler project (express, fastify, hono, nextjs, cloudflare-worker)')
  .option('--framework <name>', 'Framework: express, fastify, hono, nextjs, cloudflare-worker')
  .option('--provider <id>', 'Signature provider: stripe, github, shopify, slack, custom')
  .option('--dir <path>', 'Output directory', './hookbase-handler')
  .option('--source <id>', 'Source ID (used to inject ingest URL into README)')
  .option('--force', 'Overwrite existing directory contents')
  .action(initCommand);

program
  .command('trigger')
  .description('Send a test webhook event to a source (signs payload by default)')
  .option('-s, --source <id>', 'Source ID or slug')
  .option('--provider <id>', 'Provider catalog ID (e.g., stripe, github, shopify)')
  .option('-e, --event <type>', 'Event type (e.g., payment_intent.succeeded)')
  .option('-p, --payload <json>', 'Custom JSON payload (overrides provider sample)')
  .option('-f, --file <path>', 'Load payload from a JSON file')
  .option('--no-sign', 'Skip signing the payload')
  .option('--print', 'Print the would-be payload and exit (no request sent)')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(triggerCommand);

// ============================================================================
// Self-Update
// ============================================================================

program
  .command('upgrade')
  .alias('update')
  .description('Update the CLI to the latest published version')
  .option('--check', 'Only check whether a newer version is available')
  .option('--dry-run', 'Print the command that would run without executing it')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .action(upgradeCommand);

// ============================================================================
// Configuration Commands
// ============================================================================

program
  .command('config')
  .description('Show configuration')
  .option('--json', 'Output as JSON')
  .option('--xml', 'Output as XML')
  .option('--yaml', 'Output as YAML')
  .option('--path', 'Show config file path only')
  .action((options) => {
    if (options.path) {
      console.log(config.getConfigPath());
      return;
    }

    if (options.json || options.xml || options.yaml) {
      console.log(formatOutput(config.getAllConfig(), options.xml, options.yaml));
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
hide(registerTransformsCommands(program));
hide(registerSchemasCommands(program));
hide(registerFiltersCommands(program));
hide(registerNotificationChannelsCommands(program));
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(applicationsCreateCommand);

  apps
    .command('get <appId>')
    .alias('show')
    .description('Get application details')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(applicationsUpdateCommand);

  apps
    .command('delete <appId>')
    .alias('rm')
    .description('Delete an application')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(outboundListCommand);

  messages
    .command('get <messageId>')
    .alias('show')
    .description('Get message details')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
    .action(outboundGetCommand);

  messages
    .command('retry <messageId>')
    .description('Retry a failed message')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .option('--xml', 'Output as XML')
    .option('--yaml', 'Output as YAML')
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
    transforms    Manage payload transforms (JSONata, JavaScript, …)
    schemas       Manage JSON Schema payload validation
    filters       Manage reusable event filters
    channels      Manage notification channels (Slack, email, webhook, …)
    events        View webhook events
    deliveries    View and manage deliveries

  outbound      Outbound webhook management
    applications  Manage webhook applications
    endpoints     Manage webhook endpoints
    send          Send a webhook event
    messages      View outbound messages
    dlq           Manage Dead Letter Queue
    stats         Show outbound delivery stats summary and DLQ breakdown

  tools         Developer tools
    cron          Manage cron jobs (also: cron groups)
    tunnels       Manage localhost tunnels
    api-keys      Manage API keys

  org           Manage organizations, members, and invites
  session       Browser-authenticated session (2FA, member mgmt, key rotation)
  2fa           Manage two-factor authentication
  audit-logs    View and export organization audit logs

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

export { program };

// Parse arguments — guarded so importing this module (e.g. from tests) doesn't
// also parse process.argv and dispatch a command. Real-world global installs
// (npm link, npm install -g, volta, pnpm, yarn global) all invoke through a
// bin symlink, so process.argv[1] is the symlink path while import.meta.url
// is already resolved to the real file — realpathSync() on both sides before
// comparing so the guard matches in that case too, not just direct `node
// dist/index.js` invocation.
function isMainModule(): boolean {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  program.parse();
}
