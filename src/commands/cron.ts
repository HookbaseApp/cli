import { input, confirm, select, checkbox } from '@inquirer/prompts';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

const COMMON_TIMEZONES = [
  { name: 'UTC', value: 'UTC' },
  { name: 'America/New_York (Eastern)', value: 'America/New_York' },
  { name: 'America/Chicago (Central)', value: 'America/Chicago' },
  { name: 'America/Denver (Mountain)', value: 'America/Denver' },
  { name: 'America/Los_Angeles (Pacific)', value: 'America/Los_Angeles' },
  { name: 'Europe/London', value: 'Europe/London' },
  { name: 'Europe/Paris', value: 'Europe/Paris' },
  { name: 'Europe/Berlin', value: 'Europe/Berlin' },
  { name: 'Asia/Tokyo', value: 'Asia/Tokyo' },
  { name: 'Asia/Shanghai', value: 'Asia/Shanghai' },
  { name: 'Asia/Singapore', value: 'Asia/Singapore' },
  { name: 'Australia/Sydney', value: 'Australia/Sydney' },
];

const HTTP_METHODS = [
  { name: 'POST', value: 'POST' },
  { name: 'GET', value: 'GET' },
  { name: 'PUT', value: 'PUT' },
  { name: 'PATCH', value: 'PATCH' },
  { name: 'DELETE', value: 'DELETE' },
];

const COMMON_CRON_PRESETS = [
  { name: 'Every minute', value: '* * * * *' },
  { name: 'Every 5 minutes', value: '*/5 * * * *' },
  { name: 'Every 15 minutes', value: '*/15 * * * *' },
  { name: 'Every 30 minutes', value: '*/30 * * * *' },
  { name: 'Every hour', value: '0 * * * *' },
  { name: 'Every 6 hours', value: '0 */6 * * *' },
  { name: 'Every 12 hours', value: '0 */12 * * *' },
  { name: 'Daily at midnight', value: '0 0 * * *' },
  { name: 'Daily at noon', value: '0 12 * * *' },
  { name: 'Weekly (Sunday midnight)', value: '0 0 * * 0' },
  { name: 'Monthly (1st at midnight)', value: '0 0 1 * *' },
  { name: 'Custom...', value: 'custom' },
];

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

// Parse date string from API (stored as UTC without Z suffix) to Date object
function parseUTCDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  // API stores dates as "YYYY-MM-DD HH:MM:SS" in UTC
  // Add Z suffix to parse as UTC, or handle ISO format
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  return new Date(normalized);
}

function formatDate(dateStr: string | null | undefined): string {
  const date = parseUTCDate(dateStr);
  if (!date) return '-';
  return date.toLocaleString();
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  const date = parseUTCDate(dateStr);
  if (!date) return '-';
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) {
    // Past
    const absDiffMinutes = Math.abs(diffMinutes);
    const absDiffHours = Math.abs(diffHours);
    const absDiffDays = Math.abs(diffDays);
    if (absDiffMinutes < 1) return 'just now';
    if (absDiffMinutes < 60) return `${absDiffMinutes}m ago`;
    if (absDiffHours < 24) return `${absDiffHours}h ago`;
    return `${absDiffDays}d ago`;
  } else {
    // Future
    if (diffMinutes < 1) return 'in <1m';
    if (diffMinutes < 60) return `in ${diffMinutes}m`;
    if (diffHours < 24) return `in ${diffHours}h`;
    return `in ${diffDays}d`;
  }
}

function describeCronExpression(expr: string): string {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Simple descriptions for common patterns
  if (expr === '* * * * *') return 'Every minute';
  if (expr === '0 * * * *') return 'Every hour';
  if (expr === '0 0 * * *') return 'Daily at midnight';
  if (expr === '0 12 * * *') return 'Daily at noon';
  if (expr === '0 0 * * 0') return 'Weekly on Sunday';
  if (expr === '0 0 1 * *') return 'Monthly on the 1st';
  if (minute.startsWith('*/')) return `Every ${minute.slice(2)} minutes`;
  if (hour.startsWith('*/') && minute === '0') return `Every ${hour.slice(2)} hours`;

  return expr;
}

function validateCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const patterns = [
    /^(\*|([0-5]?\d)(,([0-5]?\d))*|(\*|([0-5]?\d))\/\d+|([0-5]?\d)-([0-5]?\d))$/, // minute
    /^(\*|([01]?\d|2[0-3])(,([01]?\d|2[0-3]))*|(\*|([01]?\d|2[0-3]))\/\d+|([01]?\d|2[0-3])-([01]?\d|2[0-3]))$/, // hour
    /^(\*|([1-9]|[12]\d|3[01])(,([1-9]|[12]\d|3[01]))*|(\*|([1-9]|[12]\d|3[01]))\/\d+|([1-9]|[12]\d|3[01])-([1-9]|[12]\d|3[01]))$/, // day of month
    /^(\*|([1-9]|1[0-2])(,([1-9]|1[0-2]))*|(\*|([1-9]|1[0-2]))\/\d+|([1-9]|1[0-2])-([1-9]|1[0-2]))$/, // month
    /^(\*|[0-6](,[0-6])*|(\*|[0-6])\/\d+|[0-6]-[0-6])$/, // day of week
  ];

  return parts.every((part, i) => patterns[i].test(part));
}

export async function cronListCommand(options: { json?: boolean; all?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching cron jobs...');
  const result = await api.getCronJobs();

  if (result.error) {
    spinner.fail('Failed to fetch cron jobs');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  let jobs = result.data?.cronJobs || [];

  // Filter to active only by default
  if (!options.all) {
    jobs = jobs.filter(j => j.is_active);
  }

  if (options.json) {
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }

  if (jobs.length === 0) {
    logger.info(options.all ? 'No cron jobs found' : 'No active cron jobs found');
    logger.dim('Create cron jobs with "hookbase cron create"');
    if (!options.all) {
      logger.dim('Use --all to show inactive jobs');
    }
    return;
  }

  logger.table(
    ['ID', 'Name', 'Schedule', 'URL', 'Status', 'Next Run', 'Last Run'],
    jobs.map(j => [
      j.id.slice(0, 8) + '...',
      j.name.slice(0, 20) + (j.name.length > 20 ? '...' : ''),
      describeCronExpression(j.cron_expression),
      j.url.slice(0, 30) + (j.url.length > 30 ? '...' : ''),
      j.is_active ? logger.green('active') : logger.dimText('inactive'),
      formatRelativeTime(j.next_run_at),
      formatRelativeTime(j.last_run_at),
    ])
  );

  logger.log('');
  logger.dim(`Showing ${jobs.length} job(s)${!options.all ? ' (active only, use --all for all)' : ''}`);
}

export async function cronCreateCommand(options: {
  name?: string;
  schedule?: string;
  url?: string;
  method?: string;
  timezone?: string;
  payload?: string;
  headers?: string;
  timeout?: number;
  group?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let cronExpression = options.schedule;
  let url = options.url;
  let method = options.method || 'POST';
  let timezone = options.timezone || 'UTC';
  let payload = options.payload;
  let headers: Record<string, string> | undefined;
  let groupId = options.group;

  // Parse headers if provided
  if (options.headers) {
    try {
      headers = JSON.parse(options.headers);
    } catch {
      logger.error('Invalid headers JSON. Use format: \'{"Header-Name": "value"}\'');
      return;
    }
  }

  // Interactive mode
  if (!name || !cronExpression || !url) {
    name = name || await input({
      message: 'Job name:',
      validate: (value) => value.length > 0 || 'Name is required',
    });

    // Schedule selection
    if (!cronExpression) {
      const preset = await select({
        message: 'Select schedule:',
        choices: COMMON_CRON_PRESETS,
      });

      if (preset === 'custom') {
        cronExpression = await input({
          message: 'Enter cron expression (minute hour day month weekday):',
          validate: (value) => validateCronExpression(value) || 'Invalid cron expression. Use 5-field format: * * * * *',
        });
      } else {
        cronExpression = preset;
      }
    }

    url = url || await input({
      message: 'URL to call:',
      validate: (value) => {
        try {
          new URL(value);
          return true;
        } catch {
          return 'Invalid URL';
        }
      },
    });

    method = await select({
      message: 'HTTP method:',
      choices: HTTP_METHODS,
      default: 'POST',
    });

    timezone = await select({
      message: 'Timezone:',
      choices: [...COMMON_TIMEZONES, { name: 'Other (enter manually)', value: 'other' }],
      default: 'UTC',
    });

    if (timezone === 'other') {
      timezone = await input({
        message: 'Enter timezone (e.g., America/New_York):',
        default: 'UTC',
      });
    }

    // Optional payload
    const addPayload = await confirm({
      message: 'Add request payload?',
      default: false,
    });

    if (addPayload) {
      payload = await input({
        message: 'Enter JSON payload:',
        validate: (value) => {
          if (!value) return true;
          try {
            JSON.parse(value);
            return true;
          } catch {
            return 'Invalid JSON';
          }
        },
      });
    }

    // Optional headers
    const addHeaders = await confirm({
      message: 'Add custom headers?',
      default: false,
    });

    if (addHeaders) {
      const headerInput = await input({
        message: 'Enter headers as JSON (e.g., {"X-Api-Key": "secret"}):',
        validate: (value) => {
          if (!value) return true;
          try {
            JSON.parse(value);
            return true;
          } catch {
            return 'Invalid JSON';
          }
        },
      });
      if (headerInput) {
        headers = JSON.parse(headerInput);
      }
    }

    // Optional group selection
    const groupsResult = await api.getCronGroups();
    if (groupsResult.data?.groups && groupsResult.data.groups.length > 0) {
      const groups = groupsResult.data.groups;
      const groupChoice = await select({
        message: 'Add to a group? (optional):',
        choices: [
          { name: 'No group', value: '' },
          ...groups.map(g => ({ name: g.name, value: g.id })),
        ],
      });
      if (groupChoice) {
        groupId = groupChoice;
      }
    }
  }

  if (!options.yes && !options.name) {
    logger.log('');
    logger.log(logger.bold('Summary:'));
    logger.log(`  Name:     ${name}`);
    logger.log(`  Schedule: ${cronExpression} (${describeCronExpression(cronExpression!)})`);
    logger.log(`  URL:      ${method} ${url}`);
    logger.log(`  Timezone: ${timezone}`);
    if (payload) logger.log(`  Payload:  ${payload.slice(0, 50)}${payload.length > 50 ? '...' : ''}`);
    if (headers) logger.log(`  Headers:  ${JSON.stringify(headers)}`);
    logger.log('');

    const confirmed = await confirm({
      message: 'Create this cron job?',
      default: true,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const spinner = logger.spinner('Creating cron job...');
  const result = await api.createCronJob({
    name: name!,
    cronExpression: cronExpression!,
    url: url!,
    method,
    timezone,
    payload,
    headers,
    timeoutMs: options.timeout,
    groupId,
  });

  if (result.error) {
    spinner.fail('Failed to create cron job');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron job created');

  if (options.json) {
    console.log(JSON.stringify(result.data?.cronJob, null, 2));
    return;
  }

  const job = result.data?.cronJob;
  if (job) {
    logger.log('');
    logger.box('Cron Job Created', [
      `ID:       ${job.id}`,
      `Name:     ${job.name}`,
      `Schedule: ${describeCronExpression(job.cron_expression)}`,
      `URL:      ${job.method} ${job.url}`,
      `Timezone: ${job.timezone}`,
      ``,
      `Next run: ${formatDate(job.next_run_at)}`,
    ].join('\n'));
  }
}

export async function cronGetCommand(
  jobId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching cron job...');
  const result = await api.getCronJob(jobId);

  if (result.error) {
    spinner.fail('Failed to fetch cron job');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const job = result.data?.cronJob;

  if (options.json) {
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  if (!job) {
    logger.error('Cron job not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Cron Job Details'));
  logger.log('');
  logger.log(`ID:           ${job.id}`);
  logger.log(`Name:         ${job.name}`);
  if (job.description) {
    logger.log(`Description:  ${job.description}`);
  }
  logger.log(`Schedule:     ${job.cron_expression} (${describeCronExpression(job.cron_expression)})`);
  logger.log(`Timezone:     ${job.timezone}`);
  logger.log(`Status:       ${job.is_active ? logger.green('active') : logger.red('inactive')}`);
  logger.log('');
  logger.log(logger.bold('Request'));
  logger.log(`URL:          ${job.url}`);
  logger.log(`Method:       ${job.method}`);
  logger.log(`Timeout:      ${job.timeout_ms}ms`);
  if (job.headers) {
    logger.log(`Headers:      ${job.headers}`);
  }
  if (job.payload) {
    logger.log(`Payload:      ${job.payload}`);
  }
  logger.log('');
  logger.log(logger.bold('Timing'));
  logger.log(`Next run:     ${formatDate(job.next_run_at)} (${formatRelativeTime(job.next_run_at)})`);
  logger.log(`Last run:     ${formatDate(job.last_run_at)} (${formatRelativeTime(job.last_run_at)})`);
  logger.log(`Created:      ${formatDate(job.created_at)}`);
  logger.log(`Updated:      ${formatDate(job.updated_at)}`);

  if (job.notify_on_failure || job.notify_on_success) {
    logger.log('');
    logger.log(logger.bold('Notifications'));
    logger.log(`On failure:   ${job.notify_on_failure ? 'Yes' : 'No'}`);
    logger.log(`On success:   ${job.notify_on_success ? 'Yes' : 'No'}`);
    if (job.notify_emails) {
      logger.log(`Emails:       ${job.notify_emails}`);
    }
    if (job.consecutive_failures) {
      logger.log(`Consecutive failures: ${job.consecutive_failures}`);
    }
  }
  logger.log('');
}

export async function cronUpdateCommand(
  jobId: string,
  options: {
    name?: string;
    schedule?: string;
    url?: string;
    method?: string;
    timezone?: string;
    payload?: string;
    headers?: string;
    timeout?: number;
    active?: boolean;
    inactive?: boolean;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateCronJob>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.schedule) {
    if (!validateCronExpression(options.schedule)) {
      logger.error('Invalid cron expression. Use 5-field format: * * * * *');
      return;
    }
    updateData.cronExpression = options.schedule;
  }
  if (options.url) updateData.url = options.url;
  if (options.method) updateData.method = options.method;
  if (options.timezone) updateData.timezone = options.timezone;
  if (options.payload) updateData.payload = options.payload;
  if (options.headers) {
    try {
      updateData.headers = JSON.parse(options.headers);
    } catch {
      logger.error('Invalid headers JSON');
      return;
    }
  }
  if (options.timeout) updateData.timeoutMs = options.timeout;
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --schedule, --url, --method, --timezone, --active, or --inactive');
    return;
  }

  const spinner = logger.spinner('Updating cron job...');
  const result = await api.updateCronJob(jobId, updateData);

  if (result.error) {
    spinner.fail('Failed to update cron job');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron job updated');

  if (options.json) {
    console.log(JSON.stringify({ success: true, jobId }, null, 2));
  }
}

export async function cronDeleteCommand(
  jobId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  if (!options.yes) {
    const confirmed = await confirm({
      message: `Are you sure you want to delete cron job ${jobId}? This will also delete all execution history. This cannot be undone.`,
      default: false,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const spinner = logger.spinner('Deleting cron job...');
  const result = await api.deleteCronJob(jobId);

  if (result.error) {
    spinner.fail('Failed to delete cron job');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron job deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, jobId }, null, 2));
  }
}

export async function cronTriggerCommand(
  jobId: string,
  options: { json?: boolean; wait?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Triggering cron job...');
  const result = await api.triggerCronJob(jobId);

  if (result.error) {
    spinner.fail('Failed to trigger cron job');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron job triggered');

  if (options.json) {
    console.log(JSON.stringify(result.data?.execution, null, 2));
    return;
  }

  const execution = result.data?.execution;
  if (execution) {
    logger.log('');
    logger.log(`Execution ID: ${execution.id}`);
    logger.log(`Status:       ${getStatusDisplay(execution.status)}`);
    if (execution.responseStatus) {
      logger.log(`Response:     ${execution.responseStatus}`);
    }
    if (execution.latencyMs) {
      logger.log(`Latency:      ${execution.latencyMs}ms`);
    }
    if (execution.error) {
      logger.log(`Error:        ${logger.red(execution.error)}`);
    }
    logger.log('');
  }
}

function getStatusDisplay(status: string): string {
  switch (status) {
    case 'success':
      return logger.green('success');
    case 'failed':
      return logger.red('failed');
    case 'pending':
      return logger.yellow('pending');
    default:
      return status;
  }
}

export async function cronHistoryCommand(
  jobId: string,
  options: { limit?: number; json?: boolean }
): Promise<void> {
  requireAuth();

  const limit = options.limit || 20;

  const spinner = logger.spinner('Fetching execution history...');
  const result = await api.getCronExecutions(jobId, limit);

  if (result.error) {
    spinner.fail('Failed to fetch execution history');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const executions = result.data?.executions || [];

  if (options.json) {
    console.log(JSON.stringify(executions, null, 2));
    return;
  }

  if (executions.length === 0) {
    logger.info('No execution history found');
    logger.dim('Trigger the job with "hookbase cron trigger <jobId>"');
    return;
  }

  logger.table(
    ['ID', 'Status', 'HTTP Status', 'Latency', 'Started', 'Completed'],
    executions.map(e => [
      e.id.slice(0, 8) + '...',
      getStatusDisplay(e.status),
      e.response_status ? String(e.response_status) : '-',
      e.latency_ms ? `${e.latency_ms}ms` : '-',
      formatRelativeTime(e.started_at),
      e.completed_at ? formatRelativeTime(e.completed_at) : '-',
    ])
  );

  // Show summary stats
  const successCount = executions.filter(e => e.status === 'success').length;
  const failedCount = executions.filter(e => e.status === 'failed').length;
  const avgLatency = executions.filter(e => e.latency_ms).reduce((sum, e) => sum + (e.latency_ms || 0), 0) / executions.filter(e => e.latency_ms).length;

  logger.log('');
  logger.dim(`Showing ${executions.length} execution(s)`);
  logger.dim(`Success: ${successCount}, Failed: ${failedCount}, Avg Latency: ${Math.round(avgLatency) || 0}ms`);
}

export async function cronEnableCommand(
  jobId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Enabling cron job...');
  const result = await api.updateCronJob(jobId, { isActive: true });

  if (result.error) {
    spinner.fail('Failed to enable cron job');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron job enabled');

  if (options.json) {
    console.log(JSON.stringify({ success: true, jobId }, null, 2));
  }
}

export async function cronDisableCommand(
  jobId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Disabling cron job...');
  const result = await api.updateCronJob(jobId, { isActive: false });

  if (result.error) {
    spinner.fail('Failed to disable cron job');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron job disabled');

  if (options.json) {
    console.log(JSON.stringify({ success: true, jobId }, null, 2));
  }
}

// Interactive cron expression builder
export async function cronBuilderCommand(): Promise<void> {
  logger.log('');
  logger.log(logger.bold('Interactive Cron Expression Builder'));
  logger.dim('Build a cron expression step by step');
  logger.log('');

  // Minute
  const minuteChoice = await select({
    message: 'Minute:',
    choices: [
      { name: 'Every minute (*)', value: '*' },
      { name: 'Every 5 minutes (*/5)', value: '*/5' },
      { name: 'Every 10 minutes (*/10)', value: '*/10' },
      { name: 'Every 15 minutes (*/15)', value: '*/15' },
      { name: 'Every 30 minutes (*/30)', value: '*/30' },
      { name: 'At minute 0', value: '0' },
      { name: 'Custom...', value: 'custom' },
    ],
  });

  let minute = minuteChoice;
  if (minuteChoice === 'custom') {
    minute = await input({
      message: 'Enter minute value (0-59, *, */n, or n-m):',
      validate: (v) => /^(\*|([0-5]?\d)(,([0-5]?\d))*|(\*|([0-5]?\d))\/\d+|([0-5]?\d)-([0-5]?\d))$/.test(v) || 'Invalid minute',
    });
  }

  // Hour
  const hourChoice = await select({
    message: 'Hour:',
    choices: [
      { name: 'Every hour (*)', value: '*' },
      { name: 'Every 2 hours (*/2)', value: '*/2' },
      { name: 'Every 6 hours (*/6)', value: '*/6' },
      { name: 'Every 12 hours (*/12)', value: '*/12' },
      { name: 'At midnight (0)', value: '0' },
      { name: 'At noon (12)', value: '12' },
      { name: 'Business hours (9-17)', value: '9-17' },
      { name: 'Custom...', value: 'custom' },
    ],
  });

  let hour = hourChoice;
  if (hourChoice === 'custom') {
    hour = await input({
      message: 'Enter hour value (0-23, *, */n, or n-m):',
      validate: (v) => /^(\*|([01]?\d|2[0-3])(,([01]?\d|2[0-3]))*|(\*|([01]?\d|2[0-3]))\/\d+|([01]?\d|2[0-3])-([01]?\d|2[0-3]))$/.test(v) || 'Invalid hour',
    });
  }

  // Day of month
  const dayChoice = await select({
    message: 'Day of month:',
    choices: [
      { name: 'Every day (*)', value: '*' },
      { name: '1st of month', value: '1' },
      { name: '15th of month', value: '15' },
      { name: 'Last week (25-31)', value: '25-31' },
      { name: 'Custom...', value: 'custom' },
    ],
  });

  let dayOfMonth = dayChoice;
  if (dayChoice === 'custom') {
    dayOfMonth = await input({
      message: 'Enter day of month (1-31, *, */n, or n-m):',
      validate: (v) => /^(\*|([1-9]|[12]\d|3[01])(,([1-9]|[12]\d|3[01]))*|(\*|([1-9]|[12]\d|3[01]))\/\d+|([1-9]|[12]\d|3[01])-([1-9]|[12]\d|3[01]))$/.test(v) || 'Invalid day',
    });
  }

  // Month
  const monthChoice = await select({
    message: 'Month:',
    choices: [
      { name: 'Every month (*)', value: '*' },
      { name: 'Q1 (Jan-Mar)', value: '1-3' },
      { name: 'Q2 (Apr-Jun)', value: '4-6' },
      { name: 'Q3 (Jul-Sep)', value: '7-9' },
      { name: 'Q4 (Oct-Dec)', value: '10-12' },
      { name: 'Custom...', value: 'custom' },
    ],
  });

  let month = monthChoice;
  if (monthChoice === 'custom') {
    month = await input({
      message: 'Enter month (1-12, *, */n, or n-m):',
      validate: (v) => /^(\*|([1-9]|1[0-2])(,([1-9]|1[0-2]))*|(\*|([1-9]|1[0-2]))\/\d+|([1-9]|1[0-2])-([1-9]|1[0-2]))$/.test(v) || 'Invalid month',
    });
  }

  // Day of week
  const dowChoice = await select({
    message: 'Day of week:',
    choices: [
      { name: 'Every day (*)', value: '*' },
      { name: 'Weekdays (Mon-Fri)', value: '1-5' },
      { name: 'Weekends (Sat-Sun)', value: '0,6' },
      { name: 'Monday', value: '1' },
      { name: 'Friday', value: '5' },
      { name: 'Sunday', value: '0' },
      { name: 'Custom...', value: 'custom' },
    ],
  });

  let dayOfWeek = dowChoice;
  if (dowChoice === 'custom') {
    dayOfWeek = await input({
      message: 'Enter day of week (0-6 where 0=Sunday, *, or n-m):',
      validate: (v) => /^(\*|[0-6](,[0-6])*|(\*|[0-6])\/\d+|[0-6]-[0-6])$/.test(v) || 'Invalid day of week',
    });
  }

  const expression = `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;

  logger.log('');
  logger.box('Generated Cron Expression', [
    expression,
    '',
    `Description: ${describeCronExpression(expression)}`,
    '',
    'Field reference:',
    '  minute hour day-of-month month day-of-week',
    '  (0-59) (0-23) (1-31) (1-12) (0-6, Sun=0)',
  ].join('\n'));

  const copyAction = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Use this to create a new cron job', value: 'create' },
      { name: 'Just show the expression', value: 'show' },
    ],
  });

  if (copyAction === 'create') {
    await cronCreateCommand({ schedule: expression });
  }
}

// Monitor cron executions in real-time
export async function cronFollowCommand(options: {
  job?: string;
  interval?: number;
}): Promise<void> {
  requireAuth();

  const pollInterval = (options.interval || 5) * 1000; // Default 5 seconds
  let lastSeenExecutions: Set<string> = new Set();
  let isFirstPoll = true;

  logger.log('');
  logger.log(logger.bold('Monitoring Cron Executions'));
  logger.dim('Press Ctrl+C to stop');
  logger.log('');

  // Get job info if specific job is requested
  let jobName: string | undefined;
  if (options.job) {
    const jobResult = await api.getCronJob(options.job);
    if (jobResult.data?.cronJob) {
      jobName = jobResult.data.cronJob.name;
      logger.log(`Monitoring job: ${logger.cyan(jobName)}`);
      logger.log('');
    }
  } else {
    logger.log('Monitoring all cron jobs');
    logger.log('');
  }

  const poll = async () => {
    try {
      if (options.job) {
        // Monitor specific job
        const result = await api.getCronExecutions(options.job, 10);
        if (result.data?.executions) {
          const executions = result.data.executions;

          for (const exec of executions.reverse()) {
            if (!lastSeenExecutions.has(exec.id)) {
              if (!isFirstPoll) {
                printExecution(exec, jobName);
              }
              lastSeenExecutions.add(exec.id);
            }
          }
        }
      } else {
        // Monitor all jobs - need to fetch all jobs first
        const jobsResult = await api.getCronJobs();
        if (jobsResult.data?.cronJobs) {
          for (const job of jobsResult.data.cronJobs) {
            const execResult = await api.getCronExecutions(job.id, 5);
            if (execResult.data?.executions) {
              for (const exec of execResult.data.executions.reverse()) {
                if (!lastSeenExecutions.has(exec.id)) {
                  if (!isFirstPoll) {
                    printExecution(exec, job.name);
                  }
                  lastSeenExecutions.add(exec.id);
                }
              }
            }
          }
        }
      }

      isFirstPoll = false;
    } catch (error) {
      // Silently continue on errors
    }
  };

  // Initial poll to get baseline
  await poll();
  isFirstPoll = false;

  // Set up polling interval
  const intervalId = setInterval(poll, pollInterval);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    logger.log('');
    logger.info('Stopped monitoring');
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {});
}

function printExecution(exec: api.CronExecution, jobName?: string): void {
  const timestamp = new Date(exec.started_at).toLocaleTimeString();
  const status = exec.status === 'success'
    ? logger.green('SUCCESS')
    : exec.status === 'failed'
    ? logger.red('FAILED')
    : logger.yellow('PENDING');

  const httpStatus = exec.response_status
    ? (exec.response_status >= 200 && exec.response_status < 300
        ? logger.green(String(exec.response_status))
        : logger.red(String(exec.response_status)))
    : '-';

  const latency = exec.latency_ms ? `${exec.latency_ms}ms` : '-';

  logger.log(
    `${logger.dimText(timestamp)} ` +
    `${jobName ? logger.cyan(jobName.padEnd(20)) + ' ' : ''}` +
    `${status.padEnd(17)} ` +
    `HTTP ${httpStatus.padEnd(12)} ` +
    `${logger.dimText(latency)}`
  );

  if (exec.error_message) {
    logger.log(`  ${logger.red('Error:')} ${exec.error_message}`);
  }
}

// Quick status overview of all cron jobs
export async function cronStatusCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching cron status...');

  const [jobsResult, groupsResult] = await Promise.all([
    api.getCronJobs(),
    api.getCronGroups(),
  ]);

  if (jobsResult.error) {
    spinner.fail('Failed to fetch cron jobs');
    logger.error(jobsResult.error);
    return;
  }

  spinner.stop();

  const jobs = jobsResult.data?.cronJobs || [];
  const groups = groupsResult.data?.groups || [];

  if (options.json) {
    console.log(JSON.stringify({ jobs, groups }, null, 2));
    return;
  }

  const activeJobs = jobs.filter(j => j.is_active);
  const inactiveJobs = jobs.filter(j => !j.is_active);

  // Jobs with upcoming executions (next 1 hour)
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
  const upcomingJobs = activeJobs.filter(j => {
    if (!j.next_run_at) return false;
    const nextRun = new Date(j.next_run_at);
    return nextRun >= now && nextRun <= oneHourLater;
  });

  logger.log('');
  logger.log(logger.bold('Cron Jobs Status'));
  logger.log('');
  logger.log(`Total jobs:    ${jobs.length}`);
  logger.log(`Active:        ${logger.green(String(activeJobs.length))}`);
  logger.log(`Inactive:      ${logger.dimText(String(inactiveJobs.length))}`);
  logger.log(`Groups:        ${groups.length}`);
  logger.log('');

  if (upcomingJobs.length > 0) {
    logger.log(logger.bold('Upcoming Executions (next hour):'));
    logger.log('');

    upcomingJobs
      .sort((a, b) => new Date(a.next_run_at!).getTime() - new Date(b.next_run_at!).getTime())
      .forEach(job => {
        const nextRun = new Date(job.next_run_at!);
        const diffMinutes = Math.round((nextRun.getTime() - now.getTime()) / (1000 * 60));
        logger.log(`  ${logger.cyan(job.name.padEnd(25))} in ${diffMinutes}m (${nextRun.toLocaleTimeString()})`);
      });

    logger.log('');
  }

  // Show recently failed jobs if any
  const recentlyFailed = jobs.filter(j => j.consecutive_failures && j.consecutive_failures > 0);
  if (recentlyFailed.length > 0) {
    logger.log(logger.bold(logger.red('Jobs with Recent Failures:')));
    logger.log('');

    recentlyFailed.forEach(job => {
      logger.log(`  ${logger.red(job.name.padEnd(25))} ${job.consecutive_failures} consecutive failure(s)`);
    });

    logger.log('');
  }

  logger.dim('Use "hookbase cron list" for full job listing');
  logger.dim('Use "hookbase cron follow" to monitor executions in real-time');
}
