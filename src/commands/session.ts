import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { formatOutput } from '../lib/output.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sessionLoginCommand(): Promise<void> {
  if (config.hasSession()) {
    const user = config.getSessionUser();
    logger.info(`Already logged in with a session as ${user?.email}`);
    logger.info('Run "hookbase session logout" first to switch accounts');
    return;
  }

  const startResult = await api.startDeviceAuth();

  if (startResult.error || !startResult.data) {
    logger.error(startResult.error || 'Failed to start device login');
    return;
  }

  const { deviceCode, userCode, verificationUriComplete, expiresIn, interval } = startResult.data;

  logger.log('');
  logger.box('Session Login', [
    `Open this URL in a browser and log in:`,
    ``,
    `  ${verificationUriComplete}`,
    ``,
    `Or go to the verification page and enter code: ${logger.bold(userCode)}`,
  ].join('\n'));
  logger.log('');

  const spinner = logger.spinner('Waiting for approval...');
  const deadline = Date.now() + expiresIn * 1000;
  const pollIntervalMs = Math.max(interval, 1) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    const pollResult = await api.pollDeviceToken(deviceCode);

    if (pollResult.status === 428) {
      // authorization_pending — keep waiting
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      spinner.text = `Waiting for approval... (${remaining}s remaining)`;
      continue;
    }

    if (pollResult.error || !pollResult.data) {
      spinner.fail('Login failed');
      logger.error(pollResult.error || 'Unknown error');
      return;
    }

    const { user, accessToken, refreshToken } = pollResult.data;
    config.setSession(accessToken, refreshToken, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });

    spinner.succeed(`Logged in as ${user.email}`);
    return;
  }

  spinner.fail('Login timed out');
  logger.dim('Run "hookbase login" to try again');
}

export async function sessionLogoutCommand(): Promise<void> {
  if (!config.hasSession()) {
    logger.info('No active session');
    return;
  }

  config.clearSession();
  logger.success('Session logged out');
}

export async function sessionStatusCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  const hasSession = config.hasSession();
  const user = config.getSessionUser();

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput({ hasSession, user }, options.xml, options.yaml));
    return;
  }

  if (!hasSession || !user) {
    logger.info('No active session');
    logger.dim('Run "hookbase login" to start one');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Session Status'));
  logger.log('');
  logger.log(`User:  ${user.email}`);
  logger.log(`Name:  ${user.displayName}`);
  logger.log('');
}
