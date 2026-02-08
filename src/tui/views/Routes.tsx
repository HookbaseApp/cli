import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import * as api from '../../lib/api.js';

interface RoutesViewProps {
  routes: api.Route[];
  sources: api.Source[];
  destinations: api.Destination[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

function RouteList({ routes, onSelect, onCreate }: {
  routes: api.Route[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { id: 'create', name: '+ Create New Route', isAction: true },
    ...routes,
  ];

  useInput((input, key) => {
    // Vim-style navigation (j/k) and arrow keys
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
    }
    // Create new with 'n'
    if (input === 'n') {
      onCreate();
    }
    if (key.return) {
      const item = items[selectedIndex];
      if (item.id === 'create') {
        onCreate();
      } else {
        onSelect(item.id);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Routes</Text>
        <Text dimColor> - {routes.length} total | j/k: navigate | Enter: select | n: new</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {/* Header */}
        <Box borderBottom>
          <Box width={2}><Text> </Text></Box>
          <Box width={24}><Text bold dimColor>Name</Text></Box>
          <Box width={22}><Text bold dimColor>Source</Text></Box>
          <Box width={22}><Text bold dimColor>Destination</Text></Box>
          <Box width={10}><Text bold dimColor>Priority</Text></Box>
          <Box width={10}><Text bold dimColor>Status</Text></Box>
          <Box width={12}><Text bold dimColor>Deliveries</Text></Box>
        </Box>

        {routes.length === 0 && (
          <Box paddingY={1}>
            <Text dimColor>No routes yet. Press </Text>
            <Text color="green">n</Text>
            <Text dimColor> to create your first route.</Text>
          </Box>
        )}

        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isAction = 'isAction' in item;

          return (
            <Box key={item.id}>
              <Box width={2}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '▶' : ' '}
                </Text>
              </Box>
              {isAction ? (
                <Text color="green">{item.name}</Text>
              ) : (() => {
                const itemActive = (item.isActive ?? item.is_active) === true || (item.isActive ?? item.is_active) === 1;
                const sourceName = item.sourceName || item.source_name || '-';
                const destName = item.destinationName || item.destination_name || '-';
                const deliveryCount = item.deliveryCount ?? item.delivery_count ?? 0;
                return (
                  <>
                    <Box width={24}>
                      <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                        {truncate(item.name, 22)}
                      </Text>
                    </Box>
                    <Box width={22}>
                      <Text dimColor>{truncate(sourceName, 20)}</Text>
                    </Box>
                    <Box width={22}>
                      <Text dimColor>{truncate(destName, 20)}</Text>
                    </Box>
                    <Box width={10}>
                      <Text>{item.priority}</Text>
                    </Box>
                    <Box width={10}>
                      <Text color={itemActive ? 'green' : 'red'}>
                        {itemActive ? 'Active' : 'Inactive'}
                      </Text>
                    </Box>
                    <Box width={12}>
                      <Text dimColor>{deliveryCount}</Text>
                    </Box>
                  </>
                );
              })()}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}

// Helper to get active state from route (handles both naming conventions and types)
function getRouteIsActive(route: api.Route | undefined): boolean {
  if (!route) return false;
  const val = route.isActive ?? route.is_active;
  return val === true || val === 1;
}

function RouteDetail({ routeId, routes, onBack, onRefresh }: {
  routeId: string;
  routes: api.Route[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const route = routes.find(r => r.id === routeId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [localIsActive, setLocalIsActive] = useState<boolean | null>(null);
  const busy = useRef(false);

  const isActive = localIsActive !== null ? localIsActive : getRouteIsActive(route);

  useInput(async (input, key) => {
    if (busy.current) return;

    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 'd' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      busy.current = true;
      setDeleting(true);
      try {
        const result = await api.deleteRoute(routeId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('Route deleted successfully');
          setTimeout(() => { onRefresh(); onBack(); }, 1500);
        }
      } catch (err) {
        setMessage('Failed to delete');
        setConfirmDelete(false);
        setTimeout(() => { busy.current = false; }, 300);
      }
      setDeleting(false);
    }
    if (input === 'n' && confirmDelete) {
      setConfirmDelete(false);
    }
    if (input === 't' && route && !confirmDelete) {
      busy.current = true;
      setToggling(true);
      const newActiveState = !isActive;
      try {
        const result = await api.updateRoute(routeId, { isActive: newActiveState });
        if (result.error) {
          setMessage(`Error: ${result.error}`);
        } else {
          setLocalIsActive(newActiveState);
          setMessage(newActiveState ? 'Route enabled' : 'Route disabled');
          onRefresh();
        }
      } catch (err) {
        setMessage('Failed to toggle');
      }
      setToggling(false);
      setTimeout(() => { busy.current = false; }, 300);
    }
  });

  if (!route) {
    return (
      <Box flexDirection="column">
        <Text color="red">Route not found: {routeId}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Route Details</Text>
        <Text dimColor> - Esc: back | t: toggle | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={16}><Text dimColor>ID:</Text></Box>
          <Text>{route.id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Name:</Text></Box>
          <Text bold>{route.name}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Source:</Text></Box>
          <Text color="blue">{route.sourceName || route.source_name || route.sourceId || route.source_id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Destination:</Text></Box>
          <Text color="magenta">{route.destinationName || route.destination_name || route.destinationId || route.destination_id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Priority:</Text></Box>
          <Text>{route.priority}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={isActive ? 'green' : 'red'}>
            {isActive ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Deliveries:</Text></Box>
          <Text>{route.deliveryCount ?? route.delivery_count ?? 0}</Text>
        </Box>
        {(route.filterId || route.filter_id) && (
          <Box>
            <Box width={16}><Text dimColor>Filter ID:</Text></Box>
            <Text dimColor>{route.filterId || route.filter_id}</Text>
          </Box>
        )}
        {(route.transformId || route.transform_id) && (
          <Box>
            <Box width={16}><Text dimColor>Transform ID:</Text></Box>
            <Text dimColor>{route.transformId || route.transform_id}</Text>
          </Box>
        )}
        {(route.createdAt || route.created_at) && (
          <Box marginTop={1}>
            <Box width={16}><Text dimColor>Created:</Text></Box>
            <Text dimColor>{new Date(route.createdAt || route.created_at!).toLocaleString()}</Text>
          </Box>
        )}

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this route?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {(deleting || toggling) && (
          <Box marginTop={1}>
            <Text color="yellow">
              <Spinner type="dots" />
              {' '}{deleting ? 'Deleting...' : 'Updating...'}
            </Text>
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith('Error') ? 'red' : 'green'}>{message}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function CreateRoute({ sources, destinations, onBack, onCreated }: {
  sources: api.Source[];
  destinations: api.Destination[];
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'source' | 'destination' | 'name' | 'creating' | 'done'>('source');
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedDestination, setSelectedDestination] = useState<string>('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdRoute, setCreatedRoute] = useState<api.Route | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const sourceItems = sources.map(s => ({
    label: `${s.name} (${s.slug})`,
    value: s.id,
  }));

  const destinationItems = destinations.map(d => ({
    label: `${d.name} (${d.method})`,
    value: d.id,
  }));

  const handleSourceSelect = (item: { value: string }) => {
    setSelectedSource(item.value);
    const source = sources.find(s => s.id === item.value);
    if (source) {
      setName(`${source.name} Route`);
    }
    setStep('destination');
  };

  const handleDestinationSelect = (item: { value: string }) => {
    setSelectedDestination(item.value);
    setStep('name');
  };

  const handleCreate = async () => {
    if (!name.trim()) return;

    setStep('creating');
    try {
      const result = await api.createRoute({
        name: name.trim(),
        sourceId: selectedSource,
        destinationId: selectedDestination,
      });

      if (result.error) {
        setError(result.error);
        setStep('name');
      } else {
        setCreatedRoute(result.data?.route || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 1500);
      }
    } catch (err) {
      setError('Failed to create route');
      setStep('name');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create Route</Text>
        <Text dimColor> - Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'source' && (
          <Box flexDirection="column">
            <Text>Select a source:</Text>
            {sourceItems.length === 0 ? (
              <Text color="yellow">No sources available. Create a source first.</Text>
            ) : (
              <SelectInput items={sourceItems} onSelect={handleSourceSelect} />
            )}
          </Box>
        )}

        {step === 'destination' && (
          <Box flexDirection="column">
            <Text dimColor>Source: {sources.find(s => s.id === selectedSource)?.name}</Text>
            <Box marginTop={1}>
              <Text>Select a destination:</Text>
            </Box>
            {destinationItems.length === 0 ? (
              <Text color="yellow">No destinations available. Create a destination first.</Text>
            ) : (
              <SelectInput items={destinationItems} onSelect={handleDestinationSelect} />
            )}
          </Box>
        )}

        {step === 'name' && (
          <Box flexDirection="column">
            <Text dimColor>Source: {sources.find(s => s.id === selectedSource)?.name}</Text>
            <Text dimColor>Destination: {destinations.find(d => d.id === selectedDestination)?.name}</Text>
            <Box marginTop={1}>
              <Text>Route name: </Text>
              <Box borderStyle="round" borderColor="cyan" paddingX={1}>
                <Text>{name}</Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to create</Text>
            </Box>
            <NameInput value={name} onChange={setName} onSubmit={handleCreate} />
          </Box>
        )}

        {step === 'creating' && (
          <Box>
            <Text color="green"><Spinner type="dots" /></Text>
            <Text> Creating route...</Text>
          </Box>
        )}

        {step === 'done' && createdRoute && (
          <Box flexDirection="column">
            <Text color="green" bold>Route created successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdRoute.id}</Text>
            </Box>
            <Box>
              <Text dimColor>Name: </Text>
              <Text>{createdRoute.name}</Text>
            </Box>
          </Box>
        )}

        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function NameInput({ value, onChange, onSubmit }: {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
}) {
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });

  return null;
}

export function RoutesView({ routes, sources, destinations, subView, onNavigate, onRefresh }: RoutesViewProps) {
  if (subView === 'create') {
    return (
      <CreateRoute
        sources={sources}
        destinations={destinations}
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const routeId = subView.replace('detail:', '');
    return (
      <RouteDetail
        routeId={routeId}
        routes={routes}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <RouteList
      routes={routes}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
