import React from 'react';
import { Box, Text, useInput } from 'ink';
import * as api from '../../lib/api.js';

interface OverviewProps {
  data: {
    sources: api.Source[];
    destinations: api.Destination[];
    tunnels: api.Tunnel[];
    events: api.Event[];
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
  const connectedTunnels = data.tunnels.filter(t => t.status === 'connected').length;
  const recentEvents = data.events.length;

  // Quick navigation with arrow keys
  const [selectedCard, setSelectedCard] = React.useState(0);
  const cards = ['sources', 'destinations', 'tunnels', 'events'];

  useInput((input, key) => {
    if (key.leftArrow) {
      setSelectedCard(prev => (prev - 1 + cards.length) % cards.length);
    }
    if (key.rightArrow) {
      setSelectedCard(prev => (prev + 1) % cards.length);
    }
    if (key.return) {
      onNavigate(cards[selectedCard]);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Dashboard Overview</Text>
        <Text dimColor> - Use arrow keys to select, Enter to view</Text>
      </Box>

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
            <Text bold color={connectedTunnels > 0 ? 'green' : 'gray'}>
              {connectedTunnels}/{data.tunnels.length}
            </Text>
            <Text dimColor>Tunnels</Text>
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
            <Text bold color="yellow">{recentEvents}</Text>
            <Text dimColor>Events</Text>
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
