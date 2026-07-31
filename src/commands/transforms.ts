import { readFileSync } from 'fs';
import { input, confirm, select } from '@inquirer/prompts';
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

const TRANSFORM_TYPES = ['jsonata', 'javascript', 'liquid', 'xslt'] as const;

export async function transformsListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching transforms...');
  const result = await api.getTransforms();
  if (result.error) { spinner.fail('Failed to fetch transforms'); logger.error(result.error); return; }
  spinner.stop();
  const transforms = (result.data?.transforms || []) as any[];
  if (options.json) { console.log(JSON.stringify(transforms, null, 2)); return; }
  if (transforms.length === 0) { logger.info('No transforms found'); logger.dim('Create one with "hookbase transforms create"'); return; }
  logger.table(
    ['ID', 'Name', 'Type', 'Routes'],
    transforms.map((t) => [
      t.id,
      t.name,
      t.type || t.transformType || '-',
      String(t.route_count ?? t.routeCount ?? 0),
    ]),
  );
}

export async function transformsCreateCommand(options: {
  name?: string;
  type?: string;
  code?: string;
  file?: string;
  description?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();
  await loadFeatures();
  if (!ensureFeature('transforms', 'Transforms')) return;

  let name = options.name;
  let transformType = options.type;
  let code = options.code;
  if (options.file) {
    try { code = readFileSync(options.file, 'utf8'); }
    catch (e) { logger.error(`Could not read --file: ${(e as Error).message}`); return; }
  }

  try {
    if (!name) {
      name = await input({ message: 'Transform name:', validate: (v) => v.length > 0 || 'Name is required' });
    }
    if (!transformType) {
      transformType = await select({
        message: 'Transform type:',
        choices: TRANSFORM_TYPES.map((t) => ({ name: t, value: t })),
        default: 'jsonata',
      });
    }
    if (!code) {
      code = await input({ message: 'Transform code:', validate: (v) => v.length > 0 || 'Code is required' });
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }

  if (!(TRANSFORM_TYPES as readonly string[]).includes(transformType!)) {
    logger.error(`Invalid transform type "${transformType}" (valid: ${TRANSFORM_TYPES.join(', ')})`);
    return;
  }

  const spinner = logger.spinner('Creating transform...');
  const result = await api.createTransform({
    name: name!,
    code: code!,
    transformType: transformType as typeof TRANSFORM_TYPES[number],
    description: options.description,
  });
  if (result.error) { spinner.fail('Failed to create transform'); logger.error(result.error); return; }
  spinner.succeed('Transform created');
  if (options.json) { console.log(JSON.stringify(result.data?.transform, null, 2)); return; }
  const t = result.data?.transform;
  if (t) {
    logger.log('');
    logger.box('Transform Created', [`ID:   ${t.id}`, `Name: ${t.name}`].join('\n'));
  }
}

export async function transformsGetCommand(transformId: string, options: { json?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching transform...');
  const result = await api.getTransform(transformId);
  if (result.error) { spinner.fail('Failed to fetch transform'); logger.error(result.error); return; }
  spinner.stop();
  const t = result.data?.transform as any;
  if (options.json) { console.log(JSON.stringify(t, null, 2)); return; }
  if (!t) { logger.error('Transform not found'); return; }
  logger.log('');
  logger.log(logger.bold('Transform Details'));
  logger.log('');
  logger.log(`ID:   ${t.id}`);
  logger.log(`Name: ${t.name}`);
  logger.log(`Type: ${t.type || t.transformType || '-'}`);
  logger.log('');
  logger.log('Code:');
  logger.log(t.code ?? t.expression ?? '(none)');
  logger.log('');
}

export async function transformsDeleteCommand(transformId: string, options: { yes?: boolean; json?: boolean }): Promise<void> {
  requireAuth();
  try {
    if (!options.yes) {
      const confirmed = await confirm({ message: `Delete transform ${transformId}? This cannot be undone.`, default: false });
      if (!confirmed) { logger.info('Cancelled'); return; }
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }
  const spinner = logger.spinner('Deleting transform...');
  const result = await api.deleteTransform(transformId);
  if (result.error) { spinner.fail('Failed to delete transform'); logger.error(result.error); return; }
  spinner.succeed('Transform deleted');
  if (options.json) console.log(JSON.stringify({ success: true, transformId }, null, 2));
}
