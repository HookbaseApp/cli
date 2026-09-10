import { input } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { formatOutput } from '../lib/output.js';
import { readHiddenInput } from './login.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

function requireSessionAuth(): boolean {
  if (!config.hasSession()) {
    logger.error('Not logged in with a session. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

export async function twoFactorStatusCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner('Fetching 2FA status...');
  const result = await api.get2FAStatus();

  if (result.error || !result.data) {
    spinner.fail('Failed to fetch 2FA status');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.log(`Two-factor authentication: ${result.data.enabled ? logger.green('enabled') : logger.dimText('disabled')}`);
  logger.log('');
  if (!result.data.enabled) {
    logger.dim('Run "hookbase 2fa setup" to enable it');
  }
}

export async function twoFactorSetupCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner('Starting 2FA setup...');
  const result = await api.setup2FA();

  if (result.error || !result.data) {
    spinner.fail('Failed to start 2FA setup');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.stop();

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  const { secret, otpauthUrl } = result.data;

  logger.log('');
  logger.box('Set Up Two-Factor Authentication', [
    'Scan this URL with your authenticator app, or enter the secret manually:',
    '',
    `  ${otpauthUrl}`,
    '',
    `Manual entry secret: ${logger.bold(secret)}`,
  ].join('\n'));
  logger.log('');
  logger.dim('Then run "hookbase 2fa verify <code>" with a code from your app to finish enabling 2FA.');
}

export async function twoFactorVerifyCommand(code: string, options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner('Verifying code...');
  const result = await api.verify2FA(code);

  if (result.error || !result.data) {
    spinner.fail('Failed to verify code');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.succeed('Two-factor authentication enabled');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.box('Recovery Codes', [
    logger.yellow('Save these recovery codes somewhere safe. Each can be used once if you lose access to your authenticator app.'),
    '',
    ...result.data.recoveryCodes,
  ].join('\n'));
  logger.log('');
  logger.warn('These codes will not be shown again.');
}

export async function twoFactorDisableCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireSessionAuth();

  let code: string;
  let password: string;

  try {
    code = await input({
      message: 'Enter a current 2FA code from your authenticator app:',
      validate: (value) => value.length === 6 || 'Enter a 6-digit code',
    });
    password = await readHiddenInput('Password: ');
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  if (!password) {
    logger.error('Password is required');
    return;
  }

  const spinner = logger.spinner('Disabling 2FA...');
  const result = await api.disable2FA(code, password);

  if (result.error || !result.data) {
    spinner.fail('Failed to disable 2FA');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.succeed('Two-factor authentication disabled');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
  }
}

export async function twoFactorRecoveryCodesCommand(
  code: string,
  options: { json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireSessionAuth();

  const spinner = logger.spinner('Regenerating recovery codes...');
  const result = await api.regenerateRecoveryCodes(code);

  if (result.error || !result.data) {
    spinner.fail('Failed to regenerate recovery codes');
    logger.error(result.error || 'Unknown error');
    return;
  }

  spinner.succeed('Recovery codes regenerated');

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  logger.log('');
  logger.box('New Recovery Codes', [
    logger.yellow('Your old recovery codes are no longer valid. Save these somewhere safe.'),
    '',
    ...result.data.recoveryCodes,
  ].join('\n'));
  logger.log('');
}
