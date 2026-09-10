import * as config from './config.js';
import * as logger from './logger.js';

/** Rewrite wsUrl to match the configured API URL (for local dev). */
export function resolveWsUrl(wsUrl: string): string {
  const apiUrl = config.getApiUrl();
  // If using a custom API URL (e.g. http://localhost:8787), rewrite the wsUrl
  if (apiUrl && !apiUrl.includes('hookbase.app')) {
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrlParsed = new URL(wsUrl);
    wsUrlParsed.protocol = protocol;
    wsUrlParsed.host = url.host;
    return wsUrlParsed.toString();
  }
  return wsUrl;
}

/**
 * Validates a --filter-skip-status value: an invalid value would otherwise
 * become NaN and make the relay return 504 for every filtered webhook.
 */
export function parseSkipStatus(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) {
    logger.warn(`Invalid --filter-skip-status "${raw}" (expected 100-599); using 204.`);
    return 204;
  }
  return parsed;
}

/** Probes localhost:port with a 2s-timeout HEAD request. */
export async function probeLocalhost(port: number): Promise<boolean> {
  try {
    const result = await fetch(`http://localhost:${port}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    return result !== null;
  } catch {
    return false;
  }
}
