import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import * as api from '../../lib/api.js';
import { parseJsonField } from '../../lib/parseJson.js';

const MAX_PAYLOAD_CHARS = 4000;

function formatPayloadPreview(payload: unknown, eventId: string): string {
  if (payload === null || payload === undefined) {
    return '(empty payload)';
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (text.length > MAX_PAYLOAD_CHARS) {
    return `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… truncated (${text.length} bytes total). ` +
      `Use "hookbase events get ${eventId}" for the full payload.`;
  }
  return text;
}

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
    // Vim-style navigation (j/k) and arrow keys
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(events.length - 1, prev + 1));
    }
    // Guard on the item existing: selectedIndex can be stale (past the end)
    // after the events prop shrinks, which would crash on `undefined.id`.
    if (key.return && events[selectedIndex]) {
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
        <Text dimColor> - {events.length} recent | j/k: navigate | Enter: view details</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {/* Column headers */}
        <Box borderBottom marginBottom={0}>
          <Box width={2}><Text> </Text></Box>
          <Box width={10}><Text bold dimColor>Time</Text></Box>
          <Box width={22}><Text bold dimColor>Source</Text></Box>
          <Box width={12}><Text bold dimColor>Status</Text></Box>
          <Box width={16}><Text bold dimColor>ID</Text></Box>
        </Box>

        {events.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No events yet. Events will appear here when webhooks are received.</Text>
          </Box>
        ) : (
          events.map((event, index) => {
            const isSelected = index === selectedIndex;
            const d = new Date(event.received_at || event.receivedAt || '');
            const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
            return (
              <Box key={event.id}>
                <Box width={2}>
                  <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                    {isSelected ? '▶' : ' '}
                  </Text>
                </Box>
                <Box width={10}>
                  <Text dimColor>{time}</Text>
                </Box>
                <Box width={22}>
                  <Text color="cyan">
                    {(event.source_name || event.sourceName || event.source_slug || event.sourceSlug || '').slice(0, 20)}
                  </Text>
                </Box>
                <Box width={12}>
                  <Text color={getStatusColor(event.status || 'pending')}>
                    ● {event.status || 'pending'}
                  </Text>
                </Box>
                <Text dimColor>{event.id.slice(0, 14)}…</Text>
              </Box>
            );
          })
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
  const [fetchedPayload, setFetchedPayload] = useState<unknown>(undefined);
  const [payloadFetched, setPayloadFetched] = useState(false);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  const payloadKey = event?.payloadKey || event?.payload_key || '';
  const isTransient = payloadKey === 'transient:inline' || payloadKey.startsWith('transient/');

  // Lazy-load the payload only once the user asks to see it — the events list
  // this view is seeded from doesn't include it, and GET /api/events/:id returns
  // payload as a sibling of event, not nested inside it. Cached via payloadFetched
  // so toggling 'p' off/on again doesn't refetch (payload itself may legitimately
  // be null). Relies on the EventsView call site keying this component by eventId,
  // so a fresh event gets fresh state.
  useEffect(() => {
    if (!showPayload || !event || isTransient || payloadFetched || payloadLoading) return;
    let cancelled = false;
    setPayloadLoading(true);
    setPayloadError(null);
    api.getEvent(event.id)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setPayloadError(res.error);
        } else {
          setFetchedPayload(res.data?.payload);
          setPayloadFetched(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPayloadError(err instanceof Error ? err.message : 'Failed to load payload');
        }
      })
      .finally(() => {
        if (!cancelled) setPayloadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showPayload, event, isTransient, payloadFetched, payloadLoading]);

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
          <Box width={16}><Text dimColor>ID:</Text></Box>
          <Text>{event.id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Source:</Text></Box>
          <Text color="cyan">{(event.sourceName || event.source_name || event.sourceSlug || event.source_slug || '').trim() || '-'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Method:</Text></Box>
          <Text color="yellow">{(() => {
            // Try to extract method from various sources
            const method = event.method;
            if (method) return method;
            // Try headers (stored as :method in new events)
            if (event.headers) {
              const headers = parseJsonField(event.headers, {} as Record<string, string>);
              if (headers[':method']) return headers[':method'];
            }
            return '-';
          })()}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Event Type:</Text></Box>
          <Text>{event.eventType || event.event_type || '-'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={getStatusColor(event.status || 'pending')}>
            ● {event.status || 'pending'}
          </Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Received:</Text></Box>
          <Text>{new Date(event.received_at || event.receivedAt || '').toLocaleString()}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Deliveries:</Text></Box>
          <Text>
            {event.deliveryStats?.total ?? event.deliveryCount ?? event.delivery_count ?? 0}
            {event.deliveryStats && event.deliveryStats.failed > 0 && (
              <Text color="red"> ({event.deliveryStats.failed} failed)</Text>
            )}
          </Text>
        </Box>

        {event.headers && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Headers:</Text>
            <Box marginLeft={2} flexDirection="column">
              {Object.entries(parseJsonField(event.headers, {} as Record<string, string>))
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

        {/* Transient mode indicator */}
        {isTransient && (
          <Box marginTop={1}>
            <Text color="magenta">Transient event - payload was not stored (compliance mode)</Text>
          </Box>
        )}

        {showPayload && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Payload:</Text>
            <Box marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
              {isTransient ? (
                <Text color="magenta">Payload not available - transient mode (not stored)</Text>
              ) : payloadLoading ? (
                <Text color="yellow"><Spinner type="dots" /> Loading payload...</Text>
              ) : payloadError ? (
                <Text color="red">Failed to load payload: {payloadError}</Text>
              ) : payloadFetched ? (
                <Text dimColor>{formatPayloadPreview(fetchedPayload, event.id)}</Text>
              ) : (
                <Text dimColor>Loading payload...</Text>
              )}
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
        key={eventId}
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
