import { writeFileSync } from 'fs';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

export async function auditLogsListCommand(options: {
  action?: string;
  entityType?: string;
  userId?: string;
  limit?: string;
  offset?: string;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching audit logs...');
  const result = await api.getAuditLogs({
    action: options.action,
    entityType: options.entityType,
    userId: options.userId,
    limit: options.limit ? parseInt(options.limit, 10) : 50,
    offset: options.offset ? parseInt(options.offset, 10) : undefined,
  });

  if (result.error) {
    spinner.fail('Failed to fetch audit logs');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const logs = result.data?.logs || [];

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ logs, total: result.data?.total }, options.xml, options.yaml));
    return;
  }

  if (logs.length === 0) {
    logger.info('No audit log entries found');
    return;
  }

  logger.table(
    ['Time', 'Actor', 'Action', 'Entity', 'IP'],
    logs.map((l) => [
      new Date(l.createdAt).toLocaleString(),
      l.userName || l.userEmail || (l.apiKeyName ? `API key: ${l.apiKeyName}` : 'System'),
      l.action,
      `${l.entityType}${l.entityId ? ` (${l.entityId.substring(0, 8)}...)` : ''}`,
      l.ipAddress || '-',
    ])
  );

  const total = result.data?.total ?? logs.length;
  if (total > logs.length) {
    logger.log('');
    logger.dim(`Showing ${logs.length} of ${total} entries. Use --limit/--offset to page.`);
  }
}

export async function auditLogsExportCommand(options: { output?: string }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Exporting audit logs...');
  const result = await api.exportAuditLogs();

  if (result.error) {
    spinner.fail('Failed to export audit logs');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const csv = result.csv || '';

  if (options.output) {
    writeFileSync(options.output, csv);
    logger.success(`Exported audit logs to ${options.output}`);
    return;
  }

  console.log(csv);
}
