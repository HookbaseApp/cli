import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

export async function forwardCommand(url: string): Promise<void> {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "webhookrelay login" first.');
    process.exit(1);
  }

  // Parse URL to extract port
  try {
    const parsedUrl = new URL(url);
    const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');

    logger.info(`Quick forwarding is a shortcut for creating a tunnel.`);
    logger.log('');
    logger.log(`Run the following command instead:`);
    logger.log('');
    logger.log(`  webhookrelay tunnel ${port}`);
    logger.log('');
    logger.dim('This will create a tunnel to forward webhooks to your local server.');
  } catch {
    logger.error('Invalid URL format');
    logger.dim('Example: webhookrelay forward http://localhost:3000');
  }
}
