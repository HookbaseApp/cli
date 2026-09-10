import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';
import { formatOutput } from '../lib/output.js';

function formatComponentStatus(status: string): string {
  switch (status) {
    case 'operational':
      return logger.green('operational');
    case 'degraded':
      return logger.yellow('degraded');
    case 'downtime':
    case 'down':
      return logger.red('down');
    case 'maintenance':
      return logger.cyan('maintenance');
    default:
      return logger.dimText(status);
  }
}

function formatOverallStatus(status: string): string {
  if (status === 'operational') return logger.green('All systems operational');
  if (status === 'degraded') return logger.yellow('Degraded performance');
  if (status === 'maintenance') return logger.cyan('Under maintenance');
  return logger.red('Service disruption');
}

// No requireAuth() — this reflects Hookbase's own platform status, not anything
// scoped to the caller's account, so it works whether or not you're logged in.
export async function statusCommand(options: {
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  const spinner = logger.spinner('Fetching status...');
  const result = await api.getStatus();

  if (result.error || !result.data) {
    spinner.fail('Failed to fetch status');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  const status = result.data;

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(status, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.log(formatOverallStatus(status.overallStatus));
  logger.log('');
  logger.table(
    ['Component', 'Status'],
    status.components.map((c) => [c.name, formatComponentStatus(c.status)])
  );
  logger.log('');
  logger.dim(`Full history: ${status.statusPageUrl}`);
}
