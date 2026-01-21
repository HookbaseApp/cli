import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import * as api from '../../lib/api.js';
import * as config from '../../lib/config.js';
import { TunnelClient } from '../../lib/tunnel.js';

interface TunnelsViewProps {
  tunnels: api.Tunnel[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

function TunnelList({ tunnels, onSelect, onCreate }: {
  tunnels: api.Tunnel[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { id: 'create', name: '+ Create New Tunnel', isAction: true },
    ...tunnels,
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'green';
      case 'disconnected': return 'gray';
      case 'error': return 'red';
      default: return 'gray';
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Tunnels</Text>
        <Text dimColor> - {tunnels.length} total | ↑↓ navigate, Enter select</Text>
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
                  <Text dimColor> ({item.subdomain}) </Text>
                  <Text color={getStatusColor(item.status)}>● {item.status}</Text>
                  <Text dimColor> | {item.total_requests} reqs</Text>
                </>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

interface RequestLog {
  id: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  time: Date;
}

function TunnelDetail({ tunnelId, tunnels, onBack, onRefresh }: {
  tunnelId: string;
  tunnels: api.Tunnel[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const tunnel = tunnels.find(t => t.id === tunnelId);
  const [action, setAction] = useState<'none' | 'disconnecting' | 'deleting'>('none');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Connect mode states
  const [mode, setMode] = useState<'detail' | 'port-input' | 'connecting' | 'connected'>('detail');
  const [portInput, setPortInput] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
  const tunnelClientRef = useRef<TunnelClient | null>(null);

  const apiUrl = config.getApiUrl();
  // Tunnel URL format: api.hookbase.app/t/{subdomain}
  const tunnelUrl = `${apiUrl}/t`;

  // Cleanup tunnel connection on unmount
  useEffect(() => {
    return () => {
      if (tunnelClientRef.current) {
        tunnelClientRef.current.close();
      }
    };
  }, []);

  const handleConnect = async (port: number) => {
    if (!tunnel) return;

    setMode('connecting');
    setMessage(null);

    try {
      // Regenerate token to get auth credentials for connection
      const result = await api.regenerateTunnelToken(tunnelId);
      if (result.error || !result.data) {
        setMessage(`Error: ${result.error || 'Failed to get tunnel credentials'}`);
        setMode('detail');
        return;
      }

      // Use the wsUrl directly from the API response, or construct it
      const authToken = result.data.auth_token || result.data.authToken;
      const wsUrl = result.data.wsUrl ||
        `${apiUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/tunnels/${tunnel.subdomain}/ws?tunnelId=${tunnelId}&token=${authToken}`;

      const client = new TunnelClient({
        wsUrl,
        localPort: port,
        onConnect: () => {
          setConnectionStatus('connected');
          setMode('connected');
          setMessage('Connected! Forwarding requests...');
          onRefresh();
        },
        onDisconnect: () => {
          setConnectionStatus('disconnected');
          setMessage('Disconnected from tunnel');
        },
        onRequest: (method, path, status, duration) => {
          setRequestLogs(prev => [{
            id: `${Date.now()}-${Math.random()}`,
            method,
            path,
            status,
            duration,
            time: new Date(),
          }, ...prev].slice(0, 50)); // Keep last 50 requests
        },
        onError: (error) => {
          setConnectionStatus('error');
          setMessage(`Error: ${error.message}`);
        },
      });

      tunnelClientRef.current = client;
      await client.connect();
    } catch (err) {
      setMessage(`Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setMode('detail');
    }
  };

  const handleDisconnectLocal = () => {
    if (tunnelClientRef.current) {
      tunnelClientRef.current.close();
      tunnelClientRef.current = null;
    }
    setMode('detail');
    setConnectionStatus('disconnected');
    setRequestLogs([]);
    onRefresh();
  };

  useInput(async (input, key) => {
    if (action !== 'none') return;

    // In connected mode, only allow disconnect
    if (mode === 'connected') {
      if (key.escape || input === 'q') {
        handleDisconnectLocal();
      }
      return;
    }

    // In port input mode, only handle escape
    if (mode === 'port-input') {
      if (key.escape) {
        setMode('detail');
        setPortInput('');
      }
      return;
    }

    // In connecting mode, do nothing
    if (mode === 'connecting') return;

    // Normal detail mode
    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 'c' && !confirmDelete && tunnel?.status !== 'connected') {
      setMode('port-input');
    }
    if (input === 'd' && tunnel?.status === 'connected' && !confirmDelete) {
      setAction('disconnecting');
      try {
        const result = await api.disconnectTunnel(tunnelId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
        } else {
          setMessage('Tunnel disconnected');
          onRefresh();
        }
      } catch (err) {
        setMessage('Failed to disconnect');
      }
      setAction('none');
    }
    if (input === 'x' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      setAction('deleting');
      setConfirmDelete(false);
      try {
        const result = await api.deleteTunnel(tunnelId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setAction('none');
        } else {
          setMessage('Tunnel deleted');
          setTimeout(() => {
            onRefresh();
            onBack();
          }, 1000);
        }
      } catch (err) {
        setMessage('Failed to delete');
        setAction('none');
      }
    }
    if (input === 'n' && confirmDelete) {
      setConfirmDelete(false);
    }
  });

  const handlePortSubmit = () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setMessage('Invalid port number (1-65535)');
      return;
    }
    handleConnect(port);
  };

  if (!tunnel) {
    return (
      <Box flexDirection="column">
        <Text color="red">Tunnel not found: {tunnelId}</Text>
        <Text dimColor>Available IDs: {tunnels.map(t => t.id).join(', ') || 'none'}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  // Connected mode - show request logs
  if (mode === 'connected') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="green">● Connected</Text>
          <Text> to </Text>
          <Text bold>{tunnel.name}</Text>
          <Text dimColor> - Press Esc or 'q' to disconnect</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
          <Box>
            <Box width={12}><Text dimColor>URL:</Text></Box>
            <Text color="cyan">{tunnelUrl}/{tunnel.subdomain}</Text>
          </Box>
          <Box>
            <Box width={12}><Text dimColor>Forwarding:</Text></Box>
            <Text>localhost:{portInput}</Text>
          </Box>
        </Box>

        <Box marginTop={1} marginBottom={1}>
          <Text bold>Request Log</Text>
          <Text dimColor> ({requestLogs.length} requests)</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} height={15}>
          {requestLogs.length === 0 ? (
            <Text dimColor>Waiting for requests...</Text>
          ) : (
            requestLogs.slice(0, 12).map(log => {
              const methodColor =
                log.method === 'GET' ? 'cyan' :
                log.method === 'POST' ? 'green' :
                log.method === 'PUT' ? 'yellow' :
                log.method === 'PATCH' ? 'magenta' :
                log.method === 'DELETE' ? 'red' :
                log.method === 'HEAD' ? 'blue' : 'white';
              return (
                <Box key={log.id}>
                  <Box width={12}>
                    <Text dimColor>{log.time.toLocaleTimeString()}</Text>
                  </Box>
                  <Box width={10}>
                    <Text color={methodColor} bold>{log.method}</Text>
                  </Box>
                  <Box width={28}>
                    <Text>{log.path.slice(0, 26)}{log.path.length > 26 ? '..' : ''}</Text>
                  </Box>
                  <Box width={8}>
                    <Text color={log.status < 400 ? 'green' : 'red'}>{log.status}</Text>
                  </Box>
                  <Text dimColor>{log.duration}ms</Text>
                </Box>
              );
            })
          )}
        </Box>
      </Box>
    );
  }

  // Port input mode
  if (mode === 'port-input') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Connect to Tunnel</Text>
          <Text dimColor> - Press Esc to cancel</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
          <Box marginBottom={1}>
            <Text>Tunnel: </Text>
            <Text bold color="cyan">{tunnel.name}</Text>
            <Text dimColor> ({tunnel.subdomain})</Text>
          </Box>
          <Box>
            <Text>Local port: </Text>
            <TextInput
              value={portInput}
              onChange={setPortInput}
              onSubmit={handlePortSubmit}
              placeholder="3000"
            />
          </Box>
          {message && (
            <Box marginTop={1}>
              <Text color="red">{message}</Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // Connecting mode
  if (mode === 'connecting') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Connecting...</Text>
        </Box>
        <Box>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> Connecting to {tunnel.name}...</Text>
        </Box>
      </Box>
    );
  }

  // Normal detail mode
  const showConnectOption = tunnel.status !== 'connected';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Tunnel Details</Text>
        <Text dimColor> - Esc: back{showConnectOption ? ' | c: connect' : ''} | d: disconnect | x: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={18}><Text dimColor>ID:</Text></Box>
          <Text>{tunnel.id}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Name:</Text></Box>
          <Text bold>{tunnel.name}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Subdomain:</Text></Box>
          <Text color="cyan">{tunnel.subdomain}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>URL:</Text></Box>
          <Text color="blue">{tunnelUrl}/{tunnel.subdomain}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Status:</Text></Box>
          <Text color={
            tunnel.status === 'connected' ? 'green' :
            tunnel.status === 'error' ? 'red' : 'gray'
          }>
            ● {tunnel.status}
          </Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Total Requests:</Text></Box>
          <Text>{tunnel.total_requests}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Last Connected:</Text></Box>
          <Text>{tunnel.last_connected_at ? new Date(tunnel.last_connected_at).toLocaleString() : 'Never'}</Text>
        </Box>

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this tunnel?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {action !== 'none' && (
          <Box marginTop={1}>
            <Text color="yellow">
              {action === 'disconnecting' ? 'Disconnecting...' : 'Deleting...'}
            </Text>
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith('Error') ? 'red' : 'green'}>{message}</Text>
          </Box>
        )}
      </Box>

      {showConnectOption && (
        <Box marginTop={1}>
          <Text dimColor>
            Press 'c' to connect or use: hookbase tunnels connect {tunnel.id} {'<port>'}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function CreateTunnel({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'creating' | 'done' | 'error'>('name');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdTunnel, setCreatedTunnel] = useState<api.Tunnel | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setStep('creating');

    try {
      const result = await api.createTunnel(name);
      if (result.error) {
        setError(result.error);
        setStep('error');
      } else {
        setCreatedTunnel(result.data?.tunnel || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tunnel');
      setStep('error');
    }
  };

  const apiUrl = config.getApiUrl();
  // Tunnel URL format: api.hookbase.app/t/{subdomain}
  const tunnelUrl = `${apiUrl}/t`;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create New Tunnel</Text>
        <Text dimColor> - Press Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>Tunnel name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleSubmit}
              placeholder="my-dev-tunnel"
            />
          </Box>
        )}

        {step === 'creating' && (
          <Text color="yellow">Creating tunnel...</Text>
        )}

        {step === 'done' && createdTunnel && (
          <Box flexDirection="column">
            <Text color="green">✓ Tunnel created successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>URL: </Text>
              <Text color="cyan">{tunnelUrl}/{createdTunnel.subdomain}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Connect with: hookbase tunnels connect {createdTunnel.id} {'<port>'}</Text>
            </Box>
          </Box>
        )}

        {step === 'error' && (
          <Box flexDirection="column">
            <Text color="red">Error: {error}</Text>
            <Box marginTop={1}>
              <Text dimColor>Press Esc to go back</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function TunnelsView({ tunnels, subView, onNavigate, onRefresh }: TunnelsViewProps) {
  if (subView === 'create') {
    return (
      <CreateTunnel
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const tunnelId = subView.replace('detail:', '');
    return (
      <TunnelDetail
        tunnelId={tunnelId}
        tunnels={tunnels}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <TunnelList
      tunnels={tunnels}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
