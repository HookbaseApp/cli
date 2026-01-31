import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import * as api from '../../lib/api.js';

interface AnalyticsViewProps {
  onNavigate: (view: string | null) => void;
}

type TimeRange = '1h' | '24h' | '7d' | '30d';

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: '1h', label: '1 Hour' },
  { key: '24h', label: '24 Hours' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

export function AnalyticsView({ onNavigate }: AnalyticsViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [selectedRangeIndex, setSelectedRangeIndex] = useState(1);
  const [data, setData] = useState<api.DashboardAnalytics | null>(null);
  const [liveEvents, setLiveEvents] = useState<api.Event[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [analyticsRes, eventsRes] = await Promise.all([
        api.getDashboardAnalytics(timeRange),
        api.getEvents({ limit: 10 }),
      ]);

      if (analyticsRes.data) {
        setData(analyticsRes.data);
      }
      if (eventsRes.data?.events) {
        setLiveEvents(eventsRes.data.events);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
    }
    setLoading(false);
  }, [timeRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 5 seconds for live events
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(async () => {
      try {
        const eventsRes = await api.getEvents({ limit: 10 });
        if (eventsRes.data?.events) {
          setLiveEvents(eventsRes.data.events);
        }
      } catch (err) {
        // Silently fail on refresh
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  useInput((input, key) => {
    if (key.escape) {
      onNavigate(null);
    }
    if (key.leftArrow) {
      setSelectedRangeIndex(prev => Math.max(0, prev - 1));
    }
    if (key.rightArrow) {
      setSelectedRangeIndex(prev => Math.min(TIME_RANGES.length - 1, prev + 1));
    }
    if (key.return) {
      const newRange = TIME_RANGES[selectedRangeIndex].key;
      if (newRange !== timeRange) {
        setTimeRange(newRange);
        setLoading(true);
      }
    }
    if (input === 'r') {
      setLoading(true);
      fetchData();
    }
    if (input === 'a') {
      setAutoRefresh(prev => !prev);
    }
  });

  if (loading && !data) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> Loading analytics...</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text dimColor>Press 'r' to retry</Text>
      </Box>
    );
  }

  // Handle different API response structures
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawOverview: any = data?.overview || data || {};
  const overview = {
    totalEvents: rawOverview.totalEvents ?? rawOverview.total_events ?? 0,
    totalDeliveries: rawOverview.totalDeliveries ?? rawOverview.total_deliveries ?? 0,
    successfulDeliveries: rawOverview.successfulDeliveries ?? rawOverview.successful_deliveries ?? 0,
    failedDeliveries: rawOverview.failedDeliveries ?? rawOverview.failed_deliveries ?? 0,
    successRate: rawOverview.successRate ?? rawOverview.success_rate ?? 0,
    avgResponseTime: rawOverview.avgResponseTime ?? rawOverview.avg_response_time ?? 0,
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Analytics Dashboard</Text>
        <Text dimColor> - ←→ time range, Enter select, r: refresh, a: auto-refresh ({autoRefresh ? 'ON' : 'OFF'})</Text>
      </Box>

      {/* Time Range Selector */}
      <Box marginBottom={1}>
        {TIME_RANGES.map((range, index) => (
          <Box key={range.key} marginRight={1}>
            <Text
              color={index === selectedRangeIndex ? 'cyan' : timeRange === range.key ? 'green' : 'gray'}
              bold={index === selectedRangeIndex}
              inverse={index === selectedRangeIndex}
            >
              {' '}{range.label}{' '}
            </Text>
          </Box>
        ))}
        {loading && (
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
        )}
      </Box>

      {/* Overview Stats */}
      <Box marginBottom={1}>
        <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} marginRight={1} width={18}>
          <Box flexDirection="column" alignItems="center">
            <Text bold color="cyan">{overview.totalEvents}</Text>
            <Text dimColor>Events</Text>
          </Box>
        </Box>

        <Box borderStyle="round" borderColor="green" paddingX={2} paddingY={0} marginRight={1} width={18}>
          <Box flexDirection="column" alignItems="center">
            <Text bold color="green">{overview.successfulDeliveries}</Text>
            <Text dimColor>Delivered</Text>
          </Box>
        </Box>

        <Box borderStyle="round" borderColor="red" paddingX={2} paddingY={0} marginRight={1} width={18}>
          <Box flexDirection="column" alignItems="center">
            <Text bold color="red">{overview.failedDeliveries}</Text>
            <Text dimColor>Failed</Text>
          </Box>
        </Box>

        <Box borderStyle="round" borderColor="yellow" paddingX={2} paddingY={0} marginRight={1} width={18}>
          <Box flexDirection="column" alignItems="center">
            <Text bold color={overview.successRate >= 90 ? 'green' : overview.successRate >= 70 ? 'yellow' : 'red'}>
              {(overview.successRate || 0).toFixed(1)}%
            </Text>
            <Text dimColor>Success</Text>
          </Box>
        </Box>

        <Box borderStyle="round" borderColor="blue" paddingX={2} paddingY={0} width={18}>
          <Box flexDirection="column" alignItems="center">
            <Text bold color="blue">{overview.avgResponseTime?.toFixed(0) || 0}ms</Text>
            <Text dimColor>Avg Time</Text>
          </Box>
        </Box>
      </Box>

      {/* Two Column Layout */}
      <Box>
        {/* Left Column - Top Sources & Destinations */}
        <Box flexDirection="column" width="50%" marginRight={1}>
          {/* Top Sources */}
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Top Sources</Text>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              {(data?.topSources || []).length === 0 ? (
                <Text dimColor>No data</Text>
              ) : (
                (data?.topSources || []).slice(0, 5).map((source, i) => (
                  <Box key={source.id}>
                    <Box width={3}>
                      <Text dimColor>{i + 1}.</Text>
                    </Box>
                    <Box width={20}>
                      <Text>{source.name.slice(0, 18)}</Text>
                    </Box>
                    <Text color="cyan">{source.eventCount} events</Text>
                  </Box>
                ))
              )}
            </Box>
          </Box>

          {/* Top Destinations */}
          <Box flexDirection="column">
            <Text bold>Top Destinations</Text>
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              {(data?.topDestinations || []).length === 0 ? (
                <Text dimColor>No data</Text>
              ) : (
                (data?.topDestinations || []).slice(0, 5).map((dest, i) => (
                  <Box key={dest.id}>
                    <Box width={3}>
                      <Text dimColor>{i + 1}.</Text>
                    </Box>
                    <Box width={20}>
                      <Text>{dest.name.slice(0, 18)}</Text>
                    </Box>
                    <Text color={(dest.successRate || 0) >= 90 ? 'green' : (dest.successRate || 0) >= 70 ? 'yellow' : 'red'}>
                      {(dest.successRate || 0).toFixed(0)}%
                    </Text>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Box>

        {/* Right Column - Live Events */}
        <Box flexDirection="column" width="50%">
          <Box>
            <Text bold>Live Events </Text>
            {autoRefresh && (
              <Text color="green" dimColor>●</Text>
            )}
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} height={14}>
            {liveEvents.length === 0 ? (
              <Text dimColor>No recent events</Text>
            ) : (
              liveEvents.slice(0, 10).map(event => {
                // Handle both camelCase and snake_case naming conventions
                const receivedAt = event.receivedAt || event.received_at;
                const sourceName = event.sourceName || event.source_name || event.sourceSlug || event.source_slug || '';
                return (
                  <Box key={event.id}>
                    <Box width={9}>
                      <Text dimColor>
                        {receivedAt ? new Date(receivedAt).toLocaleTimeString() : '-'}
                      </Text>
                    </Box>
                    <Box width={12}>
                      <Text color="cyan">
                        {sourceName.slice(0, 10)}
                      </Text>
                    </Box>
                    <Box width={8}>
                      <Text color="yellow">{event.method || '-'}</Text>
                    </Box>
                    <Text color={
                      event.status === 'delivered' ? 'green' :
                      event.status === 'failed' ? 'red' : 'yellow'
                    }>
                      {event.status || 'pending'}
                    </Text>
                  </Box>
                );
              })
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
