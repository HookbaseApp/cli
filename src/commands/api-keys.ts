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
    if (config.hasStaleJwtToken()) {
      logger.error('Your session uses a JWT token which is no longer supported. Please re-login with an API key: hookbase login');
    } else {
      logger.error('Not logged in. Run "hookbase login" with an API key.');
    }
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

  const raw = result.data as any;
  const keys = raw?.apiKeys || raw?.api_keys || raw?.data || [];

  if (options.json) {
    console.log(JSON.stringify(keys, null, 2));
    return;
  }

  if (keys.length === 0) {
    logger.info('No API keys found');
    logger.dim('Create one with "hookbase api-keys create"');
    return;
  }

  const parseScopes = (scopes: unknown): string => {
    if (Array.isArray(scopes)) return scopes.join(', ');
    if (typeof scopes === 'string') {
      try { return JSON.parse(scopes).join(', '); } catch { return scopes; }
    }
    return 'read, write';
  };

  logger.table(
    ['ID', 'Name', 'Key Prefix', 'Scopes', 'Created'],
    keys.map((k: any) => [
      k.id || '-',
      k.name || '-',
      (k.key_prefix || k.keyPrefix || 'whr_') + '...',
      parseScopes(k.scopes),
      (k.created_at || k.createdAt) ? new Date(k.created_at || k.createdAt).toLocaleDateString() : '-',
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
          { name: 'Full access (read, write, delete)', value: 'read,write,delete' },
          { name: 'Read & Write (no delete)', value: 'read,write' },
          { name: 'Read only', value: 'read' },
          { name: 'Write only (create/update)', value: 'write' },
          { name: 'Delete only', value: 'delete' },
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
  const result = await api.createApiKey(name, scopes || ['read', 'write', 'delete'], expiresInDays);

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
      const keysRaw = keysResult.data as any;
      const allKeys = keysRaw?.apiKeys || keysRaw?.api_keys || keysRaw?.data || [];
      const keyToRevoke = allKeys.find((k: any) => k.id === keyId);
      if (keyToRevoke && currentPrefix.startsWith(keyToRevoke.key_prefix || keyToRevoke.keyPrefix || '')) {
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
