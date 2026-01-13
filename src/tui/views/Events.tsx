import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import * as api from '../../lib/api.js';

interface EventsViewProps {
  events: api.Event[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
}

function EventList({ events, onSelect }: {
  events: api.Event[];
  onSelect: (id: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(events.length - 1, prev + 1));
    }
    if (key.return && events.length > 0) {
      onSelect(events[selectedIndex].id);
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return 'green';
      case 'failed': return 'red';
      case 'pending': return 'yellow';
      default: return 'gray';
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Events</Text>
        <Text dimColor> - {events.length} recent | ↑↓ navigate, Enter view details</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {events.length === 0 ? (
          <Text dimColor>No events found</Text>
        ) : (
          events.map((event, index) => (
            <Box key={event.id}>
              <Text
                color={index === selectedIndex ? 'cyan' : undefined}
                bold={index === selectedIndex}
                inverse={index === selectedIndex}
              >
                {index === selectedIndex ? '▶ ' : '  '}
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
                <Box width={10}>
                  <Text>{event.method || '-'}</Text>
                </Box>
                <Box width={12}>
                  <Text color={getStatusColor(event.status || 'pending')}>
                    ● {event.status || 'pending'}
                  </Text>
                </Box>
                <Text dimColor>{event.id.slice(0, 8)}...</Text>
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

function EventDetail({ eventId, events, onBack }: {
  eventId: string;
  events: api.Event[];
  onBack: () => void;
}) {
  const event = events.find(e => e.id === eventId);
  const [showPayload, setShowPayload] = useState(false);

  useInput((input, key) => {
    if (key.escape || input === 'b') {
      onBack();
    }
    if (input === 'p') {
      setShowPayload(prev => !prev);
    }
  });

  if (!event) {
    return (
      <Box flexDirection="column">
        <Text color="red">Event not found: {eventId}</Text>
        <Text dimColor>Available IDs: {events.map(e => e.id).join(', ') || 'none'}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return 'green';
      case 'failed': return 'red';
      case 'pending': return 'yellow';
      default: return 'gray';
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Event Details</Text>
        <Text dimColor> - Esc: back | p: toggle payload</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={18}><Text dimColor>ID:</Text></Box>
          <Text>{event.id}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Source:</Text></Box>
          <Text color="cyan">{event.source_name || event.source_slug || '-'}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Method:</Text></Box>
          <Text color="yellow">{event.method || '-'}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Event Type:</Text></Box>
          <Text>{event.event_type || '-'}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Status:</Text></Box>
          <Text color={getStatusColor(event.status || 'pending')}>
            ● {event.status || 'pending'}
          </Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Received:</Text></Box>
          <Text>{new Date(event.received_at).toLocaleString()}</Text>
        </Box>
        <Box>
          <Box width={18}><Text dimColor>Deliveries:</Text></Box>
          <Text>{event.delivery_count ?? 0}</Text>
        </Box>

        {event.headers && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Headers:</Text>
            <Box marginLeft={2} flexDirection="column">
              {Object.entries(typeof event.headers === 'string' ? JSON.parse(event.headers) : event.headers)
                .slice(0, 5)
                .map(([key, value]) => (
                  <Box key={key}>
                    <Text dimColor>{key}: </Text>
                    <Text>{String(value).slice(0, 50)}</Text>
                  </Box>
                ))}
            </Box>
          </Box>
        )}

        {showPayload && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Payload:</Text>
            <Box marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
              <Text dimColor>
                Payload size: {event.payload_size ?? 'unknown'} bytes
                {'\n'}Use CLI command: hookbase events get {event.id}
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Press 'p' to {showPayload ? 'hide' : 'show'} payload
        </Text>
      </Box>
    </Box>
  );
}

export function EventsView({ events, subView, onNavigate }: EventsViewProps) {
  if (subView && subView.startsWith('detail:')) {
    const eventId = subView.replace('detail:', '');
    return (
      <EventDetail
        eventId={eventId}
        events={events}
        onBack={() => onNavigate(null)}
      />
    );
  }

  return (
    <EventList
      events={events}
      onSelect={(id) => onNavigate(`detail:${id}`)}
    />
  );
}
