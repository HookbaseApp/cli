import React, { useState } from 'react';
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
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
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
        <Text dimColor> - {destinations.length} total | ↑↓ navigate, Enter select</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {items.map((item, index) => (
          <Box key={item.id}>
            <Text
              color={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
              inverse={index === selectedIndex}
            >
              {index === selectedIndex ? '▶ ' : '  '}
              {'isAction' in item ? (
                <Text color="green">{item.name}</Text>
              ) : (
                <>
                  <Text>{item.name}</Text>
                  <Text dimColor> → </Text>
                  <Text color="blue">{item.url.slice(0, 40)}{item.url.length > 40 ? '...' : ''}</Text>
                </>
              )}
            </Text>
          </Box>
        ))}
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
  const [testResult, setTestResult] = useState<{ success: boolean; status: number; time: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useInput(async (input, key) => {
    if (deleting) return;

    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 't' && !testing && !confirmDelete) {
      setTesting(true);
      try {
        const result = await api.testDestination(destId);
        if (result.data) {
          setTestResult({
            success: result.data.success,
            status: result.data.statusCode,
            time: result.data.responseTime,
          });
        }
      } catch (err) {
        setTestResult({ success: false, status: 0, time: 0 });
      }
      setTesting(false);
    }
    if (input === 'd' && !confirmDelete && !testing) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      setDeleting(true);
      try {
        const result = await api.deleteDestination(destId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
        } else {
          setMessage('Destination deleted');
          setTimeout(() => {
            onRefresh();
            onBack();
          }, 1000);
        }
      } catch (err) {
        setMessage('Failed to delete');
        setConfirmDelete(false);
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
          <Box width={15}><Text dimColor>ID:</Text></Box>
          <Text>{dest.id}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Name:</Text></Box>
          <Text bold>{dest.name}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>URL:</Text></Box>
          <Text color="blue">{dest.url}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Method:</Text></Box>
          <Text color="yellow">{dest.method || 'POST'}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Auth Type:</Text></Box>
          <Text>{dest.auth_type || (dest as any).authType || 'none'}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Status:</Text></Box>
          <Text color={(dest.is_active || (dest as any).isActive) ? 'green' : 'red'}>
            {(dest.is_active || (dest as any).isActive) ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Deliveries:</Text></Box>
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
            <Text color={testResult.success ? 'green' : 'red'}>
              {testResult.success ? '✓' : '✗'} Status: {testResult.status} | Time: {testResult.time}ms
            </Text>
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
        }, 2000);
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
