import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { eventsFollowCommand } from './events.js';

export async function logsCommand(options: { limit?: string; follow?: boolean }): Promise<void> {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }

  const limit = parseInt(options.limit || '50', 10);

  if (options.follow) {
    // Delegate to the events follow command
    await eventsFollowCommand({});
    return;
  }

  const spinner = logger.spinner('Fetching events...');
  const result = await api.getEvents({ limit });

  if (result.error) {
    spinner.fail('Failed to fetch events');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const events = result.data?.events || [];

  if (events.length === 0) {
    logger.info('No events found');
    return;
  }

  logger.log(`Showing ${events.length} of ${result.data?.total || 0} events`);
  logger.log('');

  logger.table(
    ['Time', 'Source', 'Event Type', 'Status'],
    events.map(e => [
      new Date(e.received_at).toLocaleString(),
      (e.source_name || e.source_slug || e.source_id || '').slice(0, 20),
      e.event_type || e.method || '-',
      e.status === 'delivered' ? logger.green('delivered') :
        e.status === 'failed' ? logger.red('failed') :
        e.status === 'pending' ? logger.yellow('pending') :
        logger.dimText(e.status || 'unknown'),
    ])
  );

  logger.log('');
  logger.dim('View full event details with "hookbase events get <id>"');
}
