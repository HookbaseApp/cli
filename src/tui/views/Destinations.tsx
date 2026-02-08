import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import * as api from '../../lib/api.js';

interface DestinationsViewProps {
  destinations: api.Destination[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

function DestinationList({ destinations, onSelect, onCreate }: {
  destinations: api.Destination[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { id: 'create', name: '+ Create New Destination', isAction: true },
    ...destinations,
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
        <Text bold>Destinations</Text>
        <Text dimColor> - {destinations.length} total | j/k: navigate | Enter: select | n: new</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {/* Column headers */}
        <Box borderBottom marginBottom={0}>
          <Box width={2}><Text> </Text></Box>
          <Box width={22}><Text bold dimColor>Name</Text></Box>
          <Box width={8}><Text bold dimColor>Method</Text></Box>
          <Box width={44}><Text bold dimColor>URL</Text></Box>
          <Box width={12}><Text bold dimColor>Deliveries</Text></Box>
        </Box>

        {destinations.length === 0 && (
          <Box paddingY={1} flexDirection="column">
            <Text dimColor>No destinations yet. Press </Text>
            <Text color="green">n</Text>
            <Text dimColor> to create your first destination.</Text>
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
                <Box width={22}><Text color="green">+ New Destination</Text></Box>
              ) : (
                <>
                  <Box width={22}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {item.name.slice(0, 20)}{item.name.length > 20 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={8}>
                    <Text color="yellow">{item.method || 'POST'}</Text>
                  </Box>
                  <Box width={44}>
                    <Text color="blue">{item.url.slice(0, 42)}{item.url.length > 42 ? '…' : ''}</Text>
                  </Box>
                  <Box width={12}>
                    <Text dimColor>{(item as any).delivery_count ?? (item as any).deliveryCount ?? 0}</Text>
                  </Box>
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function DestinationDetail({ destId, destinations, onBack, onRefresh }: {
  destId: string;
  destinations: api.Destination[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const dest = destinations.find(d => d.id === destId);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; status: number; time: number; error?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  useInput(async (input, key) => {
    if (busy.current) return;

    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 't' && !confirmDelete) {
      busy.current = true;
      setTesting(true);
      try {
        const result = await api.testDestination(destId);
        if (result.error) {
          setTestResult({ success: false, status: 0, time: 0, error: result.error });
        } else if (result.data) {
          // Handle possible nested data envelope
          const raw = result.data as Record<string, unknown>;
          const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
          setTestResult({
            success: data.success === true,
            status: (data.statusCode ?? data.status_code ?? 0) as number,
            time: (data.duration ?? data.responseTime ?? data.response_time ?? 0) as number,
            error: data.error as string | undefined,
          });
        }
      } catch (err) {
        setTestResult({ success: false, status: 0, time: 0, error: err instanceof Error ? err.message : 'Test failed' });
      }
      setTesting(false);
      setTimeout(() => { busy.current = false; }, 300);
    }
    if (input === 'd' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      busy.current = true;
      setDeleting(true);
      try {
        const result = await api.deleteDestination(destId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('Destination deleted successfully');
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
  });

  if (!dest) {
    return (
      <Box flexDirection="column">
        <Text color="red">Destination not found: {destId}</Text>
        <Text dimColor>Available IDs: {destinations.map(d => d.id).join(', ') || 'none'}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Destination Details</Text>
        <Text dimColor> - Esc: back | t: test | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={16}><Text dimColor>ID:</Text></Box>
          <Text>{dest.id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Name:</Text></Box>
          <Text bold>{dest.name}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>URL:</Text></Box>
          <Text color="blue">{dest.url}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Method:</Text></Box>
          <Text color="yellow">{dest.method || 'POST'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Auth Type:</Text></Box>
          <Text>{dest.auth_type || (dest as any).authType || 'none'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={(dest.is_active || (dest as any).isActive) ? 'green' : 'red'}>
            {(dest.is_active || (dest as any).isActive) ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Deliveries:</Text></Box>
          <Text>{dest.delivery_count ?? (dest as any).deliveryCount ?? 0}</Text>
        </Box>

        {testing && (
          <Box marginTop={1}>
            <Text color="yellow">Testing destination...</Text>
          </Box>
        )}

        {testResult && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Test Result:</Text>
            {testResult.error ? (
              <Text color="red">✗ Error: {testResult.error}</Text>
            ) : (
              <Text color={testResult.success ? 'green' : 'red'}>
                {testResult.success ? '✓' : '✗'} Status: {testResult.status > 0 ? testResult.status : 'N/A'} | Time: {testResult.time}ms
              </Text>
            )}
          </Box>
        )}

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this destination?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {deleting && (
          <Box marginTop={1}>
            <Text color="yellow">Deleting...</Text>
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

function CreateDestination({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'url' | 'method' | 'creating' | 'done'>('name');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('POST');
  const [error, setError] = useState<string | null>(null);
  const [createdDest, setCreatedDest] = useState<api.Destination | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const handleMethodSelect = async (item: { value: string }) => {
    setMethod(item.value);
    setStep('creating');

    try {
      const result = await api.createDestination({
        name,
        url,
        method: item.value,
      });
      if (result.error) {
        setError(result.error);
        setStep('method');
      } else {
        setCreatedDest(result.data?.destination || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create destination');
      setStep('method');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create New Destination</Text>
        <Text dimColor> - Press Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>Destination name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={() => name.trim() && setStep('url')}
              placeholder="My API Endpoint"
            />
          </Box>
        )}

        {step === 'url' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Box>
              <Text>URL: </Text>
              <TextInput
                value={url}
                onChange={setUrl}
                onSubmit={() => url.trim() && setStep('method')}
                placeholder="https://api.example.com/webhook"
              />
            </Box>
          </Box>
        )}

        {step === 'method' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>URL: {url}</Text>
            </Box>
            <Text>Select HTTP method:</Text>
            <SelectInput
              items={[
                { label: 'POST (Recommended)', value: 'POST' },
                { label: 'PUT', value: 'PUT' },
                { label: 'PATCH', value: 'PATCH' },
              ]}
              onSelect={handleMethodSelect}
            />
          </Box>
        )}

        {step === 'creating' && (
          <Text color="yellow">Creating destination...</Text>
        )}

        {step === 'done' && createdDest && (
          <Box flexDirection="column">
            <Text color="green">✓ Destination created successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdDest.id}</Text>
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

export function DestinationsView({ destinations, subView, onNavigate, onRefresh }: DestinationsViewProps) {
  if (subView === 'create') {
    return (
      <CreateDestination
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const destId = subView.replace('detail:', '');
    return (
      <DestinationDetail
        destId={destId}
        destinations={destinations}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <DestinationList
      destinations={destinations}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
