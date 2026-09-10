import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

export async function logoutCommand(): Promise<void> {
  const hasApiKey = config.isAuthenticated() || config.hasStaleJwtToken();
  const hasSession = config.hasSession();

  if (!hasApiKey && !hasSession) {
    logger.info('Not logged in');
    return;
  }

  const identities = new Set<string>();

  if (hasApiKey) {
    const user = config.getCurrentUser();
    identities.add(user?.email || 'API key authentication');
    config.clearAuth();
  }

  if (hasSession) {
    const sessionUser = config.getSessionUser();
    identities.add(sessionUser?.email || 'session');
    config.clearSession();
  }

  logger.success(`Logged out from ${Array.from(identities).join(' and ')}`);
}
