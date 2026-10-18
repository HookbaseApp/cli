import { confirm, checkbox } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

function formatStatus(status: string): string {
  switch (status) {
    // Outbound messages use `success`; `delivered` kept for forward-compat.
    case 'success': return logger.green('success');
    case 'delivered': return logger.green('delivered');
    case 'pending': return logger.yellow('pending');
    case 'awaiting_retry': return logger.yellow('awaiting_retry');
    case 'processing': return logger.cyan('processing');
    case 'failed': return logger.red('failed');
    case 'exhausted': return logger.red('exhausted');
    case 'dlq': return logger.red('dlq');
    default: return logger.dimText(status);
  }
}

/** `--limit` as a positive integer, or null (after logging) when it isn't one. */
function parseLimit(value: string | undefined, fallback = 50): number | null {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    logger.error('--limit must be a positive whole number');
    return null;
  }
  return n;
}

// ============================================================================
// Messages Commands
// ============================================================================

export async function outboundListCommand(options: {
  app?: string;
  endpoint?: string;
  status?: string;
  eventType?: string;
  limit?: string;
  cursor?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const limit = parseLimit(options.limit);
  if (limit === null) return;

  // The API caps a page at 100, so a larger --limit follows nextCursor across pages.
  const spinner = logger.spinner('Fetching messages...');
  const result = await api.collectPages(
    (page) => api.getWebhookMessages({
      applicationId: options.app,
      endpointId: options.endpoint,
      status: options.status,
      eventType: options.eventType,
      ...page,
    }),
    { max: limit, cursor: options.cursor }
  );

  if (result.error) {
    spinner.fail('Failed to fetch messages');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const messages = result.data?.data ?? [];
  const pagination = result.data?.pagination ?? { hasMore: false, nextCursor: null };

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({
      messages,
      hasMore: pagination.hasMore,
      nextCursor: pagination.nextCursor,
    }, options.xml, options.yaml));
    return;
  }

  if (messages.length === 0) {
    logger.info('No outbound messages found');
    logger.dim('Send webhook events with "hookbase outbound send"');
    return;
  }

  logger.table(
    ['ID', 'Event Type', 'Status', 'Attempts', 'Created'],
    messages.map((m) => [
      m.id.substring(0, 12) + '...',
      m.eventType,
      formatStatus(m.status),
      `${m.attempts ?? 0}/${m.maxAttempts ?? 5}`,
      new Date(m.createdAt).toLocaleString(),
    ])
  );

  if (pagination.hasMore && pagination.nextCursor) {
    logger.log('');
    logger.dim(`Showing ${messages.length} messages. More available: add --cursor ${pagination.nextCursor}`);
  }
}

export async function outboundGetCommand(
  messageId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching message...');
  const result = await api.getWebhookMessage(messageId);

  if (result.error) {
    spinner.fail('Failed to fetch message');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const message = result.data?.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(message, options.xml, options.yaml));
    return;
  }

  if (!message) {
    logger.error('Message not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Message Details'));
  logger.log('');
  logger.log(`ID:            ${message.id}`);
  logger.log(`Event Type:    ${message.eventType}`);
  logger.log(`Status:        ${formatStatus(message.status)}`);
  logger.log(`Attempts:      ${message.attempts ?? 0}/${message.maxAttempts ?? 5}`);
  logger.log(`Application:   ${message.applicationName ? `${message.applicationName} (${message.applicationId})` : message.applicationId}`);
  logger.log(`Endpoint:      ${message.endpointUrl ? `${message.endpointUrl} (${message.endpointId})` : message.endpointId}`);
  if (message.lastResponseStatus) {
    logger.log(`Response:      ${message.lastResponseStatus}`);
  }
  if (message.lastErrorMessage) {
    logger.log(`Error:         ${logger.red(message.lastErrorMessage)}`);
  }
  if (message.completedAt) {
    logger.log(`Completed:     ${new Date(message.completedAt).toLocaleString()}`);
  }
  logger.log(`Created:       ${new Date(message.createdAt).toLocaleString()}`);
  logger.log('');

  if (message.payload) {
    logger.log(logger.bold('Payload:'));
    logger.log(JSON.stringify(message.payload, null, 2));
    logger.log('');
  }
}

export async function outboundRetryCommand(
  messageId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Retry message ${messageId}?`,
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

  const spinner = logger.spinner('Retrying message...');
  const result = await api.retryWebhookMessage(messageId);

  if (result.error) {
    spinner.fail('Failed to retry message');
    logger.error(result.error);
    return;
  }

  spinner.succeed(`Message queued for retry${result.data?.data?.newMessageId ? ` as ${result.data.data.newMessageId}` : ''}`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data?.data, options.xml, options.yaml));
  }
}

export async function outboundAttemptsCommand(
  messageId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching delivery attempts...');
  const result = await api.getWebhookMessageAttempts(messageId);

  if (result.error) {
    spinner.fail('Failed to fetch delivery attempts');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const attempts = result.data?.data || [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(attempts, options.xml, options.yaml));
    return;
  }

  if (attempts.length === 0) {
    logger.info('No delivery attempts found for this message');
    return;
  }

  logger.table(
    ['#', 'Status', 'Response', 'Time', 'Error', 'Created'],
    attempts.map((a) => [
      String(a.attemptNumber),
      formatStatus(a.status),
      a.responseStatus ? String(a.responseStatus) : '-',
      a.totalTimeMs ? `${a.totalTimeMs}ms` : '-',
      a.errorMessage || '-',
      new Date(a.createdAt).toLocaleString(),
    ])
  );
}

// ============================================================================
// Stats Commands
// ============================================================================

export async function outboundStatsCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching outbound stats...');
  const [statsResult, dlqStatsResult] = await Promise.all([
    api.getOutboundStatsSummary(),
    api.getDlqStats(),
  ]);

  if (statsResult.error) {
    spinner.fail('Failed to fetch outbound stats');
    logger.error(statsResult.error);
    return;
  }

  spinner.stop();

  const stats = statsResult.data?.data;
  const dlqStats = dlqStatsResult.data?.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ summary: stats, dlq: dlqStats }, options.xml, options.yaml));
    return;
  }

  if (!stats) {
    logger.error('No stats available');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Outbound Message Stats'));
  logger.log('');
  logger.log(`Pending:         ${stats.pending}`);
  logger.log(`Processing:      ${stats.processing}`);
  logger.log(`Success:         ${logger.green(String(stats.success))}`);
  logger.log(`Failed:          ${logger.red(String(stats.failed))}`);
  logger.log(`Awaiting Retry:  ${logger.yellow(String(stats.awaitingRetry))}`);
  logger.log(`Exhausted:       ${logger.red(String(stats.exhausted))}`);
  logger.log(`DLQ:             ${logger.red(String(stats.dlq))}`);
  logger.log(`Total:           ${stats.total}`);
  logger.log('');

  if (dlqStats && dlqStats.total > 0) {
    logger.log(logger.bold('DLQ Breakdown'));
    logger.log('');
    if (Object.keys(dlqStats.byReason).length > 0) {
      logger.log('By Reason:');
      for (const [reason, count] of Object.entries(dlqStats.byReason)) {
        logger.log(`  ${reason}: ${count}`);
      }
      logger.log('');
    }
    if (dlqStats.byEndpoint.length > 0) {
      logger.log('By Endpoint:');
      for (const e of dlqStats.byEndpoint) {
        logger.log(`  ${e.endpointUrl || e.endpointId}: ${e.count}`);
      }
      logger.log('');
    }
    if (dlqStats.byEventType.length > 0) {
      logger.log('By Event Type:');
      for (const e of dlqStats.byEventType) {
        logger.log(`  ${e.eventType}: ${e.count}`);
      }
      logger.log('');
    }
  }
}

// ============================================================================
// DLQ Commands
// ============================================================================

export async function dlqListCommand(options: {
  app?: string;
  endpoint?: string;
  limit?: string;
  cursor?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const limit = parseLimit(options.limit);
  if (limit === null) return;

  const spinner = logger.spinner('Fetching DLQ messages...');
  const result = await api.collectPages(
    (page) => api.getDlqMessages({ applicationId: options.app, endpointId: options.endpoint, ...page }),
    { max: limit, cursor: options.cursor }
  );

  if (result.error) {
    spinner.fail('Failed to fetch DLQ messages');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const messages = result.data?.data ?? [];
  const dlqPagination = result.data?.pagination ?? { hasMore: false, nextCursor: null };

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({
      messages,
      hasMore: dlqPagination.hasMore,
      nextCursor: dlqPagination.nextCursor,
    }, options.xml, options.yaml));
    return;
  }

  if (messages.length === 0) {
    logger.info('No messages in Dead Letter Queue');
    logger.dim('This is good! All messages were delivered successfully.');
    return;
  }

  logger.table(
    ['ID', 'Event Type', 'Reason', 'Attempts', 'Moved to DLQ'],
    messages.map((m) => [
      m.id.substring(0, 12) + '...',
      m.eventType,
      m.dlqReason || m.lastErrorType || '-',
      String(m.attempts ?? 0),
      new Date(m.dlqMovedAt || m.createdAt).toLocaleString(),
    ])
  );

  if (dlqPagination.hasMore && dlqPagination.nextCursor) {
    logger.log('');
    logger.dim(`Showing ${messages.length} messages. More available: add --cursor ${dlqPagination.nextCursor}`);
  }
}

export async function dlqGetCommand(
  messageId: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching DLQ message...');
  const result = await api.getDlqMessage(messageId);

  if (result.error) {
    spinner.fail('Failed to fetch DLQ message');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const message = result.data?.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(message, options.xml, options.yaml));
    return;
  }

  if (!message) {
    logger.error('DLQ message not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('DLQ Message Details'));
  logger.log('');
  logger.log(`ID:              ${message.id}`);
  logger.log(`Event Type:      ${message.eventType}`);
  logger.log(`Status:          ${formatStatus(message.status)}`);
  // The detail route has no dlqReason (only the DLQ list does); lastErrorType is the closest signal.
  logger.log(`Last Error Type: ${logger.red(message.lastErrorType || 'unknown')}`);
  logger.log(`Attempts:        ${message.attempts ?? 0}/${message.maxAttempts ?? 5}`);
  logger.log(`Application:     ${message.applicationId}`);
  logger.log(`Endpoint:        ${message.endpointUrl ? `${message.endpointUrl} (${message.endpointId})` : message.endpointId}`);
  if (message.lastErrorMessage) {
    logger.log(`Error:           ${message.lastErrorMessage}`);
  }
  if (message.lastResponseStatus) {
    logger.log(`Last Response:   ${message.lastResponseStatus}`);
  }
  logger.log(`Created:         ${new Date(message.createdAt).toLocaleString()}`);
  logger.log('');

  if (message.payload) {
    logger.log(logger.bold('Payload:'));
    logger.log(JSON.stringify(message.payload, null, 2));
    logger.log('');
  }
}

export async function dlqRetryCommand(
  messageId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Retry DLQ message ${messageId}?`,
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

  const spinner = logger.spinner('Retrying DLQ message...');
  const result = await api.retryDlqMessage(messageId);

  if (result.error) {
    spinner.fail('Failed to retry DLQ message');
    logger.error(result.error);
    return;
  }

  spinner.succeed(`DLQ message queued for retry${result.data?.data?.newMessageId ? ` as ${result.data.data.newMessageId}` : ''}`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data?.data, options.xml, options.yaml));
  }
}

export async function dlqBulkRetryCommand(options: {
  app?: string;
  endpoint?: string;
  limit?: string;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const limit = parseLimit(options.limit);
  if (limit === null) return;

  // First, fetch DLQ messages (across pages when --limit exceeds the API's 100-row page)
  const spinner = logger.spinner('Fetching DLQ messages...');
  const result = await api.collectPages(
    (page) => api.getDlqMessages({ applicationId: options.app, endpointId: options.endpoint, ...page }),
    { max: limit }
  );

  if (result.error) {
    spinner.fail('Failed to fetch DLQ messages');
    logger.error(result.error);
    return;
  }

  const messages = result.data?.data ?? [];
  spinner.stop();

  if (messages.length === 0) {
    logger.info('No messages in Dead Letter Queue to retry');
    return;
  }

  let messageIds: string[];

  try {
    if (options.yes) {
      messageIds = messages.map((m) => m.id);
    } else {
      // Let user select which messages to retry
      messageIds = await checkbox({
        message: `Select messages to retry (${messages.length} found):`,
        choices: messages.map((m) => ({
          name: `${m.id.substring(0, 12)}... - ${m.eventType} (${m.dlqReason || m.lastErrorType || 'unknown'})`,
          value: m.id,
          checked: true,
        })),
      });

      if (messageIds.length === 0) {
        logger.info('No messages selected');
        return;
      }

      const confirmed = await confirm({
        message: `Retry ${messageIds.length} message(s)?`,
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

  const retrySpinner = logger.spinner(`Retrying ${messageIds.length} messages...`);
  const retryResult = await api.bulkRetryDlqMessages(messageIds);

  if (retryResult.error) {
    retrySpinner.fail('Failed to retry messages');
    logger.error(retryResult.error);
    return;
  }

  retrySpinner.succeed(`Queued ${retryResult.data?.queued ?? 0} message(s) for retry`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(retryResult.data, options.xml, options.yaml));
    return;
  }

  // `skipped` = ids the API no longer found in the DLQ (already retried, deleted or archived).
  if (retryResult.data?.skipped && retryResult.data.skipped > 0) {
    logger.warn(`${retryResult.data.skipped} message(s) skipped (no longer in the DLQ)`);
  }
}

export async function dlqDeleteCommand(
  messageId: string,
  options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete DLQ message ${messageId}? This cannot be undone.`,
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

  const spinner = logger.spinner('Deleting DLQ message...');
  const result = await api.deleteDlqMessage(messageId);

  if (result.error) {
    spinner.fail('Failed to delete DLQ message');
    logger.error(result.error);
    return;
  }

  spinner.succeed('DLQ message deleted');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ success: true, messageId }, options.xml, options.yaml));
  }
}
