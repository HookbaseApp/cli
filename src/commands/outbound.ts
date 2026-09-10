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

// ============================================================================
// Messages Commands
// ============================================================================

export async function outboundListCommand(options: {
  app?: string;
  endpoint?: string;
  status?: string;
  eventType?: string;
  limit?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching messages...');
  const result = await api.getWebhookMessages({
    applicationId: options.app,
    endpointId: options.endpoint,
    status: options.status,
    eventType: options.eventType,
    limit: options.limit ? parseInt(options.limit, 10) : 50,
  });

  if (result.error) {
    spinner.fail('Failed to fetch messages');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const raw = result.data as any;
  const messages = raw?.data || raw?.messages || [];
  const pagination = raw?.pagination || {};

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({
      messages,
      total: pagination.total ?? raw?.total,
      hasMore: pagination.hasMore ?? raw?.hasMore,
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
    messages.map((m: any) => [
      m.id.substring(0, 12) + '...',
      m.event_type || m.eventType,
      formatStatus(m.status),
      `${m.attempts ?? m.attempt_count ?? m.attemptCount ?? 0}/${m.max_attempts ?? m.maxAttempts ?? 5}`,
      new Date(m.created_at || m.createdAt).toLocaleString(),
    ])
  );

  if (pagination.hasMore ?? raw?.hasMore) {
    logger.log('');
    logger.dim(`Showing ${messages.length} messages. Use --limit to see more.`);
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

  const message: any = (result.data as any)?.data || result.data?.message;

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
  logger.log(`Event Type:    ${message.event_type || message.eventType}`);
  logger.log(`Status:        ${formatStatus(message.status)}`);
  logger.log(`Attempts:      ${message.attempts ?? message.attempt_count ?? message.attemptCount ?? 0}/${message.max_attempts ?? message.maxAttempts ?? 5}`);
  logger.log(`Application:   ${message.application_id || message.applicationId}`);
  logger.log(`Endpoint:      ${message.endpoint_id || message.endpointId}`);
  const respStatus = message.lastResponseStatus ?? message.last_response_status ?? message.response_status ?? message.responseStatus;
  if (respStatus) {
    logger.log(`Response:      ${respStatus}`);
  }
  const errMsg = message.lastErrorMessage || message.last_error_message || message.error_message || message.errorMessage;
  if (errMsg) {
    logger.log(`Error:         ${logger.red(errMsg)}`);
  }
  if (message.next_retry_at || message.nextRetryAt || message.next_attempt_at || message.nextAttemptAt) {
    logger.log(`Next Retry:    ${new Date(message.next_retry_at || message.nextRetryAt || message.next_attempt_at || message.nextAttemptAt).toLocaleString()}`);
  }
  const completedAt = message.completed_at || message.completedAt || message.delivered_at || message.deliveredAt;
  if (completedAt) {
    logger.log(`Completed:     ${new Date(completedAt).toLocaleString()}`);
  }
  logger.log(`Created:       ${new Date(message.created_at || message.createdAt).toLocaleString()}`);
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

  spinner.succeed('Message queued for retry');

  if (options.json || options.xml || options.yaml) {
    const retried = (result.data as any)?.data || result.data?.message;
    console.log(formatOutput(retried, options.xml, options.yaml));
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
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching DLQ messages...');
  const result = await api.getDlqMessages({
    applicationId: options.app,
    endpointId: options.endpoint,
    limit: options.limit ? parseInt(options.limit, 10) : 50,
  });

  if (result.error) {
    spinner.fail('Failed to fetch DLQ messages');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const dlqRaw = result.data as any;
  const messages = dlqRaw?.data || dlqRaw?.messages || [];
  const dlqPagination = dlqRaw?.pagination || {};

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({
      messages,
      total: dlqPagination.total ?? dlqRaw?.total,
      hasMore: dlqPagination.hasMore ?? dlqRaw?.hasMore,
    }, options.xml, options.yaml));
    return;
  }

  if (messages.length === 0) {
    logger.info('No messages in Dead Letter Queue');
    logger.dim('This is good! All messages were delivered successfully.');
    return;
  }

  logger.table(
    ['ID', 'Event Type', 'Reason', 'Attempts', 'Created'],
    messages.map((m: any) => [
      m.id.substring(0, 12) + '...',
      m.event_type || m.eventType,
      m.dlqReason || m.dlq_reason || m.reason || m.lastErrorType || '-',
      String(m.attempts ?? m.attempt_count ?? m.attemptCount ?? 0),
      new Date(m.created_at || m.createdAt).toLocaleString(),
    ])
  );

  if (dlqPagination.hasMore ?? dlqRaw?.hasMore) {
    logger.log('');
    logger.dim(`Showing ${messages.length} messages. Use --limit to see more.`);
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

  const message: any = (result.data as any)?.data || result.data?.message;

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
  const originalId = message.original_message_id || message.originalMessageId;
  if (originalId) {
    logger.log(`Original Msg ID: ${originalId}`);
  }
  logger.log(`Event Type:      ${message.event_type || message.eventType}`);
  logger.log(`Reason:          ${logger.red(message.dlqReason || message.dlq_reason || message.lastErrorType || message.last_error_type || message.reason || 'unknown')}`);
  logger.log(`Attempts:        ${message.attempts ?? message.attempt_count ?? message.attemptCount ?? 0}`);
  logger.log(`Application:     ${message.application_id || message.applicationId}`);
  logger.log(`Endpoint:        ${message.endpoint_id || message.endpointId}`);
  const dlqErr = message.lastErrorMessage || message.last_error_message || message.error_message || message.errorMessage;
  if (dlqErr) {
    logger.log(`Error:           ${dlqErr}`);
  }
  const dlqRespStatus = message.lastResponseStatus ?? message.last_response_status ?? message.responseStatus;
  if (dlqRespStatus) {
    logger.log(`Last Response:   ${dlqRespStatus}`);
  }
  logger.log(`Created:         ${new Date(message.created_at || message.createdAt).toLocaleString()}`);
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

  spinner.succeed('DLQ message queued for retry');

  if (options.json || options.xml || options.yaml) {
    const retried = (result.data as any)?.data || result.data?.message;
    console.log(formatOutput(retried, options.xml, options.yaml));
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

  // First, fetch DLQ messages
  const spinner = logger.spinner('Fetching DLQ messages...');
  const result = await api.getDlqMessages({
    applicationId: options.app,
    endpointId: options.endpoint,
    limit: options.limit ? parseInt(options.limit, 10) : 50,
  });

  if (result.error) {
    spinner.fail('Failed to fetch DLQ messages');
    logger.error(result.error);
    return;
  }

  const bulkRaw = result.data as any;
  const messages = bulkRaw?.data || bulkRaw?.messages || [];
  spinner.stop();

  if (messages.length === 0) {
    logger.info('No messages in Dead Letter Queue to retry');
    return;
  }

  let messageIds: string[];

  try {
    if (options.yes) {
      messageIds = messages.map((m: any) => m.id);
    } else {
      // Let user select which messages to retry
      messageIds = await checkbox({
        message: `Select messages to retry (${messages.length} found):`,
        choices: messages.map((m: any) => ({
          name: `${m.id.substring(0, 12)}... - ${m.event_type || m.eventType} (${m.reason})`,
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

  retrySpinner.succeed(`Retried ${retryResult.data?.retried || 0} messages`);

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(retryResult.data, options.xml, options.yaml));
    return;
  }

  if (retryResult.data?.failed && retryResult.data.failed > 0) {
    logger.warn(`${retryResult.data.failed} message(s) failed to retry`);
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
