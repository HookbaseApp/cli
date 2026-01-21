import { confirm, checkbox } from '@inquirer/prompts';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function formatStatus(status: string): string {
  switch (status) {
    case 'success':
      return logger.green('success');
    case 'failed':
      return logger.red('failed');
    case 'pending':
      return logger.yellow('pending');
    case 'retrying':
      return logger.yellow('retrying');
    default:
      return logger.dimText(status);
  }
}

export async function deliveriesListCommand(options: {
  limit?: string;
  event?: string;
  route?: string;
  destination?: string;
  status?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching deliveries...');
  const result = await api.getDeliveries({
    limit: options.limit ? parseInt(options.limit, 10) : 50,
    eventId: options.event,
    routeId: options.route,
    destinationId: options.destination,
    status: options.status,
  });

  if (result.error) {
    spinner.fail('Failed to fetch deliveries');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const deliveries = result.data?.deliveries || [];

  if (options.json) {
    console.log(JSON.stringify(deliveries, null, 2));
    return;
  }

  if (deliveries.length === 0) {
    logger.info('No deliveries found');
    return;
  }

  logger.table(
    ['ID', 'Destination', 'Status', 'Response', 'Attempts', 'Time', 'Created'],
    deliveries.map(d => [
      d.id,
      d.destination_name || d.destination_id,
      formatStatus(d.status),
      d.response_status ? String(d.response_status) : '-',
      `${d.attempt_count}/${d.max_attempts}`,
      d.response_time_ms ? `${d.response_time_ms}ms` : '-',
      formatDate(d.created_at),
    ])
  );

  logger.log('');
  logger.dim(`Showing ${deliveries.length} of ${result.data?.total || deliveries.length} deliveries`);
}

export async function deliveriesGetCommand(
  deliveryId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching delivery...');
  const result = await api.getDelivery(deliveryId);

  if (result.error) {
    spinner.fail('Failed to fetch delivery');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const delivery = result.data?.delivery;

  if (options.json) {
    console.log(JSON.stringify(delivery, null, 2));
    return;
  }

  if (!delivery) {
    logger.error('Delivery not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Delivery Details'));
  logger.log('');
  logger.log(`ID:            ${delivery.id}`);
  logger.log(`Event:         ${delivery.event_id}`);
  logger.log(`Route:         ${delivery.route_name || delivery.route_id}`);
  logger.log(`Destination:   ${delivery.destination_name || delivery.destination_id}`);
  logger.log(`Status:        ${formatStatus(delivery.status)}`);
  logger.log(`Attempts:      ${delivery.attempt_count} of ${delivery.max_attempts}`);

  if (delivery.response_status) {
    const statusColor = delivery.response_status >= 200 && delivery.response_status < 300
      ? logger.green
      : delivery.response_status >= 400
        ? logger.red
        : logger.yellow;
    logger.log(`Response:      ${statusColor(String(delivery.response_status))}`);
  }

  if (delivery.response_time_ms) {
    logger.log(`Response Time: ${delivery.response_time_ms}ms`);
  }

  if (delivery.error_message) {
    logger.log(`Error:         ${logger.red(delivery.error_message)}`);
  }

  if (delivery.next_retry_at) {
    logger.log(`Next Retry:    ${formatDate(delivery.next_retry_at)}`);
  }

  logger.log(`Created:       ${formatDate(delivery.created_at)}`);

  if (delivery.completed_at) {
    logger.log(`Completed:     ${formatDate(delivery.completed_at)}`);
  }

  if (delivery.response_body) {
    logger.log('');
    logger.log(logger.bold('Response Body:'));
    try {
      const parsed = JSON.parse(delivery.response_body);
      logger.log(JSON.stringify(parsed, null, 2));
    } catch {
      logger.log(delivery.response_body);
    }
  }
}

export async function deliveriesReplayCommand(
  deliveryId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  if (!options.yes) {
    const confirmed = await confirm({
      message: `Replay delivery ${deliveryId}?`,
      default: true,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const spinner = logger.spinner('Replaying delivery...');
  const result = await api.replayDelivery(deliveryId);

  if (result.error) {
    spinner.fail('Failed to replay delivery');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Delivery replayed');

  if (options.json) {
    console.log(JSON.stringify(result.data?.delivery, null, 2));
    return;
  }

  const delivery = result.data?.delivery;
  if (delivery) {
    logger.log('');
    logger.log(`New delivery ID: ${delivery.id}`);
    logger.log(`Status: ${formatStatus(delivery.status)}`);
  }
}

export async function deliveriesBulkReplayCommand(options: {
  status?: string;
  limit?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  // First fetch failed deliveries
  const spinner = logger.spinner('Fetching failed deliveries...');
  const listResult = await api.getDeliveries({
    status: options.status || 'failed',
    limit: options.limit ? parseInt(options.limit, 10) : 50,
  });

  if (listResult.error) {
    spinner.fail('Failed to fetch deliveries');
    logger.error(listResult.error);
    return;
  }

  spinner.stop();

  const deliveries = listResult.data?.deliveries || [];

  if (deliveries.length === 0) {
    logger.info('No failed deliveries found');
    return;
  }

  // Interactive selection
  let selectedIds: string[];

  if (options.yes) {
    selectedIds = deliveries.map(d => d.id);
  } else {
    selectedIds = await checkbox({
      message: 'Select deliveries to replay:',
      choices: deliveries.map(d => ({
        name: `${d.id} - ${d.destination_name || d.destination_id} - ${d.error_message || 'Failed'}`,
        value: d.id,
        checked: true,
      })),
    });

    if (selectedIds.length === 0) {
      logger.info('No deliveries selected');
      return;
    }

    const confirmed = await confirm({
      message: `Replay ${selectedIds.length} deliveries?`,
      default: true,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const replaySpinner = logger.spinner(`Replaying ${selectedIds.length} deliveries...`);
  const result = await api.bulkReplayDeliveries(selectedIds);

  if (result.error) {
    replaySpinner.fail('Failed to replay deliveries');
    logger.error(result.error);
    return;
  }

  replaySpinner.succeed('Bulk replay completed');

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  logger.log('');
  logger.log(`Replayed: ${logger.green(String(result.data?.replayed || 0))}`);
  if (result.data?.failed) {
    logger.log(`Failed:   ${logger.red(String(result.data.failed))}`);
  }
}
