import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { Panel, StatusBadge } from './components/Box.js';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import { TunnelClient } from '../lib/tunnel.js';

interface RequestLog {
  id: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: Date;
}

interface TunnelMonitorProps {
  tunnelId: string;
  port: number;
}

function Header({ tunnel, connected }: { tunnel?: api.Tunnel; connected: boolean }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          {'  '}Tunnel Monitor{'  '}
        </Text>
        <Text dimColor> | Press 'q' to quit, 'c' to clear</Text>
      </Box>
      {tunnel && (
        <Box marginTop={1}>
          <Text>
            <Text bold>{tunnel.name}</Text>
            <Text dimColor> ({tunnel.subdomain}) </Text>
            <StatusBadge
              status={connected ? 'success' : 'pending'}
              label={connected ? 'connected' : 'connecting...'}
            />
          </Text>
        </Box>
      )}
    </Box>
  );
}

function RequestList({ requests }: { requests: RequestLog[] }) {
  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'cyan';
      case 'POST': return 'green';
      case 'PUT': return 'yellow';
      case 'DELETE': return 'red';
      case 'PATCH': return 'magenta';
      default: return 'white';
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'green';
    if (status >= 300 && status < 400) return 'yellow';
    if (status >= 400 && status < 500) return 'red';
    if (status >= 500) return 'red';
    return 'gray';
  };

  if (requests.length === 0) {
    return (
      <Panel title="Requests" borderColor="gray">
        <Text dimColor>Waiting for incoming requests...</Text>
      </Panel>
    );
  }

  return (
    <Panel title={`Requests (${requests.length})`} borderColor="green">
      <Box flexDirection="column">
        {requests.slice(-15).map(req => (
          <Box key={req.id}>
            <Box width={10}>
              <Text dimColor>
                {req.timestamp.toLocaleTimeString()}
              </Text>
            </Box>
            <Box width={8}>
              <Text color={getMethodColor(req.method)} bold>
                {req.method}
              </Text>
            </Box>
            <Box width={40}>
              <Text>{req.path.slice(0, 38)}</Text>
            </Box>
            <Box width={6}>
              <Text color={getStatusColor(req.status)}>
                {req.status}
              </Text>
            </Box>
            <Text dimColor>{req.duration}ms</Text>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function Stats({ requests, tunnel }: { requests: RequestLog[]; tunnel?: api.Tunnel }) {
  const successCount = requests.filter(r => r.status >= 200 && r.status < 300).length;
  const errorCount = requests.filter(r => r.status >= 400).length;
  const avgDuration = requests.length > 0
    ? Math.round(requests.reduce((sum, r) => sum + r.duration, 0) / requests.length)
    : 0;

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box marginRight={4}>
        <Text dimColor>Total: </Text>
        <Text bold>{(tunnel?.total_requests || 0) + requests.length}</Text>
      </Box>
      <Box marginRight={4}>
        <Text dimColor>Session: </Text>
        <Text bold color="blue">{requests.length}</Text>
      </Box>
      <Box marginRight={4}>
        <Text dimColor>Success: </Text>
        <Text bold color="green">{successCount}</Text>
      </Box>
      <Box marginRight={4}>
        <Text dimColor>Errors: </Text>
        <Text bold color="red">{errorCount}</Text>
      </Box>
      <Box>
        <Text dimColor>Avg: </Text>
        <Text bold>{avgDuration}ms</Text>
      </Box>
    </Box>
  );
}

function TunnelMonitorApp({ tunnelId, port }: TunnelMonitorProps) {
  const { exit } = useApp();
  const [tunnel, setTunnel] = useState<api.Tunnel | undefined>();
  const [connected, setConnected] = useState(false);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [tunnelUrl, setTunnelUrl] = useState<string>('');

  const addRequest = useCallback((method: string, path: string, status: number, duration: number) => {
    setRequests(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      method,
      path,
      status,
      duration,
      timestamp: new Date(),
    }]);
  }, []);

  useEffect(() => {
    let client: TunnelClient | null = null;

    const connect = async () => {
      try {
        // Get tunnel info
        const tunnelRes = await api.getTunnel(tunnelId);
        if (tunnelRes.error || !tunnelRes.data?.tunnel) {
          setError(tunnelRes.error || 'Tunnel not found');
          return;
        }

        setTunnel(tunnelRes.data.tunnel);

        // Regenerate token
        const tokenRes = await api.regenerateTunnelToken(tunnelId);
        if (tokenRes.error || !tokenRes.data?.authToken) {
          setError(tokenRes.error || 'Failed to get auth token');
          return;
        }

        const authToken = tokenRes.data.authToken;
        const apiUrl = config.getApiUrl();
        const wsUrl = apiUrl
          .replace('https://', 'wss://')
          .replace('http://', 'ws://') +
          `/tunnels/${tunnelRes.data.tunnel.subdomain}/ws?tunnelId=${tunnelId}&token=${authToken}`;

        setTunnelUrl(`${apiUrl}/t/${tunnelRes.data.tunnel.subdomain}`);

        client = new TunnelClient({
          wsUrl,
          localPort: port,
          onConnect: () => setConnected(true),
          onDisconnect: () => setConnected(false),
          onRequest: addRequest,
          onError: (err) => setError(err.message),
        });

        await client.connect();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
    };

    if (config.isAuthenticated()) {
      connect();
    } else {
      setError('Not authenticated. Run "hookbase login" first.');
    }

    return () => {
      if (client) {
        client.close();
      }
    };
  }, [tunnelId, port, addRequest]);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
    if (input === 'c') {
      setRequests([]);
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header tunnel={tunnel} connected={connected} />
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header tunnel={tunnel} connected={connected} />

      {tunnelUrl && (
        <Box marginBottom={1}>
          <Text dimColor>URL: </Text>
          <Text color="cyan">{tunnelUrl}</Text>
          <Text dimColor> → localhost:{port}</Text>
        </Box>
      )}

      {!connected && (
        <Box>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> Connecting to tunnel...</Text>
        </Box>
      )}

      <RequestList requests={requests} />
      <Stats requests={requests} tunnel={tunnel} />
    </Box>
  );
}

export async function runTunnelMonitor(tunnelId: string, port: number) {
  const { waitUntilExit } = render(<TunnelMonitorApp tunnelId={tunnelId} port={port} />);
  await waitUntilExit();
}
