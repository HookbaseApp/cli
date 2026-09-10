import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';
import { loadFeatures, ensureFeature } from '../lib/advanced.js';
import { promptChannelConfig } from './routes.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

const CHANNEL_TYPES = ['email', 'slack', 'webhook', 'teams', 'pagerduty', 'discord'] as const;

export async function channelsListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching notification channels...');
  const result = await api.getNotificationChannels();
  if (result.error) { spinner.fail('Failed to fetch channels'); logger.error(result.error); return; }
  spinner.stop();
  const channels = (result.data?.channels || []) as any[];
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(channels, options.xml, options.yaml)); return; }
  if (channels.length === 0) { logger.info('No notification channels found'); logger.dim('Create one with "hookbase notification-channels create"'); return; }
  logger.table(
    ['ID', 'Name', 'Type', 'Status'],
    channels.map((ch) => [
      ch.id,
      ch.name,
      ch.type,
      (ch.isActive ?? ch.is_active) ? logger.green('active') : logger.dimText('inactive'),
    ]),
  );
}

export async function channelsCreateCommand(options: {
  name?: string;
  type?: string;
  config?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();
  await loadFeatures();
  if (!ensureFeature('notification_channels', 'Notification channels')) return;

  let name = options.name;
  let type = options.type as api.NotificationChannel['type'] | undefined;
  let channelConfig: Record<string, unknown> | undefined;
  if (options.config) {
    try {
      const parsed = JSON.parse(options.config);
      if (parsed && typeof parsed === 'object') channelConfig = parsed;
      else { logger.error('--config must be a JSON object'); return; }
    } catch { logger.error('--config is not valid JSON'); return; }
  }

  try {
    if (!name) {
      name = await input({ message: 'Channel name:', validate: (v) => v.length > 0 || 'Name is required' });
    }
    if (!type) {
      type = await select({
        message: 'Channel type:',
        choices: CHANNEL_TYPES.map((t) => ({ name: t, value: t })),
      }) as api.NotificationChannel['type'];
    }
    if (!channelConfig) {
      channelConfig = await promptChannelConfig(type);
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }

  if (!(CHANNEL_TYPES as readonly string[]).includes(type!)) {
    logger.error(`Invalid channel type "${type}" (valid: ${CHANNEL_TYPES.join(', ')})`);
    return;
  }

  const spinner = logger.spinner('Creating notification channel...');
  const result = await api.createNotificationChannel({ name: name!, type: type!, config: channelConfig || {} });
  if (result.error) { spinner.fail('Failed to create channel'); logger.error(result.error); return; }
  spinner.succeed('Notification channel created');
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(result.data?.channel, options.xml, options.yaml)); return; }
  const ch = result.data?.channel;
  if (ch) { logger.log(''); logger.box('Channel Created', [`ID:   ${ch.id}`, `Name: ${ch.name}`, `Type: ${ch.type}`].join('\n')); }
}

export async function channelsGetCommand(channelId: string, options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching notification channel...');
  const result = await api.getNotificationChannel(channelId);
  if (result.error) { spinner.fail('Failed to fetch channel'); logger.error(result.error); return; }
  spinner.stop();
  const ch = result.data?.channel as any;
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(ch, options.xml, options.yaml)); return; }
  if (!ch) { logger.error('Notification channel not found'); return; }
  logger.log('');
  logger.log(logger.bold('Notification Channel Details'));
  logger.log('');
  logger.log(`ID:     ${ch.id}`);
  logger.log(`Name:   ${ch.name}`);
  logger.log(`Type:   ${ch.type}`);
  logger.log(`Status: ${(ch.isActive ?? ch.is_active) ? logger.green('active') : logger.dimText('inactive')}`);
  logger.log('');
  logger.log('Config:');
  logger.log(JSON.stringify(ch.config ?? {}, null, 2));
  logger.log('');
}

export async function channelsUpdateCommand(channelId: string, options: {
  name?: string;
  config?: string;
  active?: boolean;
  inactive?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const updateData: { name?: string; config?: Record<string, unknown>; isActive?: boolean } = {};
  if (options.name) updateData.name = options.name;
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;
  if (options.config) {
    try {
      const parsed = JSON.parse(options.config);
      if (parsed && typeof parsed === 'object') updateData.config = parsed;
      else { logger.error('--config must be a JSON object'); return; }
    } catch { logger.error('--config is not valid JSON'); return; }
  }

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --config, --active, or --inactive');
    return;
  }

  const spinner = logger.spinner('Updating notification channel...');
  const result = await api.updateNotificationChannel(channelId, updateData);
  if (result.error) { spinner.fail('Failed to update channel'); logger.error(result.error); return; }
  spinner.succeed('Notification channel updated');
  if (options.json || options.xml || options.yaml) console.log(formatOutput(result.data, options.xml, options.yaml));
}

export async function channelsTestCommand(channelId: string, options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Sending test notification...');
  const result = await api.testNotificationChannel(channelId);
  if (result.error) { spinner.fail('Failed to send test notification'); logger.error(result.error); return; }
  if (result.data?.success) {
    spinner.succeed(result.data.message || 'Test notification sent successfully');
  } else {
    spinner.fail(result.data?.error || 'Test notification failed');
  }
  if (options.json || options.xml || options.yaml) console.log(formatOutput(result.data, options.xml, options.yaml));
}

export async function channelsRoutesListCommand(channelId: string, options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching linked routes...');
  const result = await api.getNotificationChannelRoutes(channelId);
  if (result.error) { spinner.fail('Failed to fetch linked routes'); logger.error(result.error); return; }
  spinner.stop();
  const routes = result.data?.routes || [];
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(routes, options.xml, options.yaml)); return; }
  if (routes.length === 0) { logger.info('No routes linked to this channel'); return; }
  logger.table(
    ['Route ID', 'Route Name', 'On Failure', 'On Success', 'On Recovery', 'On Circuit Open'],
    routes.map((r) => [
      r.routeId,
      r.routeName,
      r.notifyOnFailure ? 'yes' : 'no',
      r.notifyOnSuccess ? 'yes' : 'no',
      r.notifyOnRecovery ? 'yes' : 'no',
      r.notifyOnCircuitOpen ? 'yes' : 'no',
    ]),
  );
}

export async function channelsRoutesUpdateCommand(channelId: string, routeId: string, options: {
  onFailure?: boolean;
  offFailure?: boolean;
  onSuccess?: boolean;
  offSuccess?: boolean;
  onRecovery?: boolean;
  offRecovery?: boolean;
  onCircuitOpen?: boolean;
  offCircuitOpen?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const updateData: {
    notifyOnFailure?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnRecovery?: boolean;
    notifyOnCircuitOpen?: boolean;
  } = {};
  if (options.onFailure) updateData.notifyOnFailure = true;
  if (options.offFailure) updateData.notifyOnFailure = false;
  if (options.onSuccess) updateData.notifyOnSuccess = true;
  if (options.offSuccess) updateData.notifyOnSuccess = false;
  if (options.onRecovery) updateData.notifyOnRecovery = true;
  if (options.offRecovery) updateData.notifyOnRecovery = false;
  if (options.onCircuitOpen) updateData.notifyOnCircuitOpen = true;
  if (options.offCircuitOpen) updateData.notifyOnCircuitOpen = false;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --on-failure/--off-failure, --on-success/--off-success, --on-recovery/--off-recovery, or --on-circuit-open/--off-circuit-open');
    return;
  }

  const spinner = logger.spinner('Updating route link...');
  const result = await api.updateNotificationChannelRouteLink(channelId, routeId, updateData);
  if (result.error) { spinner.fail('Failed to update route link'); logger.error(result.error); return; }
  spinner.succeed('Route link updated');
  if (options.json || options.xml || options.yaml) console.log(formatOutput(result.data, options.xml, options.yaml));
}

export async function channelsRoutesUnlinkCommand(channelId: string, routeId: string, options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  try {
    if (!options.yes) {
      const confirmed = await confirm({ message: `Unlink route ${routeId} from channel ${channelId}?`, default: false });
      if (!confirmed) { logger.info('Cancelled'); return; }
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }
  const spinner = logger.spinner('Unlinking route...');
  const result = await api.unlinkNotificationChannelRoute(channelId, routeId);
  if (result.error) { spinner.fail('Failed to unlink route'); logger.error(result.error); return; }
  spinner.succeed('Route unlinked');
  if (options.json || options.xml || options.yaml) console.log(formatOutput({ success: true, channelId, routeId }, options.xml, options.yaml));
}

export async function channelsLinkCommand(channelId: string, options: {
  route?: string;
  onFailure?: boolean;
  onSuccess?: boolean;
  onRecovery?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  let routeId = options.route;
  try {
    if (!routeId) {
      const routes = (await api.getRoutes()).data?.routes || [];
      if (routes.length === 0) { logger.error('No routes found to link'); return; }
      routeId = await select({ message: 'Link to route:', choices: routes.map((r: any) => ({ name: `${r.name} (${r.id})`, value: r.id })) });
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }

  const spinner = logger.spinner('Linking channel to route...');
  const result = await api.linkNotificationChannel(channelId, {
    routeId: routeId!,
    notifyOnFailure: options.onFailure ?? true,
    notifyOnSuccess: options.onSuccess ?? false,
    notifyOnRecovery: options.onRecovery ?? true,
  });
  if (result.error) { spinner.fail('Failed to link channel'); logger.error(result.error); return; }
  spinner.succeed('Channel linked to route');
  if (options.json || options.xml || options.yaml) console.log(formatOutput({ success: true, channelId, routeId }, options.xml, options.yaml));
}

export async function channelsDeleteCommand(channelId: string, options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  try {
    if (!options.yes) {
      const confirmed = await confirm({ message: `Delete notification channel ${channelId}? This cannot be undone.`, default: false });
      if (!confirmed) { logger.info('Cancelled'); return; }
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }
  const spinner = logger.spinner('Deleting notification channel...');
  const result = await api.deleteNotificationChannel(channelId);
  if (result.error) { spinner.fail('Failed to delete channel'); logger.error(result.error); return; }
  spinner.succeed('Notification channel deleted');
  if (options.json || options.xml || options.yaml) console.log(formatOutput({ success: true, channelId }, options.xml, options.yaml));
}
