import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { TunnelClient } from '../lib/tunnel.js';

export async function tunnelCommand(
  port: string,
  options: { name?: string; subdomain?: string }
): Promise<void> {
  // Check auth
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "webhookrelay login" first.');
    process.exit(1);
  }

  const org = config.getCurrentOrg();
  if (!org) {
    logger.error('No organization selected.');
    process.exit(1);
  }

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

  // Create or find tunnel
  const createSpinner = logger.spinner('Setting up tunnel...');

  // First check for existing tunnels
  const existingResult = await api.getTunnels();
  let tunnelInfo: api.CreateTunnelResponse | undefined;

  if (existingResult.data?.tunnels && existingResult.data.tunnels.length > 0) {
    // Reuse existing tunnel if available
    const existing = existingResult.data.tunnels.find(t => t.status === 'disconnected');
    if (existing) {
      // Need to get the full tunnel with auth token by creating a new one or using the existing
      // For now, create a new one
    }
  }

  // Create new tunnel
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

  tunnelInfo = result.data;
  createSpinner.succeed('Tunnel created');

  logger.log('');
  logger.box('Tunnel Info', [
    `Public URL: ${logger.cyan(tunnelInfo.tunnelUrl)}`,
    `Local:      ${logger.dimText(`http://localhost:${localPort}`)}`,
    `Subdomain:  ${tunnelInfo.tunnel.subdomain}`,
  ].join('\n'));
  logger.log('');

  // Connect to tunnel
  const connectSpinner = logger.spinner('Connecting...');

  const client = new TunnelClient({
    wsUrl: tunnelInfo.wsUrl,
    localPort,
    onConnect: () => {
      connectSpinner.succeed('Connected!');
      logger.log('');
      logger.success(`Forwarding ${tunnelInfo!.tunnelUrl} → localhost:${localPort}`);
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
    if (tunnelInfo) {
      await api.deleteTunnel(tunnelInfo.tunnel.id);
    }

    logger.success('Tunnel closed');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process running
  await new Promise(() => {});
}

export async function tunnelListCommand(): Promise<void> {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "webhookrelay login" first.');
    process.exit(1);
  }

  const spinner = logger.spinner('Fetching tunnels...');
  const result = await api.getTunnels();

  if (result.error) {
    spinner.fail('Failed to fetch tunnels');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const tunnels = result.data?.tunnels || [];

  if (tunnels.length === 0) {
    logger.info('No tunnels found');
    logger.dim('Run "webhookrelay tunnel <port>" to create one');
    return;
  }

  logger.table(
    ['Name', 'Subdomain', 'Status', 'Requests'],
    tunnels.map(t => [
      t.name,
      t.subdomain,
      t.status === 'connected' ? logger.green(t.status) :
        t.status === 'error' ? logger.red(t.status) :
        logger.dimText(t.status),
      t.total_requests.toString(),
    ])
  );
}
