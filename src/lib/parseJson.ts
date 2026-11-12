import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** The largest file `@path` will read: a payload or config, not a data dump. */
export const MAX_JSON_FILE_BYTES = 1024 * 1024;

/** `~` and `~/...` to the home directory; the shell does not expand a `~` after `@`. */
function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Where JSON.parse failed, without any of the input. V8's message can quote ~10 characters around
 * the bad token ("Unexpected token 'w', ...\"ccessKey\":wJalrXUtnF\"... is not valid JSON"), which
 * for a credentials file is part of a secret, so only the line/column or position is kept.
 */
export function jsonErrorLocation(err: unknown, text: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const lineCol = /\(line (\d+) column (\d+)\)/.exec(message);
  if (lineCol) return `at line ${lineCol[1]}, column ${lineCol[2]}`;
  const position = /at position (\d+)/.exec(message);
  if (position) {
    const offset = Number(position[1]);
    const before = text.slice(0, offset).split('\n');
    return `at line ${before.length}, column ${before[before.length - 1].length + 1}`;
  }
  if (/end of JSON input/.test(message)) return 'unexpected end of input';
  return 'syntax error';
}

/**
 * Read a flag value that is inline JSON or `@path` to a JSON file (`--payload '{"a":1}'`,
 * `--patch @fix.json`, `--config @~/creds.json`). Returns the parsed value, or an error message
 * that names the flag and where the JSON broke, never the input itself.
 */
export function readJsonArg(raw: string, flag: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  let text = trimmed;
  let where = '';
  if (trimmed.startsWith('@') && trimmed.length > 1) {
    const shown = trimmed.slice(1);
    const path = expandHome(shown);
    try {
      const { size } = statSync(path);
      if (size > MAX_JSON_FILE_BYTES) {
        return { ok: false, error: `${flag}: ${shown} is ${size} bytes; the limit is ${MAX_JSON_FILE_BYTES} (1 MB)` };
      }
      text = readFileSync(path, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      return { ok: false, error: `${flag}: cannot read ${shown}${code ? ` (${code})` : ''}` };
    }
    where = ` in ${shown}`;
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: `${flag}: invalid JSON${where} (${jsonErrorLocation(err, text)})` };
  }
}

/** True for a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
