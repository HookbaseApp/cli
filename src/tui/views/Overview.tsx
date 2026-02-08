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

export function OverviewView({ data, onNavigate }: OverviewProps) {
  const activeSources = data.sources.filter(s => s.is_active || s.isActive).length;
  const activeDests = data.destinations.filter(d => d.is_active).length;
  const activeRoutes = data.routes.filter(r => r.is_active).length;
  const recentEvents = data.events.length;
  const successfulDeliveries = data.deliveries.filter(d => d.status === 'success').length;
  const failedDeliveries = data.deliveries.filter(d => d.status === 'failed').length;

  const [selectedCard, setSelectedCard] = React.useState(0);
  const cards = ['sources', 'destinations', 'routes', 'events', 'deliveries'];

  const cardNavTargets: Record<string, string> = {
    'sources': 'inbound:sources',
    'destinations': 'inbound:destinations',
    'routes': 'inbound:routes',
    'events': 'inbound:events',
    'deliveries': 'inbound:events',
  };

  useInput((input, key) => {
    if (key.leftArrow || input === 'h') {
      setSelectedCard(prev => (prev - 1 + cards.length) % cards.length);
    }
    if (key.rightArrow || input === 'l') {
      setSelectedCard(prev => (prev + 1) % cards.length);
    }
    if (key.upArrow || input === 'k') {
      setSelectedCard(prev => prev >= 3 ? Math.min(prev - 3, 2) : prev);
    }
    if (key.downArrow || input === 'j') {
      setSelectedCard(prev => prev < 3 ? Math.min(prev + 3, 4) : prev);
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
        <Text bold>Dashboard</Text>
        <Text dimColor>  arrows/hjkl: navigate | Enter: view</Text>
      </Box>

      <Box flexDirection="column">
        {/* Row 1: Inbound summary */}
        <Box>
          <Box
            borderStyle={selectedCard === 0 ? 'double' : 'round'}
            borderColor={selectedCard === 0 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={0}
            marginRight={1}
            width={22}
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
            paddingY={0}
            marginRight={1}
            width={22}
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
            paddingY={0}
            width={22}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color="magenta">{activeRoutes}/{data.routes.length}</Text>
              <Text dimColor>Routes</Text>
            </Box>
          </Box>
        </Box>

        {/* Row 2: Events & Deliveries */}
        <Box marginTop={1}>
          <Box
            borderStyle={selectedCard === 3 ? 'double' : 'round'}
            borderColor={selectedCard === 3 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={0}
            marginRight={1}
            width={22}
          >
            <Box flexDirection="column" alignItems="center">
              <Text bold color="yellow">{recentEvents}</Text>
              <Text dimColor>Events</Text>
            </Box>
          </Box>

          <Box
            borderStyle={selectedCard === 4 ? 'double' : 'round'}
            borderColor={selectedCard === 4 ? 'cyan' : 'gray'}
            paddingX={2}
            paddingY={0}
            width={22}
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

      {/* Recent Activity */}
      <Box marginTop={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Recent Activity</Text>
        </Box>

        {data.events.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor>No events yet. Webhooks will appear here once you:</Text>
            <Text dimColor>  1. Create a source (press 2 then navigate to Sources)</Text>
            <Text dimColor>  2. Send webhooks to your ingest URL</Text>
          </Box>
        ) : (
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            {/* Column headers */}
            <Box>
              <Box width={12}><Text bold dimColor>Time</Text></Box>
              <Box width={20}><Text bold dimColor>Source</Text></Box>
              <Box width={28}><Text bold dimColor>Type</Text></Box>
              <Box width={12}><Text bold dimColor>Status</Text></Box>
            </Box>

            {data.events.slice(0, 5).map(event => {
              const receivedAt = event.receivedAt || event.received_at;
              const sourceName = event.sourceName || event.source_name || event.sourceSlug || event.source_slug || '';
              const eventType = event.eventType || event.event_type || event.method || '-';
              return (
                <Box key={event.id}>
                  <Box width={12}>
                    <Text dimColor>
                      {(() => {
                        if (!receivedAt) return '-';
                        const d = new Date(receivedAt);
                        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
                      })()}
                    </Text>
                  </Box>
                  <Box width={20}>
                    <Text color="cyan">
                      {sourceName.slice(0, 18)}
                    </Text>
                  </Box>
                  <Box width={28}>
                    <Text>{eventType.slice(0, 26)}</Text>
                  </Box>
                  <Box width={12}>
                    <Text color={
                      event.status === 'delivered' ? 'green' :
                      event.status === 'failed' ? 'red' : 'yellow'
                    }>
                      {event.status || 'pending'}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
