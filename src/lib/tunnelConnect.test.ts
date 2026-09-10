import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveWsUrl, parseSkipStatus, probeLocalhost } from './tunnelConnect.js';
import * as logger from './logger.js';

describe('resolveWsUrl', () => {
  const originalEnv = process.env.HOOKBASE_API_URL;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HOOKBASE_API_URL;
    else process.env.HOOKBASE_API_URL = originalEnv;
  });

  it('passes through unchanged when pointed at production', () => {
    process.env.HOOKBASE_API_URL = 'https://api.hookbase.app';
    const wsUrl = 'wss://api.hookbase.app/tunnel/abc';
    expect(resolveWsUrl(wsUrl)).toBe(wsUrl);
  });

  it('rewrites host/protocol for a custom local API URL', () => {
    process.env.HOOKBASE_API_URL = 'http://localhost:8787';
    const result = resolveWsUrl('wss://api.hookbase.app/tunnel/abc');
    expect(result).toBe('ws://localhost:8787/tunnel/abc');
  });

  it('rewrites to wss when the custom URL is https', () => {
    process.env.HOOKBASE_API_URL = 'https://staging.example.com';
    const result = resolveWsUrl('wss://api.hookbase.app/tunnel/abc');
    expect(result).toBe('wss://staging.example.com/tunnel/abc');
  });
});

describe('parseSkipStatus', () => {
  it('returns undefined when no value is given', () => {
    expect(parseSkipStatus(undefined)).toBeUndefined();
  });

  it('returns the parsed value for a valid status code', () => {
    expect(parseSkipStatus('204')).toBe(204);
    expect(parseSkipStatus('599')).toBe(599);
    expect(parseSkipStatus('100')).toBe(100);
  });

  it('falls back to 204 and warns for an out-of-range value', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(parseSkipStatus('999')).toBe(204);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('falls back to 204 and warns for a non-numeric value', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(parseSkipStatus('abc')).toBe(204);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('probeLocalhost', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns true when the port responds', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 })) as typeof fetch;
    expect(await probeLocalhost(3000)).toBe(true);
  });

  it('returns false when fetch rejects (connection refused)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;
    expect(await probeLocalhost(3000)).toBe(false);
  });

  it('returns false on timeout/abort', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')) as unknown as typeof fetch;
    expect(await probeLocalhost(3000)).toBe(false);
  });
});
