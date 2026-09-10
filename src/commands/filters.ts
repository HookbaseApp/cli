import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as logger from '../lib/logger.js';
import { promptFilterConditions } from './routes.js';

import { requireAuth } from '../lib/requireAuth.js';
import { formatOutput } from '../lib/output.js';

function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

const FILTER_OPERATORS = [
  'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
  'exists', 'not_exists', 'greater_than', 'less_than', 'regex',
] as const;

/** Parse a "field:operator:value" flag into a FilterCondition. */
function parseConditionFlag(raw: string): api.FilterCondition | null {
  const i1 = raw.indexOf(':');
  if (i1 === -1) { logger.warn(`Ignoring malformed --condition "${raw}" (expected field:operator:value)`); return null; }
  const i2 = raw.indexOf(':', i1 + 1);
  const field = raw.slice(0, i1).trim();
  const operator = (i2 === -1 ? raw.slice(i1 + 1) : raw.slice(i1 + 1, i2)).trim();
  const value = i2 === -1 ? undefined : raw.slice(i2 + 1);
  if (!field || !(FILTER_OPERATORS as readonly string[]).includes(operator)) {
    logger.warn(`Ignoring --condition "${raw}" (operator must be one of: ${FILTER_OPERATORS.join(', ')})`);
    return null;
  }
  return { field, operator: operator as api.FilterCondition['operator'], value };
}

export async function filtersListCommand(options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching filters...');
  const result = await api.getFilters();
  if (result.error) { spinner.fail('Failed to fetch filters'); logger.error(result.error); return; }
  spinner.stop();
  const filters = (result.data?.filters || []) as any[];
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(filters, options.xml, options.yaml)); return; }
  if (filters.length === 0) { logger.info('No filters found'); logger.dim('Create one with "hookbase filters create"'); return; }
  logger.table(
    ['ID', 'Name', 'Logic', 'Conditions', 'Routes'],
    filters.map((f) => [
      f.id,
      f.name,
      f.logic || 'AND',
      String((f.conditions || []).length),
      String(f.route_count ?? f.routeCount ?? 0),
    ]),
  );
}

export async function filtersCreateCommand(options: {
  name?: string;
  logic?: string;
  condition?: string[];
  description?: string;
  yes?: boolean;
  json?: boolean;
  xml?: boolean;
  yaml?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let logic = (options.logic || 'AND').toUpperCase() as 'AND' | 'OR';
  if (logic !== 'AND' && logic !== 'OR') { logger.error('--logic must be AND or OR'); return; }

  let conditions: api.FilterCondition[] = [];
  if (options.condition && options.condition.length > 0) {
    conditions = options.condition.map(parseConditionFlag).filter((c): c is api.FilterCondition => c !== null);
  }

  try {
    if (!name) {
      name = await input({ message: 'Filter name:', validate: (v) => v.length > 0 || 'Name is required' });
    }
    if (conditions.length === 0) {
      conditions = await promptFilterConditions();
      if (conditions.length > 1 && options.logic === undefined) {
        logic = await select({ message: 'Combine conditions with:', choices: [{ name: 'AND', value: 'AND' }, { name: 'OR', value: 'OR' }], default: 'AND' }) as 'AND' | 'OR';
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }

  if (conditions.length === 0) { logger.error('At least one condition is required'); return; }

  const spinner = logger.spinner('Creating filter...');
  const result = await api.createFilter({ name: name!, logic, conditions });
  if (result.error) { spinner.fail('Failed to create filter'); logger.error(result.error); return; }
  spinner.succeed('Filter created');
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(result.data?.filter, options.xml, options.yaml)); return; }
  const f = result.data?.filter;
  if (f) { logger.log(''); logger.box('Filter Created', [`ID:   ${f.id}`, `Name: ${f.name}`, `Logic: ${logic}`, `Conditions: ${conditions.length}`].join('\n')); }
}

export async function filtersGetCommand(filterId: string, options: { json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  const spinner = logger.spinner('Fetching filter...');
  const result = await api.getFilter(filterId);
  if (result.error) { spinner.fail('Failed to fetch filter'); logger.error(result.error); return; }
  spinner.stop();
  const f = result.data?.filter as any;
  if (options.json || options.xml || options.yaml) { console.log(formatOutput(f, options.xml, options.yaml)); return; }
  if (!f) { logger.error('Filter not found'); return; }
  logger.log('');
  logger.log(logger.bold('Filter Details'));
  logger.log('');
  logger.log(`ID:    ${f.id}`);
  logger.log(`Name:  ${f.name}`);
  logger.log(`Logic: ${f.logic || 'AND'}`);
  logger.log('');
  logger.log('Conditions:');
  for (const c of (f.conditions || [])) {
    logger.log(`  ${c.field} ${c.operator}${c.value !== undefined ? ` ${c.value}` : ''}`);
  }
  logger.log('');
}

export async function filtersDeleteCommand(filterId: string, options: { yes?: boolean; json?: boolean; xml?: boolean; yaml?: boolean }): Promise<void> {
  requireAuth();
  try {
    if (!options.yes) {
      const confirmed = await confirm({ message: `Delete filter ${filterId}? This cannot be undone.`, default: false });
      if (!confirmed) { logger.info('Cancelled'); return; }
    }
  } catch (error) {
    if (isPromptCancelled(error)) { logger.log(''); logger.info('Cancelled'); return; }
    throw error;
  }
  const spinner = logger.spinner('Deleting filter...');
  const result = await api.deleteFilter(filterId);
  if (result.error) { spinner.fail('Failed to delete filter'); logger.error(result.error); return; }
  spinner.succeed('Filter deleted');
  if (options.json || options.xml || options.yaml) console.log(formatOutput({ success: true, filterId }, options.xml, options.yaml));
}
