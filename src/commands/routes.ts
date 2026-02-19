import { input, confirm, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

/** Helper to check if an error is a prompt cancellation (Ctrl+C) */
function isPromptCancelled(error: unknown): boolean {
  return error instanceof ExitPromptError ||
    (error instanceof Error && error.name === 'ExitPromptError');
}

function requireAuth(): boolean {
  if (!config.isAuthenticated()) {
    if (config.hasStaleJwtToken()) {
      logger.error('Your session uses a JWT token which is no longer supported. Please re-login with an API key: hookbase login');
    } else {
      logger.error('Not logged in. Run "hookbase login" with an API key.');
    }
    process.exit(1);
  }
  return true;
}

export async function routesListCommand(options: { json?: boolean }): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching routes...');
  const result = await api.getRoutes();

  if (result.error) {
    spinner.fail('Failed to fetch routes');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const routes = result.data?.routes || [];

  if (options.json) {
    console.log(JSON.stringify(routes, null, 2));
    return;
  }

  if (routes.length === 0) {
    logger.info('No routes found');
    logger.dim('Create one with "hookbase routes create"');
    return;
  }

  logger.table(
    ['ID', 'Name', 'Source', 'Destination', 'Priority', 'Status', 'Deliveries'],
    routes.map((r: any) => [
      r.id || '-',
      r.name || '-',
      r.source_name || r.sourceName || r.source_id || r.sourceId || '-',
      r.destination_name || r.destinationName || r.destination_id || r.destinationId || '-',
      String(r.priority ?? 0),
      (r.is_active ?? r.isActive) ? logger.green('active') : logger.dimText('inactive'),
      String(r.delivery_count ?? r.deliveryCount ?? 0),
    ])
  );
}

export async function routesCreateCommand(options: {
  name?: string;
  source?: string;
  destination?: string;
  priority?: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  requireAuth();

  let name = options.name;
  let sourceId = options.source;
  let destinationId = options.destination;
  let priority = options.priority ? parseInt(options.priority, 10) : 0;

  // Interactive mode - wrapped in try-catch to handle Ctrl+C gracefully
  try {
    if (!name || !sourceId || !destinationId) {
      // Fetch sources and destinations for selection
      const [sourcesResult, destinationsResult] = await Promise.all([
        api.getSources(),
        api.getDestinations(),
      ]);

      const sources = sourcesResult.data?.sources || [];
      const destinations = destinationsResult.data?.destinations || [];

      if (sources.length === 0) {
        logger.error('No sources found. Create a source first with "hookbase sources create"');
        return;
      }

      if (destinations.length === 0) {
        logger.error('No destinations found. Create a destination first with "hookbase destinations create"');
        return;
      }

      name = name || await input({
        message: 'Route name:',
        validate: (value) => value.length > 0 || 'Name is required',
      });

      sourceId = sourceId || await select({
        message: 'Select source:',
        choices: sources.map(s => ({
          name: `${s.name} (${s.slug})`,
          value: s.id,
        })),
      });

      destinationId = destinationId || await select({
        message: 'Select destination:',
        choices: destinations.map(d => ({
          name: `${d.name} (${d.url})`,
          value: d.id,
        })),
      });

      const setPriority = await confirm({
        message: 'Set a custom priority? (default is 0)',
        default: false,
      });

      if (setPriority) {
        const priorityInput = await input({
          message: 'Priority (higher = runs first):',
          default: '0',
          validate: (value) => !isNaN(parseInt(value, 10)) || 'Must be a number',
        });
        priority = parseInt(priorityInput, 10);
      }
    }

    if (!options.yes && !options.name) {
      const confirmed = await confirm({
        message: `Create route "${name}"?`,
        default: true,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Creating route...');
  const result = await api.createRoute({
    name: name!,
    sourceId: sourceId!,
    destinationId: destinationId!,
    priority,
  });

  if (result.error) {
    spinner.fail('Failed to create route');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Route created');

  if (options.json) {
    console.log(JSON.stringify(result.data?.route, null, 2));
    return;
  }

  const route = result.data?.route;
  if (route) {
    logger.log('');
    logger.box('Route Created', [
      `ID:          ${route.id}`,
      `Name:        ${route.name}`,
      `Source:      ${route.source_name || (route as any).sourceName || route.source_id || (route as any).sourceId}`,
      `Destination: ${route.destination_name || (route as any).destinationName || route.destination_id || (route as any).destinationId}`,
      `Priority:    ${route.priority}`,
    ].join('\n'));
  }
}

export async function routesGetCommand(
  routeId: string,
  options: { json?: boolean }
): Promise<void> {
  requireAuth();

  const spinner = logger.spinner('Fetching route...');
  const result = await api.getRoute(routeId);

  if (result.error) {
    spinner.fail('Failed to fetch route');
    logger.error(result.error);
    return;
  }

  spinner.stop();

  const route: any = result.data?.route;

  if (options.json) {
    console.log(JSON.stringify(route, null, 2));
    return;
  }

  if (!route) {
    logger.error('Route not found');
    return;
  }

  logger.log('');
  logger.log(logger.bold('Route Details'));
  logger.log('');
  logger.log(`ID:          ${route.id}`);
  logger.log(`Name:        ${route.name}`);
  logger.log(`Source:      ${route.source_name || route.sourceName || route.source_id || route.sourceId}`);
  logger.log(`Destination: ${route.destination_name || route.destinationName || route.destination_id || route.destinationId}`);
  logger.log(`Priority:    ${route.priority}`);
  logger.log(`Status:      ${(route.is_active ?? route.isActive) ? logger.green('active') : logger.red('inactive')}`);
  if (route.filter_id || route.filterId) logger.log(`Filter:      ${route.filter_id || route.filterId}`);
  if (route.transform_id || route.transformId) logger.log(`Transform:   ${route.transform_id || route.transformId}`);
  logger.log(`Deliveries:  ${route.delivery_count ?? route.deliveryCount ?? 0}`);
  logger.log('');
}

export async function routesUpdateCommand(
  routeId: string,
  options: {
    name?: string;
    source?: string;
    destination?: string;
    priority?: string;
    active?: boolean;
    inactive?: boolean;
    json?: boolean;
  }
): Promise<void> {
  requireAuth();

  const updateData: Parameters<typeof api.updateRoute>[1] = {};

  if (options.name) updateData.name = options.name;
  if (options.source) updateData.sourceId = options.source;
  if (options.destination) updateData.destinationId = options.destination;
  if (options.priority) updateData.priority = parseInt(options.priority, 10);
  if (options.active) updateData.isActive = true;
  if (options.inactive) updateData.isActive = false;

  if (Object.keys(updateData).length === 0) {
    logger.error('No updates specified. Use --name, --source, --destination, --priority, --active, or --inactive');
    return;
  }

  const spinner = logger.spinner('Updating route...');
  const result = await api.updateRoute(routeId, updateData);

  if (result.error) {
    spinner.fail('Failed to update route');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Route updated');

  if (options.json) {
    console.log(JSON.stringify(result.data?.route, null, 2));
  }
}

export async function routesDeleteCommand(
  routeId: string,
  options: { yes?: boolean; json?: boolean }
): Promise<void> {
  requireAuth();

  try {
    if (!options.yes) {
      const confirmed = await confirm({
        message: `Are you sure you want to delete route ${routeId}? This cannot be undone.`,
        default: false,
      });
      if (!confirmed) {
        logger.info('Cancelled');
        return;
      }
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
      logger.log('');
      logger.info('Cancelled');
      return;
    }
    throw error;
  }

  const spinner = logger.spinner('Deleting route...');
  const result = await api.deleteRoute(routeId);

  if (result.error) {
    spinner.fail('Failed to delete route');
    logger.error(result.error);
    return;
  }

  spinner.succeed('Route deleted');

  if (options.json) {
    console.log(JSON.stringify({ success: true, routeId }, null, 2));
  }
}
