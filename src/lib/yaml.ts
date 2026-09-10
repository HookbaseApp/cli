/** True for scalars that would otherwise be misread (empty, numeric-looking, YAML keyword, etc). */
function needsQuoting(value: string): boolean {
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true;
  if (value.includes('\n')) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) return true;
  // Indicator characters are only ambiguous as the first character of a plain scalar.
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(value)) return true;
  // "key: value" and "value  # comment" syntax means ": " / " #" are unsafe anywhere,
  // and a trailing ':' reads as an empty-valued mapping key.
  if (/:\s|\s#|:$/.test(value)) return true;
  return false;
}

function scalarToYaml(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return needsQuoting(value) ? JSON.stringify(value) : value;
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Renders `value` as a block of already-indented lines (no trailing newline). */
function valueToLines(value: unknown, indent: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    const lines: string[] = [];
    for (const item of value) {
      if ((isPlainObject(item) && Object.keys(item).length > 0) || (Array.isArray(item) && item.length > 0)) {
        const itemLines = valueToLines(item, `${indent}  `);
        // Splice the "- " marker into the first line in place of its own 2-space indent.
        lines.push(`${indent}- ${itemLines[0].slice(indent.length + 2)}`);
        lines.push(...itemLines.slice(1));
      } else {
        lines.push(`${indent}- ${scalarToYaml(item)}`);
      }
    }
    return lines;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${indent}{}`];
    const lines: string[] = [];
    for (const [key, val] of entries) {
      if (isPlainObject(val) && Object.keys(val).length > 0) {
        lines.push(`${indent}${key}:`);
        lines.push(...valueToLines(val, `${indent}  `));
      } else if (Array.isArray(val) && val.length > 0) {
        lines.push(`${indent}${key}:`);
        lines.push(...valueToLines(val, indent));
      } else if (isPlainObject(val)) {
        lines.push(`${indent}${key}: {}`);
      } else if (Array.isArray(val)) {
        lines.push(`${indent}${key}: []`);
      } else {
        lines.push(`${indent}${key}: ${scalarToYaml(val)}`);
      }
    }
    return lines;
  }

  return [`${indent}${scalarToYaml(value)}`];
}

/** Generic JSON-shaped-data-to-YAML serializer, used by every command's `--yaml` output. */
export function toYaml(data: unknown): string {
  return valueToLines(data, '').join('\n') + '\n';
}
