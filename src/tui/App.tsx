import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import * as api from '../lib/api.js';
import * as config from '../lib/config.js';

// Views
import { OverviewView } from './views/Overview.js';
import { SourcesView } from './views/Sources.js';
import { DestinationsView } from './views/Destinations.js';
import { TunnelsView } from './views/Tunnels.js';
import { EventsView } from './views/Events.js';
import { AnalyticsView } from './views/Analytics.js';

type ViewName = 'overview' | 'sources' | 'destinations' | 'tunnels' | 'events' | 'analytics';

interface AppState {
  sources: api.Source[];
  destinations: api.Destination[];
  tunnels: api.Tunnel[];
  events: api.Event[];
  loading: boolean;
  error?: string;
}

const TABS: { key: ViewName; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sources', label: 'Sources' },
  { key: 'destinations', label: 'Destinations' },
  { key: 'tunnels', label: 'Tunnels' },
  { key: 'events', label: 'Events' },
  { key: 'analytics', label: 'Live' },
];

interface TabBarProps {
  activeTab: ViewName;
  onTabChange: (tab: ViewName) => void;
  disabled?: boolean;
}

function TabBar({ activeTab, onTabChange, disabled }: TabBarProps) {
  const activeIndex = TABS.findIndex(t => t.key === activeTab);

  useInput((input, key) => {
    // Don't handle input when disabled (e.g., when in a subview with text input)
    if (disabled) return;

    if (key.tab || (key.shift && key.tab)) {
      const direction = key.shift ? -1 : 1;
      const newIndex = (activeIndex + direction + TABS.length) % TABS.length;
      onTabChange(TABS[newIndex].key);
    }
    // Number keys for quick navigation
    const num = parseInt(input, 10);
    if (num >= 1 && num <= TABS.length) {
      onTabChange(TABS[num - 1].key);
    }
  });

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {TABS.map((tab, index) => (
        <Box key={tab.key} marginRight={2}>
          <Text
            bold={activeTab === tab.key}
            color={activeTab === tab.key ? 'cyan' : 'gray'}
            inverse={activeTab === tab.key}
          >
            {' '}{index + 1}:{tab.label}{' '}
          </Text>
        </Box>
      ))}
      <Box flexGrow={1} />
      <Text dimColor>Tab: switch | q: quit</Text>
    </Box>
  );
}

function Header() {
  const org = config.getCurrentOrg();
  return (
    <Box marginBottom={0}>
      <Text bold color="cyan">Hookbase</Text>
      {org && (
        <Text dimColor> | {org.slug}</Text>
      )}
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<ViewName>('overview');
  const [subView, setSubView] = useState<string | null>(null);
  const [data, setData] = useState<AppState>({
    sources: [],
    destinations: [],
    tunnels: [],
    events: [],
    loading: true,
  });

  const fetchData = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const [sourcesRes, destsRes, tunnelsRes, eventsRes] = await Promise.all([
        api.getSources(),
        api.getDestinations(),
        api.getTunnels(),
        api.getEvents({ limit: 20 }),
      ]);

      setData({
        sources: sourcesRes.data?.sources || [],
        destinations: destsRes.data?.destinations || [],
        tunnels: tunnelsRes.data?.tunnels || [],
        events: eventsRes.data?.events || [],
        loading: false,
      });
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch data',
      }));
    }
  }, []);

  useEffect(() => {
    if (!config.isAuthenticated()) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: 'Not authenticated. Run "hookbase login" first.',
      }));
      return;
    }
    fetchData();
  }, [fetchData]);

  useInput((input, key) => {
    // Global quit
    if (input === 'q' && !subView) {
      exit();
    }
    // Escape to go back
    if (key.escape && subView) {
      setSubView(null);
    }
    // Refresh
    if (input === 'r' && !subView) {
      fetchData();
    }
  });

  const handleNavigate = (view: string | null) => {
    setSubView(view);
  };

  if (data.error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Header />
        <Box marginTop={1}>
          <Text color="red">Error: {data.error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press 'q' to quit</Text>
        </Box>
      </Box>
    );
  }

  const renderView = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewView
            data={data}
            onNavigate={(tab) => setActiveTab(tab as ViewName)}
          />
        );
      case 'sources':
        return (
          <SourcesView
            sources={data.sources}
            subView={subView}
            onNavigate={handleNavigate}
            onRefresh={fetchData}
          />
        );
      case 'destinations':
        return (
          <DestinationsView
            destinations={data.destinations}
            subView={subView}
            onNavigate={handleNavigate}
            onRefresh={fetchData}
          />
        );
      case 'tunnels':
        return (
          <TunnelsView
            tunnels={data.tunnels}
            subView={subView}
            onNavigate={handleNavigate}
            onRefresh={fetchData}
          />
        );
      case 'events':
        return (
          <EventsView
            events={data.events}
            subView={subView}
            onNavigate={handleNavigate}
          />
        );
      case 'analytics':
        return (
          <AnalyticsView
            onNavigate={handleNavigate}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column">
      <Header />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} disabled={!!subView} />

      {data.loading && (
        <Box marginY={1}>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Loading...</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {renderView()}
      </Box>
    </Box>
  );
}

export async function runApp() {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
