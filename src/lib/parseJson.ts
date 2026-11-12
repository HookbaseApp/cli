import { readFileSync } from 'node:fs';

// Several API response fields come back as JSON-encoded strings rather than
// parsed objects (headers, config, scopes, etc.) — this normalizes either shape.
export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/**
 * Read a flag value that is inline JSON or `@path` to a JSON file (`--payload '{"a":1}'`,
 * `--patch @fix.json`). Returns the parsed value, or an error message that names the flag.
 */
export function readJsonArg(raw: string, flag: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  let text = trimmed;
  let where = '';
  if (trimmed.startsWith('@') && trimmed.length > 1) {
    const path = trimmed.slice(1);
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      return { ok: false, error: `${flag}: cannot read ${path} (${err instanceof Error ? err.message : String(err)})` };
    }
    where = ` in ${path}`;
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `${flag}: invalid JSON${where} (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** True for a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
