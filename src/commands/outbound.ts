import { confirm, checkbox } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

function formatStatus(status: string): string {
  switch (status) {
    case 'delivered': return logger.green('delivered');
    case 'pending': return logger.yellow('pending');
    case 'processing': return logger.cyan('processing');
    case 'failed': return logger.red('failed');
    case 'exhausted': return logger.red('exhausted');
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

  if (options.json) {
    console.log(JSON.stringify({
      messages,
      total: pagination.total ?? raw?.total,
      hasMore: pagination.hasMore ?? raw?.hasMore,
    }, null, 2));
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
      `${m.attempt_count ?? m.attemptCount ?? 0}/${m.max_attempts ?? m.maxAttempts ?? 5}`,
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
  options: { json?: boolean }
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

  if (options.json) {
    console.log(JSON.stringify(message, null, 2));
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
  logger.log(`Attempts:      ${message.attempt_count ?? message.attemptCount ?? 0}/${message.max_attempts ?? message.maxAttempts ?? 5}`);
  logger.log(`Application:   ${message.application_id || message.applicationId}`);
  logger.log(`Endpoint:      ${message.endpoint_id || message.endpointId}`);
  if (message.response_status || message.responseStatus) {
    logger.log(`Response:      ${message.response_status || message.responseStatus}`);
  }
  if (message.error_message || message.errorMessage) {
    logger.log(`Error:         ${logger.red(message.error_message || message.errorMessage)}`);
  }
  if (message.next_retry_at || message.nextRetryAt) {
    logger.log(`Next Retry:    ${new Date(message.next_retry_at || message.nextRetryAt).toLocaleString()}`);
  }
  if (message.delivered_at || message.deliveredAt) {
    logger.log(`Delivered:     ${new Date(message.delivered_at || message.deliveredAt).toLocaleString()}`);
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
  options: { yes?: boolean; json?: boolean }
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

  if (options.json) {
    const retried = (result.data as any)?.data || result.data?.message;
    console.log(JSON.stringify(retried, null, 2));
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

  if (options.json) {
    console.log(JSON.stringify({
      messages,
      total: dlqPagination.total ?? dlqRaw?.total,
      hasMore: dlqPagination.hasMore ?? dlqRaw?.hasMore,
    }, null, 2));
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
      m.reason,
      String(m.attempt_count ?? m.attemptCount ?? 0),
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
  options: { json?: boolean }
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

  if (options.json) {
    console.log(JSON.stringify(message, null, 2));
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
  logger.log(`Original Msg ID: ${message.original_message_id || message.originalMessageId}`);
  logger.log(`Event Type:      ${message.event_type || message.eventType}`);
  logger.log(`Reason:          ${logger.red(message.reason)}`);
  logger.log(`Attempts:        ${message.attempt_count ?? message.attemptCount ?? 0}`);
  logger.log(`Application:     ${message.application_id || message.applicationId}`);
  logger.log(`Endpoint:        ${message.endpoint_id || message.endpointId}`);
  if (message.error_message || message.errorMessage) {
    logger.log(`Error:           ${message.error_message || message.errorMessage}`);
  }
  if (message.last_response_status || message.lastResponseStatus) {
    logger.log(`Last Response:   ${message.last_response_status || message.lastResponseStatus}`);
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
  options: { yes?: boolean; json?: boolean }
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

  if (options.json) {
    const retried = (result.data as any)?.data || result.data?.message;
    console.log(JSON.stringify(retried, null, 2));
  }
}

export async function dlqBulkRetryCommand(options: {
  app?: string;
  endpoint?: string;
  limit?: string;
  yes?: boolean;
  json?: boolean;
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

  if (options.json) {
    console.log(JSON.stringify(retryResult.data, null, 2));
    return;
  }

  if (retryResult.data?.failed && retryResult.data.failed > 0) {
    logger.warn(`${retryResult.data.failed} message(s) failed to retry`);
  }
}

export async function dlqDeleteCommand(
  messageId: string,
  options: { yes?: boolean; json?: boolean }
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

  if (options.json) {
    console.log(JSON.stringify({ success: true, messageId }, null, 2));
  }
}
