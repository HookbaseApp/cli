import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { loadFeatures, ensureFeature } from '../lib/advanced.js';
import { promptChannelConfig } from './routes.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

function requireAuth(): void {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" with an API key.');
    process.exit(1);
  }
}

const CHANNEL_TYPES = ['email', 'slack', 'webhook', 'teams', 'pagerduty', 'discord'] as const;

export async function channelsListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching notification channels...');
  const result = await api.getNotificationChannels();
  if (result.error) { spinner.fail('Failed to fetch channels'); logger.error(result.error); return; }
  spinner.stop();
  const channels = (result.data?.channels || []) as any[];
  if (options.json) { console.log(JSON.stringify(channels, null, 2)); return; }
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
  if (options.json) { console.log(JSON.stringify(result.data?.channel, null, 2)); return; }
  const ch = result.data?.channel;
  if (ch) { logger.log(''); logger.box('Channel Created', [`ID:   ${ch.id}`, `Name: ${ch.name}`, `Type: ${ch.type}`].join('\n')); }
}

export async function channelsLinkCommand(channelId: string, options: {
  route?: string;
  onFailure?: boolean;
  onSuccess?: boolean;
  onRecovery?: boolean;
  json?: boolean;
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
  if (options.json) console.log(JSON.stringify({ success: true, channelId, routeId }, null, 2));
}

export async function channelsDeleteCommand(channelId: string, options: { yes?: boolean; json?: boolean }): Promise<void> {
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
  if (options.json) console.log(JSON.stringify({ success: true, channelId }, null, 2));
}
