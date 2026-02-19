import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { TunnelClient } from '../lib/tunnel.js';

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

function formatStatus(status: string): string {
  switch (status) {
    case 'connected':
      return logger.green('connected');
    case 'disconnected':
      return logger.dimText('disconnected');
    case 'error':
      return logger.red('error');
    default:
      return logger.dimText(status);
  }
}

export async function tunnelsListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching tunnels...');
  const result = await api.getTunnels();

  if (result.error) {
    spinner.fail('Failed to fetch tunnels');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const tunnels = result.data?.tunnels || [];

  if (options.json) {
    console.log(JSON.stringify(tunnels, null, 2));
    return;
  }

  if (tunnels.length === 0) {
    logger.info('No tunnels found');
    logger.dim('Create one with "hookbase tunnels create" or "hookbase tunnels start <port>"');
    return;
  }

  const apiUrl = config.getApiUrl();
  const tunnelDomain = `${apiUrl}/t`;

  logger.table(
    ['ID', 'Name', 'Subdomain', 'Status', 'Requests', 'Last Connected'],
    tunnels.map((t: any) => [
      t.id,
      t.name,
      t.subdomain,
      formatStatus(t.status),
      String(t.total_requests ?? t.totalRequests ?? 0),
      (t.last_connected_at || t.lastConnectedAt) ? new Date(t.last_connected_at || t.lastConnectedAt).toLocaleDateString() : 'Never',
    ])
  );

  logger.log('');
  logger.dim(`Tunnel URL format: ${tunnelDomain}/<subdomain>`);
}

export async function tunnelsCreateCommand(options: {
  name?: string;
  subdomain?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let subdomain = options.subdomain;

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    if (!name) {
      name = await input({
        message: 'Tunnel name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      const customSubdomain = await confirm({
        message: 'Set a custom subdomain? (Pro feature)',
        default: false,
      });

      if (customSubdomain) {
        subdomain = await input({
          message: 'Subdomain:',
          validate: (value) => /^[a-z0-9-]+$/.test(value) || 'Subdomain must be lowercase letters, numbers, and hyphens',
        });
      }
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({
        message: `Create tunnel "${name}"${subdomain ? ` with subdomain "${subdomain}"` : ''}?`,
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

  const spinner = logger.spinner('Creating tunnel...');
  const result = await api.createTunnel(name!, subdomain);

  if (result.error) {
    spinner.fail('Failed to create tunnel');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Tunnel created');

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  const tunnelInfo = result.data;
  if (tunnelInfo) {
    logger.log('');
    logger.box('Tunnel Created', [
      `ID:        ${tunnelInfo.tunnel.id}`,
      `Name:      ${tunnelInfo.tunnel.name}`,
      `Subdomain: ${tunnelInfo.tunnel.subdomain}`,
      `URL:       ${tunnelInfo.tunnelUrl}`,
      ``,
      `Connect with: hookbase tunnels connect ${tunnelInfo.tunnel.id} <port>`,
    ].join('\n'));
  }
}

export async function tunnelsConnectCommand(
  tunnelId: string,
  port: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const localPort = parseInt(port, 10);
  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    logger.error('Invalid port number');
    process.exit(1);
  }

  // First get the tunnel info
  const spinner = logger.spinner('Fetching tunnel...');
  const tunnelResult = await api.getTunnel(tunnelId);

  if (tunnelResult.error) {
    spinner.fail('Failed to fetch tunnel');
    logger.error(tunnelResult.error);
    return;
  }

  const tunnel = tunnelResult.data?.tunnel;
  if (!tunnel) {
    spinner.fail('Tunnel not found');
    return;
  }

  if (tunnel.status === 'connected') {
    spinner.fail('Tunnel is already connected');
    logger.dim('Use "hookbase tunnels disconnect" first or use a different tunnel');
    return;
  }

  // Regenerate token to get the auth token
  const tokenResult = await api.regenerateTunnelToken(tunnelId);
  if (tokenResult.error) {
    spinner.fail('Failed to get tunnel token');
    logger.error(tokenResult.error);
    return;
  }

  spinner.stop();

  const authToken = tokenResult.data?.authToken;
  if (!authToken) {
    logger.error('Failed to get auth token');
    return;
  }

  // Build WebSocket URL
  const apiUrl = config.getApiUrl();
  const wsUrl = apiUrl
    .replace('https://', 'wss://')
    .replace('http://', 'ws://') +
    `/tunnels/${tunnel.subdomain}/ws?tunnelId=${tunnel.id}&token=${authToken}`;

  const tunnelUrl = `${apiUrl}/t/${tunnel.subdomain}`;

  logger.log('');
  logger.box('Tunnel Info', [
    `Public URL: ${logger.cyan(tunnelUrl)}`,
    `Local:      ${logger.dimText(`http://localhost:${localPort}`)}`,
    `Subdomain:  ${tunnel.subdomain}`,
  ].join('\n'));
  logger.log('');

  // Connect
  const connectSpinner = logger.spinner('Connecting...');

  const client = new TunnelClient({
    wsUrl,
    localPort,
    onConnect: () => {
      connectSpinner.succeed('Connected!');
      logger.log('');
      logger.success(`Forwarding ${tunnelUrl} → localhost:${localPort}`);
      logger.log('');
      logger.dim('Press Ctrl+C to stop the tunnel');
      logger.log('');
      logger.log(logger.dimText('─'.repeat(60)));
      logger.log(logger.dimText('Incoming requests:'));
    },
    onDisconnect: () => {
      logger.warn('Disconnected from tunnel server');
    },
    onRequest: (method, path, status, duration) => {
      logger.requestLog(method, path, status, duration);
    },
    onError: (error) => {
      logger.error(`WebSocket error: ${error.message}`);
    },
  });

  try {
    await client.connect();
  } catch (error) {
    connectSpinner.fail('Failed to connect');
    logger.error(error instanceof Error ? error.message : 'Connection failed');
    process.exit(1);
  }

  // Handle shutdown
  const shutdown = async () => {
    logger.log('');
    logger.info('Disconnecting from tunnel...');
    client.close();
    logger.success('Disconnected');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process running
  await new Promise(() => {});
}

export async function tunnelsStartCommand(
  port: string,
  options: { name?: string; subdomain?: string; json?: boolean }
): Promise<void> {
  requireAuth();

  const localPort = parseInt(port, 10);
  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    logger.error('Invalid port number');
    process.exit(1);
  }

  // Check if port is accessible
  const spinner = logger.spinner(`Checking localhost:${localPort}...`);

  try {
    const testResult = await fetch(`http://localhost:${localPort}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);

    if (!testResult) {
      spinner.warn(`localhost:${localPort} not responding (tunnel will still work)`);
    } else {
      spinner.succeed(`localhost:${localPort} is accessible`);
    }
  } catch {
    spinner.warn(`Could not verify localhost:${localPort} (tunnel will still work)`);
  }

  // Create new tunnel
  const createSpinner = logger.spinner('Creating tunnel...');
  const tunnelName = options.name || `tunnel-${localPort}`;
  const result = await api.createTunnel(tunnelName, options.subdomain);

  if (result.error) {
    createSpinner.fail('Failed to create tunnel');
    logger.error(result.error);
    process.exit(1);
  }

  if (!result.data) {
    createSpinner.fail('Failed to create tunnel');
    process.exit(1);
  }

  const tunnelInfo = result.data;
  createSpinner.succeed('Tunnel created');

  logger.log('');
  logger.box('Tunnel Info', [
    `Public URL: ${logger.cyan(tunnelInfo.tunnelUrl)}`,
    `Local:      ${logger.dimText(`http://localhost:${localPort}`)}`,
    `Subdomain:  ${tunnelInfo.tunnel.subdomain}`,
  ].join('\n'));
  logger.log('');

  // Connect
  const connectSpinner = logger.spinner('Connecting...');

  const client = new TunnelClient({
    wsUrl: tunnelInfo.wsUrl,
    localPort,
    onConnect: () => {
      connectSpinner.succeed('Connected!');
      logger.log('');
      logger.success(`Forwarding ${tunnelInfo.tunnelUrl} → localhost:${localPort}`);
      logger.log('');
      logger.dim('Press Ctrl+C to stop the tunnel');
      logger.log('');
      logger.log(logger.dimText('─'.repeat(60)));
      logger.log(logger.dimText('Incoming requests:'));
    },
    onDisconnect: () => {
      logger.warn('Disconnected from tunnel server');
    },
    onRequest: (method, path, status, duration) => {
      logger.requestLog(method, path, status, duration);
    },
    onError: (error) => {
      logger.error(`WebSocket error: ${error.message}`);
    },
  });

  try {
    await client.connect();
  } catch (error) {
    connectSpinner.fail('Failed to connect');
    logger.error(error instanceof Error ? error.message : 'Connection failed');
    process.exit(1);
  }

  // Handle shutdown
  const shutdown = async () => {
    logger.log('');
    logger.info('Shutting down tunnel...');
    client.close();

    // Delete the tunnel
    await api.deleteTunnel(tunnelInfo.tunnel.id);

    logger.success('Tunnel closed');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process running
  await new Promise(() => {});
}

export async function tunnelsDisconnectCommand(
  tunnelId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Disconnect tunnel ${tunnelId}?`,
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

  const spinner = logger.spinner('Disconnecting tunnel...');
  const result = await api.disconnectTunnel(tunnelId);

  if (result.error) {
    spinner.fail('Failed to disconnect tunnel');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Tunnel disconnected');

  if (options.json) {
    console.log(JSON.stringify({ success: true, tunnelId }, null, 2));
  }
}

export async function tunnelsDeleteCommand(
  tunnelId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete tunnel ${tunnelId}? This cannot be undone.`,
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

  const spinner = logger.spinner('Deleting tunnel...');
  const result = await api.deleteTunnel(tunnelId);

  if (result.error) {
    spinner.fail('Failed to delete tunnel');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Tunnel deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, tunnelId }, null, 2));
  }
}

export async function tunnelsStatusCommand(
  tunnelId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching tunnel status...');
  const result = await api.getTunnelStatus(tunnelId);

  if (result.error) {
    spinner.fail('Failed to fetch tunnel status');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const { tunnel, liveStatus } = result.data || {};

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  if (!tunnel) {
    logger.error('Tunnel not found');
    return;
  }

  const apiUrl = config.getApiUrl();
  const tunnelUrl = `${apiUrl}/t/${tunnel.subdomain}`;

  logger.log('');
  logger.log(logger.bold('Tunnel Status'));
  logger.log('');
  logger.log(`ID:             ${tunnel.id}`);
  logger.log(`Name:           ${tunnel.name}`);
  logger.log(`Subdomain:      ${tunnel.subdomain}`);
  logger.log(`URL:            ${tunnelUrl}`);
  logger.log(`Status:         ${formatStatus(tunnel.status)}`);
  logger.log(`Total Requests: ${tunnel.total_requests ?? (tunnel as any).totalRequests ?? 0}`);
  logger.log(`Last Connected: ${(tunnel.last_connected_at || (tunnel as any).lastConnectedAt) ? new Date(tunnel.last_connected_at || (tunnel as any).lastConnectedAt).toLocaleString() : 'Never'}`);

  if (liveStatus && typeof liveStatus === 'object') {
    logger.log('');
    logger.log(logger.bold('Live Status:'));
    logger.log(JSON.stringify(liveStatus, null, 2));
  }
}

export async function tunnelsGetCommand(
  tunnelId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching tunnel...');
  const result = await api.getTunnel(tunnelId);

  if (result.error) {
    spinner.fail('Failed to fetch tunnel');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const tunnel = result.data?.tunnel;

  if (options.json) {
    console.log(JSON.stringify(tunnel, null, 2));
    return;
  }

  if (!tunnel) {
    logger.error('Tunnel not found');
    return;
  }

  const apiUrl = config.getApiUrl();
  const tunnelUrl = `${apiUrl}/t/${tunnel.subdomain}`;

  logger.log('');
  logger.log(logger.bold('Tunnel Details'));
  logger.log('');
  logger.log(`ID:             ${tunnel.id}`);
  logger.log(`Name:           ${tunnel.name}`);
  logger.log(`Subdomain:      ${tunnel.subdomain}`);
  logger.log(`URL:            ${tunnelUrl}`);
  logger.log(`Status:         ${formatStatus(tunnel.status)}`);
  logger.log(`Total Requests: ${tunnel.total_requests ?? (tunnel as any).totalRequests ?? 0}`);
  logger.log(`Last Connected: ${(tunnel.last_connected_at || (tunnel as any).lastConnectedAt) ? new Date(tunnel.last_connected_at || (tunnel as any).lastConnectedAt).toLocaleString() : 'Never'}`);
  logger.log('');

  if (tunnel.status === 'disconnected') {
    logger.dim(`Connect with: hookbase tunnels connect ${tunnel.id} <port>`);
  }
}
