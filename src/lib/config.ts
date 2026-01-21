import Conf from 'conf';

interface ConfigSchema {
  apiUrl: string;
  authToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  userEmail: string | null;
  displayName: string | null;
  currentOrgId: string | null;
  currentOrgSlug: string | null;
}

const config = new Conf<ConfigSchema>({
  projectName: 'hookbase-cli',
  defaults: {
    apiUrl: 'https://api.hookbase.app',
    authToken: null,
    refreshToken: null,
    userId: null,
    userEmail: null,
    displayName: null,
    currentOrgId: null,
    currentOrgSlug: null,
  },
});

// Environment variable overrides
// HOOKBASE_API_KEY - API key for authentication
// HOOKBASE_API_URL - Custom API URL
// HOOKBASE_ORG_ID - Organization ID override
// HOOKBASE_DEBUG - Enable debug mode

export function getApiUrl(): string {
  return process.env.HOOKBASE_API_URL || config.get('apiUrl');
}

export function setApiUrl(url: string): void {
  config.set('apiUrl', url);
}

export function getAuthToken(): string | null {
  // Environment variable takes precedence
  if (process.env.HOOKBASE_API_KEY) {
    return process.env.HOOKBASE_API_KEY;
  }
  return config.get('authToken');
}

export function setAuth(token: string, userId: string, email: string, displayName: string, refreshToken?: string): void {
  config.set('authToken', token);
  config.set('userId', userId);
  config.set('userEmail', email);
  config.set('displayName', displayName);
  if (refreshToken) {
    config.set('refreshToken', refreshToken);
  }
}

export function clearAuth(): void {
  config.set('authToken', null);
  config.set('refreshToken', null);
  config.set('userId', null);
  config.set('userEmail', null);
  config.set('displayName', null);
  config.set('currentOrgId', null);
  config.set('currentOrgSlug', null);
}

export function isAuthenticated(): boolean {
  return !!(process.env.HOOKBASE_API_KEY || config.get('authToken'));
}

export function getCurrentUser(): { id: string; email: string; displayName: string } | null {
  const userId = config.get('userId');
  const userEmail = config.get('userEmail');
  const displayName = config.get('displayName');

  if (!userId || !userEmail || !displayName) {
    return null;
  }

  return { id: userId, email: userEmail, displayName };
}

export function getCurrentOrg(): { id: string; slug: string } | null {
  // Environment variable override
  if (process.env.HOOKBASE_ORG_ID) {
    return { id: process.env.HOOKBASE_ORG_ID, slug: process.env.HOOKBASE_ORG_SLUG || '' };
  }

  const id = config.get('currentOrgId');
  const slug = config.get('currentOrgSlug');

  if (!id || !slug) {
    return null;
  }

  return { id, slug };
}

export function setCurrentOrg(id: string, slug: string): void {
  config.set('currentOrgId', id);
  config.set('currentOrgSlug', slug);
}

export function getConfigPath(): string {
  return config.path;
}

export function isDebugMode(): boolean {
  return process.env.HOOKBASE_DEBUG === '1' || process.env.HOOKBASE_DEBUG === 'true';
}

/**
 * Check if we're currently authenticated via an API key (vs JWT)
 */
export function isUsingApiKey(): boolean {
  const token = getAuthToken();
  return !!token && token.startsWith('whr_');
}

/**
 * Get the prefix of the currently used API key (if using one)
 * Returns null if not using an API key
 */
export function getCurrentApiKeyPrefix(): string | null {
  const token = getAuthToken();
  if (!token || !token.startsWith('whr_')) {
    return null;
  }
  // API key format: whr_<prefix>_<secret>
  // The key_prefix stored in DB is the first part before the secret
  // We need to extract enough to match against key_prefix in API response
  // Typically key_prefix is something like "whr_abc123" (first 10-15 chars)
  return token.substring(0, Math.min(token.length, 15));
}

// Get all config as an object (for debugging)
export function getAllConfig(): ConfigSchema {
  return {
    apiUrl: getApiUrl(),
    authToken: getAuthToken() ? '***' : null,
    refreshToken: config.get('refreshToken') ? '***' : null,
    userId: config.get('userId'),
    userEmail: config.get('userEmail'),
    displayName: config.get('displayName'),
    currentOrgId: getCurrentOrg()?.id || null,
    currentOrgSlug: getCurrentOrg()?.slug || null,
  };
}
