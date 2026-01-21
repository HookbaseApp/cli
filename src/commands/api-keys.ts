import { input, confirm, select } from '@inquirer/prompts';
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

export async function apiKeysListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching API keys...');
  const result = await api.listApiKeys();

  if (result.error) {
    spinner.fail('Failed to fetch API keys');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const keys = result.data?.apiKeys || [];

  if (options.json) {
    console.log(JSON.stringify(keys, null, 2));
    return;
  }

  if (keys.length === 0) {
    logger.info('No API keys found');
    logger.dim('Create one with "hookbase api-keys create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'Key Prefix', 'Scopes', 'Last Used', 'Created'],
    keys.map(k => [
      k.id || '-',
      k.name || '-',
      (k.key_prefix || 'whr_') + '...',
      Array.isArray(k.scopes) ? k.scopes.join(', ') :
        (typeof k.scopes === 'string' ? JSON.parse(k.scopes).join(', ') : 'read, write'),
      k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never',
      k.created_at ? new Date(k.created_at).toLocaleDateString() : '-',
    ])
  );
}

export async function apiKeysCreateCommand(options: {
  name?: string;
  scopes?: string;
  expires?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let scopes = options.scopes ? options.scopes.split(',').map(s => s.trim()) : undefined;
  let expiresInDays: number | undefined;

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    if (!name) {
      name = await input({
        message: 'API key name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      const scopeChoice = await select({
        message: 'Select permissions:',
        choices: [
          { name: 'Read & Write (full access)', value: 'read,write' },
          { name: 'Read only', value: 'read' },
          { name: 'Write only', value: 'write' },
        ],
      });
      scopes = scopeChoice.split(',');

      const setExpiry = await confirm({
        message: 'Set an expiration date?',
        default: false,
      });

      if (setExpiry) {
        const expiryChoice = await select({
          message: 'Expires in:',
          choices: [
            { name: '30 days', value: '30' },
            { name: '90 days', value: '90' },
            { name: '180 days', value: '180' },
            { name: '365 days', value: '365' },
          ],
        });
        expiresInDays = parseInt(expiryChoice, 10);
      }
    } else if (options.expires) {
      expiresInDays = parseInt(options.expires, 10);
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({
        message: `Create API key "${name}" with scopes [${scopes?.join(', ')}]?`,
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

  const spinner = logger.spinner('Creating API key...');
  const result = await api.createApiKey(name, scopes || ['read', 'write'], expiresInDays);

  if (result.error) {
    spinner.fail('Failed to create API key');
    logger.error(result.error);
    return;
  }

  spinner.succeed('API key created');

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  const key = result.data;
  if (key) {
    logger.log('');
    logger.box('API Key Created', [
      `Name:   ${key.apiKey.name}`,
      `Scopes: ${key.apiKey.scopes.join(', ')}`,
      ``,
      logger.yellow('Your API key (save this - it will not be shown again):'),
      ``,
      logger.bold(key.key),
    ].join('\n'));
    logger.log('');
    logger.warn('Store this key securely. You won\'t be able to see it again.');
  }
}

export async function apiKeysRevokeCommand(
  keyId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  // Check if we're trying to revoke the key currently in use
  if (config.isUsingApiKey()) {
    const currentPrefix = config.getCurrentApiKeyPrefix();
    if (currentPrefix) {
      // Fetch the key to check its prefix
      const keysResult = await api.listApiKeys();
      const keyToRevoke = keysResult.data?.apiKeys?.find(k => k.id === keyId);
      if (keyToRevoke && currentPrefix.startsWith(keyToRevoke.key_prefix)) {
        logger.error('Cannot revoke the API key currently being used for authentication.');
        logger.dim('Use a different API key or log in with username/password first.');
        return;
      }
    }
  }

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to revoke API key ${keyId}? This cannot be undone.`,
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

  const spinner = logger.spinner('Revoking API key...');
  const result = await api.revokeApiKey(keyId);

  if (result.error) {
    spinner.fail('Failed to revoke API key');
    logger.error(result.error);
    return;
  }

  spinner.succeed('API key revoked');

  if (options.json) {
    console.log(JSON.stringify({ success: true, keyId }, null, 2));
  }
}
