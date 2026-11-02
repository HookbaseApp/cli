/**
 * Tunnel bodies cross a text-only WebSocket frame. A body that is valid UTF-8 travels as plain
 * text; any other body is base64 with `bodyEncoding: 'base64'`, so binary webhooks (protobuf, gzip,
 * images) reach the local server byte for byte. Mirrors api/src/tunnels/body-encoding.ts.
 *
 * Only used after the server's `hello` frame announces `binary-bodies`: an older server would take
 * a base64 string for the body itself.
 */

export type BodyEncoding = 'base64';

export interface WireBody {
  body: string;
  bodyEncoding?: BodyEncoding;
}

/** Strict, and `ignoreBOM` so a leading BOM is kept instead of dropped. */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Text when the bytes are valid UTF-8, base64 otherwise. */
export function encodeBytes(bytes: Buffer): WireBody {
  try {
    return { body: STRICT_UTF8.decode(bytes) };
  } catch {
    return { body: bytes.toString('base64'), bodyEncoding: 'base64' };
  }
}

/** A request body from the server, as bytes to write to the local socket. */
export function bodyToBuffer(body: string, bodyEncoding?: string): Buffer {
  return bodyEncoding === 'base64' ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
}

/** Adds `binary=1` to the tunnel's WebSocket URL, keeping whatever query it already has. */
export function withBinaryFlag(wsUrl: string): string {
  try {
    const url = new URL(wsUrl);
    url.searchParams.set('binary', '1');
    return url.toString();
  } catch {
    return wsUrl;
  }
}
