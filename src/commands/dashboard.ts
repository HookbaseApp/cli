import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

export async function dashboardCommand(): Promise<void> {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }

  // Dynamic import to avoid loading React when not needed
  const { runApp } = await import('../tui/App.js');
  await runApp();
}

export async function tunnelMonitorCommand(
  tunnelId: string,
  port: string
): Promise<void> {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }

  const localPort = parseInt(port, 10);
  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    logger.error('Invalid port number');
    process.exit(1);
  }

  // Dynamic import to avoid loading React when not needed
  const { runTunnelMonitor } = await import('../tui/TunnelMonitor.js');
  await runTunnelMonitor(tunnelId, localPort);
}
