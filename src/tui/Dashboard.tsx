import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { Panel, StatusBadge, Table } from './components/Box.js';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';

interface DashboardData {
  sources: api.Source[];
  destinations: api.Destination[];
  tunnels: api.Tunnel[];
  events: api.Event[];
  loading: boolean;
  error?: string;
  lastUpdated?: Date;
}

function Header() {
  return (
    <Box marginBottom={1}>
      <Text bold color="cyan">
        {'  '}Hookbase Dashboard{'  '}
      </Text>
      <Text dimColor> | Press 'q' to quit, 'r' to refresh</Text>
    </Box>
  );
}

function StatsPanel({ data }: { data: DashboardData }) {
  const activeSources = data.sources.filter(s => s.is_active || s.isActive).length;
  const activeDests = data.destinations.filter(d => d.is_active).length;
  const connectedTunnels = data.tunnels.filter(t => t.status === 'connected').length;

  return (
    <Panel title="Overview" width={30}>
      <Box flexDirection="column">
        <Text>Sources:      <Text color="green">{activeSources}</Text>/{data.sources.length}</Text>
        <Text>Destinations: <Text color="green">{activeDests}</Text>/{data.destinations.length}</Text>
        <Text>Tunnels:      <Text color={connectedTunnels > 0 ? 'green' : 'gray'}>{connectedTunnels}</Text>/{data.tunnels.length}</Text>
        <Text>Events:       <Text color="blue">{data.events.length}</Text></Text>
      </Box>
    </Panel>
  );
}

function TunnelsPanel({ tunnels }: { tunnels: api.Tunnel[] }) {
  if (tunnels.length === 0) {
    return (
      <Panel title="Tunnels" width={50}>
        <Text dimColor>No tunnels configured</Text>
      </Panel>
    );
  }

  return (
    <Panel title="Tunnels" width={50}>
      <Box flexDirection="column">
        {tunnels.slice(0, 5).map(tunnel => (
          <Box key={tunnel.id}>
            <Box width={20}>
              <Text>{tunnel.name.slice(0, 18)}</Text>
            </Box>
            <Box width={15}>
              <StatusBadge
                status={tunnel.status === 'connected' ? 'success' : tunnel.status === 'error' ? 'error' : 'pending'}
                label={tunnel.status}
              />
            </Box>
            <Text dimColor>{tunnel.total_requests} reqs</Text>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function EventsPanel({ events }: { events: api.Event[] }) {
  if (events.length === 0) {
    return (
      <Panel title="Recent Events" width={60}>
        <Text dimColor>No events yet</Text>
      </Panel>
    );
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString();
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'delivered':
        return <StatusBadge status="success" label="delivered" />;
      case 'failed':
        return <StatusBadge status="error" label="failed" />;
      case 'pending':
        return <StatusBadge status="warning" label="pending" />;
      default:
        return <StatusBadge status="info" label={status || 'unknown'} />;
    }
  };

  return (
    <Panel title="Recent Events" width={60}>
      <Box flexDirection="column">
        {events.slice(0, 8).map(event => (
          <Box key={event.id}>
            <Box width={10}>
              <Text dimColor>{formatTime(event.received_at)}</Text>
            </Box>
            <Box width={15}>
              <Text>{(event.source_name || event.source_slug || '').slice(0, 13)}</Text>
            </Box>
            <Box width={12}>
              <Text color="cyan">{(event.event_type || event.method || '-').slice(0, 10)}</Text>
            </Box>
            {getStatusBadge(event.status)}
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function SourcesPanel({ sources }: { sources: api.Source[] }) {
  if (sources.length === 0) {
    return (
      <Panel title="Sources" width={40}>
        <Text dimColor>No sources configured</Text>
      </Panel>
    );
  }

  return (
    <Panel title="Sources" width={40}>
      <Box flexDirection="column">
        {sources.slice(0, 5).map(source => (
          <Box key={source.id}>
            <Box width={20}>
              <Text>{source.name.slice(0, 18)}</Text>
            </Box>
            <Box width={10}>
              <Text dimColor>{source.provider || 'generic'}</Text>
            </Box>
            <Text color="blue">{source.event_count ?? source.eventCount ?? 0}</Text>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

function Dashboard() {
  const { exit } = useApp();
  const [data, setData] = useState<DashboardData>({
    sources: [],
    destinations: [],
    tunnels: [],
    events: [],
    loading: true,
  });

  const fetchData = async () => {
    setData(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const [sourcesRes, destsRes, tunnelsRes, eventsRes] = await Promise.all([
        api.getSources(),
        api.getDestinations(),
        api.getTunnels(),
        api.getEvents({ limit: 10 }),
      ]);

      setData({
        sources: sourcesRes.data?.sources || [],
        destinations: destsRes.data?.destinations || [],
        tunnels: tunnelsRes.data?.tunnels || [],
        events: eventsRes.data?.events || [],
        loading: false,
        lastUpdated: new Date(),
      });
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      }));
    }
  };

  useEffect(() => {
    if (!config.isAuthenticated()) {
      setData(prev => ({ ...prev, loading: false, error: 'Not authenticated. Run "hookbase login" first.' }));
      return;
    }
    fetchData();

    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
    if (input === 'r') {
      fetchData();
    }
  });

  if (data.error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Text color="red">Error: {data.error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {data.loading && (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Loading...</Text>
        </Box>
      )}

      <Box flexDirection="row" marginTop={1}>
        <StatsPanel data={data} />
        <TunnelsPanel tunnels={data.tunnels} />
      </Box>

      <Box flexDirection="row" marginTop={1}>
        <SourcesPanel sources={data.sources} />
        <EventsPanel events={data.events} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Last updated: {data.lastUpdated?.toLocaleTimeString() || 'never'} | Auto-refresh: 10s
        </Text>
      </Box>
    </Box>
  );
}

export async function runDashboard() {
  const { waitUntilExit } = render(<Dashboard />);
  await waitUntilExit();
}
