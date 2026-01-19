import { input, confirm, select } from '@inquirer/prompts';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    logger.error('Not logged in. Run "hookbase login" first.');
    process.exit(1);
  }
  return true;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString();
}

export async function cronGroupsListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching cron groups...');
  const result = await api.getCronGroups();

  if (result.error) {
    spinner.fail('Failed to fetch cron groups');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const groups = result.data?.groups || [];

  if (options.json) {
    console.log(JSON.stringify(groups, null, 2));
    return;
  }

  if (groups.length === 0) {
    logger.info('No cron groups found');
    logger.dim('Create groups with "hookbase cron groups create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'Slug', 'Description', 'Order', 'Created'],
    groups.map(g => [
      g.id.slice(0, 8) + '...',
      g.name,
      g.slug,
      g.description?.slice(0, 30) || '-',
      String(g.sortOrder),
      formatDate(g.createdAt).split(',')[0], // Just the date
    ])
  );

  logger.log('');
  logger.dim(`${groups.length} group(s)`);
}

export async function cronGroupsCreateCommand(options: {
  name?: string;
  description?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let description = options.description;

  // Interactive mode
  if (!name) {
    name = await input({
      message: 'Group name:',
      validate: (value) => value.length > 0 || 'Name is required',
    });

    description = await input({
      message: 'Description (optional):',
    });
  }

  if (!options.yes && !options.name) {
    const confirmed = await confirm({
      message: `Create cron group "${name}"?`,
      default: true,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const spinner = logger.spinner('Creating cron group...');
  const result = await api.createCronGroup({
    name: name!,
    description: description || undefined,
  });

  if (result.error) {
    spinner.fail('Failed to create cron group');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron group created');

  if (options.json) {
    console.log(JSON.stringify(result.data?.group, null, 2));
    return;
  }

  const group = result.data?.group;
  if (group) {
    logger.log('');
    logger.box('Cron Group Created', [
      `ID:          ${group.id}`,
      `Name:        ${group.name}`,
      `Slug:        ${group.slug}`,
      group.description ? `Description: ${group.description}` : '',
    ].filter(Boolean).join('\n'));
  }
}

export async function cronGroupsGetCommand(
  groupId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching cron group...');
  const result = await api.getCronGroup(groupId);

  if (result.error) {
    spinner.fail('Failed to fetch cron group');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const group = result.data?.group;

  if (options.json) {
    console.log(JSON.stringify(group, null, 2));
    return;
  }

  if (!group) {
    logger.error('Cron group not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Cron Group Details'));
  logger.log('');
  logger.log(`ID:          ${group.id}`);
  logger.log(`Name:        ${group.name}`);
  logger.log(`Slug:        ${group.slug}`);
  if (group.description) {
    logger.log(`Description: ${group.description}`);
  }
  logger.log(`Sort Order:  ${group.sortOrder}`);
  logger.log(`Created:     ${formatDate(group.createdAt)}`);
  logger.log(`Updated:     ${formatDate(group.updatedAt)}`);
  logger.log('');
}

export async function cronGroupsUpdateCommand(
  groupId: string,
  options: {
    name?: string;
    description?: string;
    order?: number;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateCronGroup>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.description !== undefined) updateData.description = options.description;
  if (options.order !== undefined) updateData.sortOrder = options.order;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --description, or --order');
    return;
  }

  const spinner = logger.spinner('Updating cron group...');
  const result = await api.updateCronGroup(groupId, updateData);

  if (result.error) {
    spinner.fail('Failed to update cron group');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron group updated');

  if (options.json) {
    console.log(JSON.stringify(result.data?.group, null, 2));
  }
}

export async function cronGroupsDeleteCommand(
  groupId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  if (!options.yes) {
    const confirmed = await confirm({
      message: `Are you sure you want to delete this cron group? Jobs in this group will become ungrouped. This cannot be undone.`,
      default: false,
    });
    if (!confirmed) {
      logger.info('Cancelled');
      return;
    }
  }

  const spinner = logger.spinner('Deleting cron group...');
  const result = await api.deleteCronGroup(groupId);

  if (result.error) {
    spinner.fail('Failed to delete cron group');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Cron group deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, groupId }, null, 2));
  }
}

export async function cronGroupsReorderCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  // First fetch all groups
  const spinner = logger.spinner('Fetching cron groups...');
  const result = await api.getCronGroups();

  if (result.error) {
    spinner.fail('Failed to fetch cron groups');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const groups = result.data?.groups || [];

  if (groups.length < 2) {
    logger.info('Need at least 2 groups to reorder');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Current Group Order:'));
  groups.forEach((g, i) => {
    logger.log(`  ${i + 1}. ${g.name} (${g.slug})`);
  });
  logger.log('');

  // Interactive reordering
  const newOrder: string[] = [];
  const remaining = [...groups];

  for (let i = 0; i < groups.length; i++) {
    const choice = await select({
      message: `Select group for position ${i + 1}:`,
      choices: remaining.map(g => ({
        name: g.name,
        value: g.id,
      })),
    });

    newOrder.push(choice);
    const idx = remaining.findIndex(g => g.id === choice);
    remaining.splice(idx, 1);
  }

  logger.log('');
  logger.log(logger.bold('New Order:'));
  newOrder.forEach((id, i) => {
    const group = groups.find(g => g.id === id);
    logger.log(`  ${i + 1}. ${group?.name}`);
  });
  logger.log('');

  const confirmed = await confirm({
    message: 'Apply this new order?',
    default: true,
  });

  if (!confirmed) {
    logger.info('Cancelled');
    return;
  }

  const reorderSpinner = logger.spinner('Reordering groups...');
  const reorderResult = await api.reorderCronGroups(newOrder);

  if (reorderResult.error) {
    reorderSpinner.fail('Failed to reorder groups');
    logger.error(reorderResult.error);
    return;
  }

  reorderSpinner.succeed('Groups reordered');

  if (options.json) {
    console.log(JSON.stringify({ success: true, order: newOrder }, null, 2));
  }
}
