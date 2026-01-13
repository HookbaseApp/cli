import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

export async function logoutCommand(): Promise<void> {
  if (!config.isAuthenticated()) {
    logger.info('Not logged in');
    return;
  }

  const user = config.getCurrentUser();
  config.clearAuth();

  logger.success(`Logged out from ${user?.email}`);
}
