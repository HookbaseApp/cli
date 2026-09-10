import { toXml } from './xml.js';
import { toYaml } from './yaml.js';

/** Shared by every command's --json/--xml/--yaml output path. */
export function formatOutput(data: unknown, xml?: boolean, yaml?: boolean): string {
  if (yaml) return toYaml(data);
  if (xml) return toXml(data);
  return JSON.stringify(data, null, 2);
}
