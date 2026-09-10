import { readFileSync } from 'fs';
import { input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';
import { loadFeatures, ensureFeature } from '../lib/advanced.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

export async function schemasListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching schemas...');
  const result = await api.getSchemas();
  if (result.error) { spinner.fail('Failed to fetch schemas'); logger.error(result.error); return; }
  spinner.stop();
  const schemas = (result.data?.schemas || []) as any[];
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(schemas, options.xml, options.yaml)); return; }
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
  xml?: boolean;
  yaml?: boolean;
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
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(result.data?.schema, options.xml, options.yaml)); return; }
  const s = result.data?.schema;
  if (s) { logger.log(''); logger.box('Schema Created', [`ID:   ${s.id}`, `Name: ${s.name}`].join('\n')); }
}

export async function schemasGetCommand(schemaId: string, options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching schema...');
  const result = await api.getSchema(schemaId);
  if (result.error) { spinner.fail('Failed to fetch schema'); logger.error(result.error); return; }
  spinner.stop();
  const s = result.data?.schema as any;
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(s, options.xml, options.yaml)); return; }
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

export async function schemasUpdateCommand(
  schemaId: string,
  options: {
    name?: string;
    description?: string;
    file?: string;
    json?: boolean;
    xml?: boolean;
    yaml?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: { name?: string; description?: string; jsonSchema?: unknown } = {};

  if (options.name) updateData.name = options.name;
  if (options.description !== undefined) updateData.description = options.description;
  if (options.file) {
    let raw: string;
    try { raw = readFileSync(options.file, 'utf8'); }
    catch (e) { logger.error(`Could not read --file: ${(e as Error).message}`); return; }
    try { updateData.jsonSchema = JSON.parse(raw); }
    catch { logger.error('Invalid JSON schema'); return; }
  }

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --description, or --file');
    return;
  }

  const spinner = logger.spinner('Updating schema...');
  const result = await api.updateSchema(schemaId, updateData);

  if (result.error) {
    spinner.fail('Failed to update schema');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Schema updated');
  if (options.json || options.xml || options.yaml) console.log(formatOutput(result.data, options.xml, options.yaml));
}

export async function schemasValidateCommand(
  schemaId: string,
  options: { payload?: string; file?: string; json?: boolean; xml?: boolean; yaml?: boolean }
): Promise<void> {
  requireAuth();

  let raw: string | undefined = options.payload;
  if (!raw && options.file) {
    try { raw = readFileSync(options.file, 'utf8'); }
    catch (e) { logger.error(`Could not read --file: ${(e as Error).message}`); return; }
  }
  if (!raw) {
    logger.error('Provide a payload with --payload <json> or --file <path>');
    return;
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { logger.error('Invalid JSON payload'); return; }

  const spinner = logger.spinner('Validating payload...');
  const result = await api.validateSchema(schemaId, payload);

  if (result.error) {
    spinner.fail('Failed to validate payload');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  if (options.json || options.xml || options.yaml) {
    console.log(formatOutput(result.data, options.xml, options.yaml));
    return;
  }

  if (result.data?.valid) {
    logger.success('Payload is valid');
  } else {
    logger.error('Payload is invalid');
    for (const err of result.data?.errors || []) {
      logger.log(`  - ${err.path ? `${err.path}: ` : ''}${err.message}`);
    }
  }
}

export async function schemasDeleteCommand(schemaId: string, options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
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
  if (options.json || options.xml || options.yaml) console.log(formatOutput({ success: true, schemaId }, options.xml, options.yaml));
}
