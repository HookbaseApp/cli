import * as config from './config.js';
import * as logger from './logger.js';

/**
 * True if the CLI has usable credentials for org-scoped resource endpoints
 * (sources, destinations, events, routes, etc). The server accepts either an
 * API key (its org is implicit in the key itself) or a session token — but a
 * session isn't tied to one org the way a key is, so it also needs a current
 * org selected before the CLI knows which org's URL to call.
 */
export function isAuthReady(): boolean {
  if (config.isAuthenticated()) {
    return true;
  }
  return config.hasSession() && !!config.getCurrentOrg();
}

/** Explains why `isAuthReady()` is false. Empty string if it's actually true. */
export function authErrorMessage(): string {
  if (isAuthReady()) {
    return '';
  }

  if (config.hasSession()) {
    return 'No organization selected. Run "hookbase org switch <idOrSlug>" first.';
  }

  return 'Not logged in. Run "hookbase login".';
}

/** Guard for commands (as opposed to TUI views, which can't process.exit mid-render). */
export function requireAuth(): void {
  if (isAuthReady()) {
    return;
  }
  logger.error(authErrorMessage());
  process.exit(1);
}
