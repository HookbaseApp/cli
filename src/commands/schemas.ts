import { readFileSync } from 'fs';
import { input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';
import { loadFeatures, ensureFeature } from '../lib/advanced.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

function requireAuth(): void {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" with an API key.');
    process.exit(1);
  }
}

export async function schemasListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching schemas...');
  const result = await api.getSchemas();
  if (result.error) { spinner.fail('Failed to fetch schemas'); logger.error(result.error); return; }
  spinner.stop();
  const schemas = (result.data?.schemas || []) as any[];
  if (options.json) { console.log(JSON.stringify(schemas, null, 2)); return; }
  if (schemas.length === 0) { logger.info('No schemas found'); logger.dim('Create one with "hookbase schemas create --file schema.json"'); return; }
  logger.table(
    ['ID', 'Name', 'Slug', 'Routes'],
    schemas.map((s) => [s.id, s.name, s.slug || '-', String(s.route_count ?? s.routeCount ?? 0)]),
  );
}

export async function schemasCreateCommand(options: {
  name?: string;
  file?: string;
  description?: string;
  json?: boolean;
}): Promise<void> {
  requireAuth();
  await loadFeatures();
  if (!ensureFeature('schemas', 'JSON Schemas')) return;

  let name = options.name;
  let raw: string | undefined;
  if (options.file) {
    try { raw = readFileSync(options.file, 'utf8'); }
    catch (e) { logger.error(`Could not read --file: ${(e as Error).message}`); return; }
  }

  try {
    if (!name) {
      name = await input({ message: 'Schema name:', validate: (v) => v.length > 0 || 'Name is required' });
    }
    if (raw === undefined) {
      raw = await input({ message: 'JSON Schema (paste a JSON object):' });
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }

  let jsonSchema: unknown;
  try { jsonSchema = JSON.parse(raw!); }
  catch { logger.error('Invalid JSON schema'); return; }
  if (!jsonSchema || typeof jsonSchema !== 'object') { logger.error('JSON schema must be an object'); return; }

  const spinner = logger.spinner('Creating schema...');
  const result = await api.createSchema({ name: name!, jsonSchema, description: options.description });
  if (result.error) { spinner.fail('Failed to create schema'); logger.error(result.error); return; }
  spinner.succeed('Schema created');
  if (options.json) { console.log(JSON.stringify(result.data?.schema, null, 2)); return; }
  const s = result.data?.schema;
  if (s) { logger.log(''); logger.box('Schema Created', [`ID:   ${s.id}`, `Name: ${s.name}`].join('\n')); }
}

export async function schemasGetCommand(schemaId: string, options: { json?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching schema...');
  const result = await api.getSchema(schemaId);
  if (result.error) { spinner.fail('Failed to fetch schema'); logger.error(result.error); return; }
  spinner.stop();
  const s = result.data?.schema as any;
  if (options.json) { console.log(JSON.stringify(s, null, 2)); return; }
  if (!s) { logger.error('Schema not found'); return; }
  logger.log('');
  logger.log(logger.bold('Schema Details'));
  logger.log('');
  logger.log(`ID:   ${s.id}`);
  logger.log(`Name: ${s.name}`);
  logger.log(`Slug: ${s.slug || '-'}`);
  logger.log('');
  logger.log('JSON Schema:');
  logger.log(JSON.stringify(s.jsonSchema ?? {}, null, 2));
  logger.log('');
}

export async function schemasDeleteCommand(schemaId: string, options: { yes?: boolean; json?: boolean }): Promise<void> {
  requireAuth();
  try {
    if (!options.yes) {
      const confirmed = await confirm({ message: `Delete schema ${schemaId}? This cannot be undone.`, default: false });
      if (!confirmed) { logger.info('Cancelled'); return; }
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }
  const spinner = logger.spinner('Deleting schema...');
  const result = await api.deleteSchema(schemaId);
  if (result.error) { spinner.fail('Failed to delete schema'); logger.error(result.error); return; }
  spinner.succeed('Schema deleted');
  if (options.json) console.log(JSON.stringify({ success: true, schemaId }, null, 2));
}
