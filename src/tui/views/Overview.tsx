import React from 'react';
import { Box, Text, useInput } from 'ink';
import * as api from '../../lib/api.js';

interface OverviewProps {
  data: {
    sources: api.Source[];
    destinations: api.Destination[];
    routes: api.Route[];
    tunnels: api.Tunnel[];
    events: api.Event[];
    cronJobs: api.CronJob[];
    apiKeys: api.ApiKey[];
    deliveries: api.Delivery[];
  };
  onNavigate: (tab: string) => void;
}

function StatCard({ label, value, color, onSelect }: {
  label: string;
  value: number;
  color: string;
  onSelect: () => void;
}) {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
      marginRight={1}
      width={20}
    >
      <Box flexDirection="column" alignItems="center">
        <Text bold color={color}>{value}</Text>
        <Text dimColor>{label}</Text>
      </Box>
    </Box>
  );
}

export function OverviewView({ data, onNavigate }: OverviewProps) {
  const activeSources = data.sources.filter(s => s.is_active || s.isActive).length;
  const activeDests = data.destinations.filter(d => d.is_active).length;
  const activeRoutes = data.routes.filter(r => r.is_active).length;
  const connectedTunnels = data.tunnels.filter(t => t.status === 'connected').length;
  const recentEvents = data.events.length;
  const activeCronJobs = data.cronJobs.filter(c => c.is_active).length;
  const apiKeysCount = data.apiKeys.length;
  const successfulDeliveries = data.deliveries.filter(d => d.status === 'success').length;
  const failedDeliveries = data.deliveries.filter(d => d.status === 'failed').length;

  // Quick navigation with arrow keys
  const [selectedCard, setSelectedCard] = React.useState(0);
  const cards = ['sources', 'destinations', 'routes', 'tunnels', 'events', 'cron', 'api-keys', 'deliveries'];

  // Map card indices to navigation targets
  const cardNavTargets: Record<string, string> = {
    'sources': 'sources',
    'destinations': 'destinations',
    'routes': 'routes',
    'tunnels': 'tunnels',
    'events': 'events',
    'cron': 'cron',
    'api-keys': 'api-keys',
    'deliveries': 'events', // Deliveries shown in events view
  };

  useInput((input, key) => {
    if (key.leftArrow) {
      setSelectedCard(prev => (prev - 1 + cards.length) % cards.length);
    }
    if (key.rightArrow) {
      setSelectedCard(prev => (prev + 1) % cards.length);
    }
    if (key.upArrow) {
      // Row 2 (4-7) -> Row 1 (0-3)
      setSelectedCard(prev => prev >= 4 ? Math.min(prev - 4, 3) : prev);
    }
    if (key.downArrow) {
      // Row 1 (0-3) -> Row 2 (4-7)
      setSelectedCard(prev => prev < 4 ? Math.min(prev + 4, 7) : prev);
    }
    if (key.return) {
      const target = cardNavTargets[cards[selectedCard]];
      if (target) {
        onNavigate(target);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Dashboard Overview</Text>
        <Text dimColor> - Use arrow keys to select, Enter to view</Text>
      </Box>

      <Box flexDirection="column">
        {/* First row */}
        <Box>
          <Box
            borderStyle={selectedCard === 0 ? 'double' : 'round'}
            borderColor={selectedCard === 0 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            marginRight={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color="green">{activeSources}/{data.sources.length}</Text>
              <Text dimColor>Sources</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 1 ? 'double' : 'round'}
            borderColor={selectedCard === 1 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            marginRight={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color="blue">{activeDests}/{data.destinations.length}</Text>
              <Text dimColor>Destinations</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 2 ? 'double' : 'round'}
            borderColor={selectedCard === 2 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            marginRight={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color="magenta">{activeRoutes}/{data.routes.length}</Text>
              <Text dimColor>Routes</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 3 ? 'double' : 'round'}
            borderColor={selectedCard === 3 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color={connectedTunnels > 0 ? 'green' : 'gray'}>
                {connectedTunnels}/{data.tunnels.length}
              </Text>
              <Text dimColor>Tunnels</Text>
            </Box>
          </Box>
        </Box>

        {/* Second row */}
        <Box marginTop={1}>
          <Box
            borderStyle={selectedCard === 4 ? 'double' : 'round'}
            borderColor={selectedCard === 4 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            marginRight={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color="yellow">{recentEvents}</Text>
              <Text dimColor>Events</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 5 ? 'double' : 'round'}
            borderColor={selectedCard === 5 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            marginRight={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color={activeCronJobs > 0 ? 'cyan' : 'gray'}>
                {activeCronJobs}/{data.cronJobs.length}
              </Text>
              <Text dimColor>Cron Jobs</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 6 ? 'double' : 'round'}
            borderColor={selectedCard === 6 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            marginRight={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color={apiKeysCount > 0 ? 'yellow' : 'gray'}>
                {apiKeysCount}
              </Text>
              <Text dimColor>API Keys</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 7 ? 'double' : 'round'}
            borderColor={selectedCard === 7 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={1}
            width={20}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold>
                <Text color="green">{successfulDeliveries}</Text>
                <Text dimColor>/</Text>
                <Text color="red">{failedDeliveries}</Text>
              </Text>
              <Text dimColor>Deliveries</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box marginTop={2} flexDirection="column">
        <Text bold>Recent Activity</Text>
        <Box marginTop={1} flexDirection="column">
          {data.events.length === 0 ? (
            <Text dimColor>No recent events</Text>
          ) : (
            data.events.slice(0, 5).map(event => (
              <Box key={event.id}>
                <Box width={10}>
                  <Text dimColor>
                    {new Date(event.received_at).toLocaleTimeString()}
                  </Text>
                </Box>
                <Box width={15}>
                  <Text color="cyan">
                    {(event.source_name || event.source_slug || '').slice(0, 13)}
                  </Text>
                </Box>
                <Box width={12}>
                  <Text>{event.event_type || event.method || '-'}</Text>
                </Box>
                <Text color={
                  event.status === 'delivered' ? 'green' :
                  event.status === 'failed' ? 'red' : 'yellow'
                }>
                  {event.status || 'pending'}
                </Text>
              </Box>
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}
