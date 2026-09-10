import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { formatOutput } from '../lib/output.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

/** Org list/switch just read `/api/auth/me`, which the API accepts via either
 * an API key or a session — so unlike most commands, these shouldn't force
 * API-key auth specifically. */
function requireAnyAuth(): boolean {
  if (config.isAuthenticated() || config.hasSession()) {
    return true;
  } else {
    logger.error('Not logged in. Run "hookbase login"');
  }
  process.exit(1);
}

function requireSessionAuth(): boolean {
  if (!config.hasSession()) {
    logger.error('Not logged in with a session. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

export async function orgListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAnyAuth();

  const spinner = logger.spinner('Fetching organizations...');
  const result = await api.getMe();

  if (result.error || !result.data) {
    spinner.fail('Failed to fetch organizations');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  const organizations = result.data.organizations || [];
  const currentOrgId = config.getCurrentOrg()?.id;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(
      organizations.map((org) => ({ ...org, current: org.id === currentOrgId })), options.xml, options.yaml));
    return;
  }

  if (organizations.length === 0) {
    logger.info('No organizations found');
    return;
  }

  logger.table(
    ['', 'ID', 'Name', 'Slug', 'Plan'],
    organizations.map((org) => [
      org.id === currentOrgId ? logger.green('*') : '',
      org.id,
      org.name,
      org.slug,
      org.plan,
    ])
  );

  logger.log('');
  logger.dim('Switch organizations with "hookbase org switch <idOrSlug>"');
}

export async function orgSwitchCommand(
  idOrSlug: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAnyAuth();

  const spinner = logger.spinner('Fetching organizations...');
  const result = await api.getMe();

  if (result.error || !result.data) {
    spinner.fail('Failed to fetch organizations');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  const organizations = result.data.organizations || [];
  const match = organizations.find(
    (org) => org.id === idOrSlug || org.slug === idOrSlug || org.name === idOrSlug
  );

  if (!match) {
    logger.error(`Organization "${idOrSlug}" not found`);
    logger.dim('Run "hookbase org list" to see available organizations');
    return;
  }

  config.setCurrentOrg(match.id, match.slug);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, organization: match }, options.xml, options.yaml));
    return;
  }

  logger.success(`Switched to organization "${match.name}" (${match.slug})`);
}

export async function orgMembersListCommand(options: { org?: string; json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner('Fetching members...');
  const result = await api.getOrgMembers(options.org);

  if (result.error || !result.data) {
    spinner.fail('Failed to fetch members');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  const members = result.data.members || [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(members, options.xml, options.yaml));
    return;
  }

  if (members.length === 0) {
    logger.info('No members found');
    return;
  }

  logger.table(
    ['Email', 'Name', 'Role', 'Joined'],
    members.map((m) => [
      m.email,
      m.displayName || '-',
      m.role,
      m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '-',
    ])
  );
}

export async function orgMembersInviteCommand(options: {
  email?: string;
  role?: string;
  org?: string;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireSessionAuth();

  let email = options.email;
  let role = options.role;

  try {
    if (!email) {
      email = await input({
        message: 'Email address:',
        validate: (value) => value.includes('@') || 'Enter a valid email',
      });
    }

    if (!role) {
      role = await select({
        message: 'Role:',
        choices: [
          { name: 'Admin', value: 'admin' },
          { name: 'Member', value: 'member' },
          { name: 'Viewer', value: 'viewer' },
        ],
      });
    }

    if (!options.yes && !options.email) {
      const confirmed = await confirm({
        message: `Invite ${email} as ${role}?`,
        default: true,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Sending invite...');
  const result = await api.inviteOrgMember(email!, role!, options.org);

  if (result.error) {
    spinner.fail('Failed to invite member');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Invite sent');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  logger.success(`Invited ${email} as ${role}`);
}

export async function orgMembersRemoveCommand(
  userId: string,
  options: { org?: string; yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireSessionAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Remove member ${userId} from the organization?`,
        default: false,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Removing member...');
  const result = await api.removeOrgMember(userId, options.org);

  if (result.error) {
    spinner.fail('Failed to remove member');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Member removed');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, userId }, options.xml, options.yaml));
  }
}

export async function orgMembersSetRoleCommand(
  userId: string,
  role: string,
  options: { org?: string; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner(`Setting role to ${role}...`);
  const result = await api.updateOrgMemberRole(userId, role, options.org);

  if (result.error) {
    spinner.fail('Failed to update role');
    logger.error(result.error);
    return;
  }

  spinner.succeed(`Role updated to ${role}`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, userId, role }, options.xml, options.yaml));
  }
}

export async function orgInvitesListCommand(options: { org?: string; json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner('Fetching invites...');
  const result = await api.listOrgInvites(options.org);

  if (result.error || !result.data) {
    spinner.fail('Failed to fetch invites');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  const invites = result.data.invites || [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(invites, options.xml, options.yaml));
    return;
  }

  if (invites.length === 0) {
    logger.info('No pending invites');
    return;
  }

  logger.table(
    ['ID', 'Email', 'Role', 'Expires'],
    invites.map((inv) => [
      inv.id,
      inv.email,
      inv.role,
      inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '-',
    ])
  );
}

export async function orgInvitesRevokeCommand(
  inviteId: string,
  options: { org?: string; yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireSessionAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Revoke invite ${inviteId}?`,
        default: false,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Revoking invite...');
  const result = await api.deleteOrgInvite(inviteId, options.org);

  if (result.error) {
    spinner.fail('Failed to revoke invite');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Invite revoked');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, inviteId }, options.xml, options.yaml));
  }
}
