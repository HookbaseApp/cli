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
import { CronView } from './views/Cron.js';
import { RoutesView } from './views/Routes.js';
import { ApiKeysView } from './views/ApiKeys.js';
import { OutboundView } from './views/Outbound.js';

type GroupName = 'overview' | 'inbound' | 'outbound' | 'tools';

interface SubTab {
  key: string;
  label: string;
}

interface TabGroup {
  key: GroupName;
  label: string;
  subTabs: SubTab[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    subTabs: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'analytics', label: 'Analytics' },
    ],
  },
  {
    key: 'inbound',
    label: 'Inbound',
    subTabs: [
      { key: 'sources', label: 'Sources' },
      { key: 'destinations', label: 'Destinations' },
      { key: 'routes', label: 'Routes' },
      { key: 'events', label: 'Events' },
    ],
  },
  {
    key: 'outbound',
    label: 'Outbound',
    subTabs: [], // OutboundView handles its own sub-tabs
  },
  {
    key: 'tools',
    label: 'Tools',
    subTabs: [
      { key: 'cron', label: 'Cron' },
      { key: 'tunnels', label: 'Tunnels' },
      { key: 'api-keys', label: 'API Keys' },
    ],
  },
];

interface AppState {
  sources: api.Source[];
  destinations: api.Destination[];
  routes: api.Route[];
  tunnels: api.Tunnel[];
  events: api.Event[];
  cronJobs: api.CronJob[];
  apiKeys: api.ApiKey[];
  deliveries: api.Delivery[];
  loading: boolean;
  error?: string;
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  useInput((input, key) => {
    if (key.escape || input === '?' || input === 'q') {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Keyboard Shortcuts</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold dimColor>Navigation</Text>
        <Box><Box width={20}><Text>Tab / Shift+Tab</Text></Box><Text dimColor>Switch groups</Text></Box>
        <Box><Box width={20}><Text>1-4</Text></Box><Text dimColor>Jump to group</Text></Box>
        <Box><Box width={20}><Text>[ / ]</Text></Box><Text dimColor>Switch sub-tabs</Text></Box>
        <Box><Box width={20}><Text>j / k or ↑/↓</Text></Box><Text dimColor>Navigate list</Text></Box>
        <Box><Box width={20}><Text>h / l or ←/→</Text></Box><Text dimColor>Navigate left/right</Text></Box>
        <Box><Box width={20}><Text>Enter</Text></Box><Text dimColor>Select / view details</Text></Box>
        <Box><Box width={20}><Text>Esc / b</Text></Box><Text dimColor>Go back</Text></Box>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold dimColor>Actions</Text>
        <Box><Box width={20}><Text>n</Text></Box><Text dimColor>Create new item</Text></Box>
        <Box><Box width={20}><Text>d</Text></Box><Text dimColor>Delete item</Text></Box>
        <Box><Box width={20}><Text>t</Text></Box><Text dimColor>Test / trigger</Text></Box>
        <Box><Box width={20}><Text>e</Text></Box><Text dimColor>Enable / disable</Text></Box>
        <Box><Box width={20}><Text>p</Text></Box><Text dimColor>Toggle payload view</Text></Box>
        <Box><Box width={20}><Text>r</Text></Box><Text dimColor>Refresh data</Text></Box>
      </Box>

      <Box flexDirection="column">
        <Text bold dimColor>General</Text>
        <Box><Box width={20}><Text>?</Text></Box><Text dimColor>Show this help</Text></Box>
        <Box><Box width={20}><Text>q</Text></Box><Text dimColor>Quit</Text></Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press ? or Esc to close</Text>
      </Box>
    </Box>
  );
}

const LOGO_FRAMES: string[][] = [
  [ // 0°
    '          ▄████▄          ',
    '         ███▀▀███         ',
    '        ███ ██ ▀▀         ',
    '        ███ ███           ',
    '         ███ ███          ',
    '         ███  ███▄▄       ',
    '    ▄   ███    ▀█████▄    ',
    '   ██  ███  ▄▄▄▄▄▄▄ ▀██   ',
    '   ██ ███ ▄█████████ ██   ',
    '   ███▄▄▄███▀     ▄▄███   ',
    '    ▀█████▀      ▀███▀    ',
    '                          ',
    '                          ',
  ],
  [ // 30°
    '                  ▄▄      ',
    '               ▄██████▄   ',
    '              ███▀▄▄▀██▄  ',
    '              ██ ▄██ ██▀  ',
    '     ▄▄▄    ▄███ ███      ',
    '    ▄██▀ ▄▄███▀  ███      ',
    '   ███ ▄███▀     ███      ',
    '   ▀██▄ ▀ ▄▄▄▄▄  ▀███▄    ',
    '    ▀████████████▄ ▀██▄   ',
    '      ▀▀▀▀     ▀███ ███   ',
    '               ▄▄ ▄▄██▀   ',
    '               █████▀     ',
    '                          ',
  ],
  [ // 60°
    '                          ',
    '                          ',
    '     ▄▄▄        ▄▄███▄▄   ',
    '   ▄███▀       ███▀▀▀███  ',
    '  ███ ▄▄▄▄▄▄▄███▀ ▄█▄ ███ ',
    '  ██▄ ▀▀▀▀▀▀▀▀▀ ▄██▀ ▄██  ',
    '  ▀███▄▄▄▄     ▄██▀       ',
    '    ▀▀▀▀███▄  ███         ',
    '         ▀██▄ ███▄        ',
    '          ▀███ ███        ',
    '        ▄▄▄ ▀ ▄██▀        ',
    '        ▀██████▀▀         ',
    '           ▀▀▀            ',
  ],
  [ // 90°
    '                          ',
    '    ▄▄▄▄▄▄                ',
    '  ▄███▀▀▀▀▀               ',
    '  ███ ██▄▄                ',
    '  ███▄▀▀████▄▄▄▄████▄▄    ',
    '   ▀███▄  ▀▀████▀▀▀▀███▄  ',
    '     ▀███     ▄▄████ ███  ',
    '      ███  ▄████▀▀ ▄███▀  ',
    '   ▄  ███ ███▀     ▀▀▀    ',
    '  ███ ██▀ ██▀             ',
    '  ▀███▄▄▄██▀              ',
    '    ▀▀▀▀▀▀                ',
    '                          ',
  ],
  [ // 120°
    '           ▄▄▄            ',
    '        ▄██████▄▄         ',
    '       ███▀ ▄ ▀██         ',
    '       ███ ▀██▄           ',
    '        ███ ▀██▄          ',
    '        ███   ███▄        ',
    '  ▄▄▄  ▄██▀    ▀██████▄   ',
    '  ██▀ ███▀ ▄▄▄▄▄▄▄▄ ▀███  ',
    '  ███ ▀▀ ▄███████████ ███ ',
    '   ▀███████▀      ▄▄▄███  ',
    '     ▀▀▀▀         ▀██▀▀   ',
    '                          ',
    '                          ',
  ],
  [ // 150°
    '                          ',
    '              ▄█████▄     ',
    '             ███▀ ▀▀██▄   ',
    '             ██  ██ ▀██   ',
    '    ▄██    ▄███  ██       ',
    '   ▄██▀ ▄████▀   ██       ',
    '   ███ ▀██▀      ██▄      ',
    '    ▀██▄▄▄████▄  ▀██▄▄    ',
    '     ▀▀████▀▀▀███▄ ▀███   ',
    '               ▀▀██▄ ███  ',
    '                ▄ ▀ ▄██▀  ',
    '                ██████▀   ',
    '                  ▀▀      ',
  ],
  [ // 180°
    '                          ',
    '                          ',
    '    ▄███▄      ▄█████▄    ',
    '   ███▀▀     ▄███▀▀▀███   ',
    '   ██ █████████▀ ███ ██   ',
    '   ██▄ ▀▀▀▀▀▀▀  ███  ██   ',
    '    ▀█████▄    ███   ▀    ',
    '       ▀▀███  ███         ',
    '          ███ ███         ',
    '           ███ ███        ',
    '         ▄▄ ██ ███        ',
    '         ███▄▄███         ',
    '          ▀████▀          ',
  ],
  [ // 210°
    '                          ',
    '      ▄█████              ',
    '    ▄██▀▀ ▀▀              ',
    '    ███ ███▄     ▄▄▄▄     ',
    '    ▀██▄ ▀████████████▄   ',
    '     ▀███▄  ▀▀▀▀▀ ▄ ▀██▄  ',
    '       ███     ▄███▀ ███  ',
    '       ███  ▄███▀▀ ▄██▀   ',
    '       ███ ███▀    ▀▀▀    ',
    '   ▄██ ██▀ ██             ',
    '   ▀██▄▀▀▄███             ',
    '    ▀██████▀              ',
    '       ▀▀                 ',
  ],
  [ // 240°
    '             ▄▄▄          ',
    '          ▄▄██████▄       ',
    '         ▄██▀ ▄ ▀▀▀       ',
    '         ███ ███▄         ',
    '         ▀███ ▀██▄        ',
    '          ███  ▀███▄▄▄▄   ',
    '        ▄██▀     ▀▀▀▀███▄ ',
    '   ██▀ ▄██▀ ▄▄▄▄▄▄▄▄▄ ▀██ ',
    '  ███ ▀█▀ ▄███▀▀▀▀▀▀▀ ███ ',
    '   ███▄▄▄███       ▄███▀  ',
    '    ▀▀███▀▀        ▀▀▀    ',
    '                          ',
    '                          ',
  ],
  [ // 270°
    '                          ',
    '                ▄▄▄▄▄▄    ',
    '              ▄██▀▀▀███▄  ',
    '             ▄██ ▄██ ███  ',
    '    ▄▄▄     ▄███ ███  ▀   ',
    '  ▄███▀ ▄▄████▀  ███      ',
    '  ███ ████▀▀     ███▄     ',
    '  ▀███▄▄▄▄████▄▄  ▀███▄   ',
    '    ▀▀████▀▀▀▀████▄▄▀███  ',
    '                ▀▀██ ███  ',
    '               ▄▄▄▄▄███▀  ',
    '                ▀▀▀▀▀▀    ',
    '                          ',
  ],
  [ // 300°
    '                          ',
    '                          ',
    '    ▄▄██▄         ▄▄▄▄    ',
    '   ███▀▀▀      ▄███████▄  ',
    '  ███ ███████████▀ ▄▄ ███ ',
    '   ███▄ ▀▀▀▀▀▀▀▀ ▄███ ▄██ ',
    '    ▀██████▄    ▄██▀  ▀▀▀ ',
    '         ▀███   ███       ',
    '           ▀██▄ ███       ',
    '            ▀██▄ ███      ',
    '          ██▄ ▀ ▄███      ',
    '          ▀▀██████▀       ',
    '             ▀▀▀          ',
  ],
  [ // 330°
    '       ▄▄                 ',
    '    ▄██████               ',
    '   ▄██▀ ▄ ▀               ',
    '   ███ ▀██▄▄              ',
    '    ███▄ ▀███▄▄▄████▄▄    ',
    '     ▀▀██▄  ▀████▀▀▀██▄   ',
    '       ▀██      ▄██▄ ███  ',
    '        ██   ▄████▀ ▄██▀  ',
    '        ██  ███▀    ██▀   ',
    '    ██▄ ██  ██            ',
    '    ▀██▄▄ ▄███            ',
    '      ▀█████▀             ',
    '                          ',
  ],
];

function Logo() {
  const org = config.getCurrentOrg();
  const [step, setStep] = useState(0);
  const frameIdx = step % LOGO_FRAMES.length;

  useEffect(() => {
    if (step >= LOGO_FRAMES.length) return;
    const timer = setTimeout(() => {
      setStep(s => s + 1);
    }, 150);
    return () => clearTimeout(timer);
  }, [step]);

  return (
    <Box marginBottom={1}>
      <Box flexDirection="column">
        {LOGO_FRAMES[frameIdx].map((line, i) => (
          <Text key={i} color="#6366f1">{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Box height={5} />
        <Text bold>HOOKBASE</Text>
        <Text dimColor>v2.0.0{org ? ` | ${org.slug}` : ''}</Text>
      </Box>
    </Box>
  );
}

interface GroupTabBarProps {
  activeGroup: GroupName;
  activeSubTab: string;
  onGroupChange: (group: GroupName) => void;
  onSubTabChange: (subTab: string) => void;
  disabled?: boolean;
}

function GroupTabBar({ activeGroup, activeSubTab, onGroupChange, onSubTabChange, disabled }: GroupTabBarProps) {
  const groupIndex = TAB_GROUPS.findIndex(g => g.key === activeGroup);
  const currentGroup = TAB_GROUPS[groupIndex];

  useInput((input, key) => {
    if (disabled) return;

    // Tab/Shift+Tab switches between groups
    if (key.tab) {
      const direction = key.shift ? -1 : 1;
      const newIndex = (groupIndex + direction + TAB_GROUPS.length) % TAB_GROUPS.length;
      onGroupChange(TAB_GROUPS[newIndex].key);
      return;
    }

    // Number keys 1-4 jump to groups
    const num = parseInt(input, 10);
    if (num >= 1 && num <= TAB_GROUPS.length) {
      onGroupChange(TAB_GROUPS[num - 1].key);
      return;
    }

    // [ / ] and ←/→ switch sub-tabs within current group (arrows disabled on overview)
    const arrowNav = (key.leftArrow || key.rightArrow) && currentGroup.key !== 'overview';
    if ((input === '[' || input === ']' || arrowNav) && currentGroup.subTabs.length > 0) {
      const subIndex = currentGroup.subTabs.findIndex(s => s.key === activeSubTab);
      const direction = (input === ']' || key.rightArrow) ? 1 : -1;
      const newSubIndex = (subIndex + direction + currentGroup.subTabs.length) % currentGroup.subTabs.length;
      onSubTabChange(currentGroup.subTabs[newSubIndex].key);
    }
  });

  return (
    <Box flexDirection="column">
      {/* Group tabs */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {TAB_GROUPS.map((group, index) => (
          <Box key={group.key} marginRight={1}>
            <Text
              bold={activeGroup === group.key}
              color={activeGroup === group.key ? 'cyan' : 'gray'}
              inverse={activeGroup === group.key}
            >
              {' '}{index + 1}:{group.label}{' '}
            </Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Text dimColor>Tab: groups | []: tabs | ?: help | q: quit</Text>
      </Box>

      {/* Sub-tabs for active group */}
      {currentGroup.subTabs.length > 0 && (
        <Box paddingX={2} marginTop={0} marginBottom={1}>
          {currentGroup.subTabs.map((sub) => (
            <Box key={sub.key} marginRight={2}>
              <Text
                bold={activeSubTab === sub.key}
                color={activeSubTab === sub.key ? 'cyan' : 'gray'}
              >
                {activeSubTab === sub.key ? '▸ ' : '  '}{sub.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const [activeGroup, setActiveGroup] = useState<GroupName>('overview');
  const [activeSubTab, setActiveSubTab] = useState<string>('dashboard');
  const [subView, setSubView] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [data, setData] = useState<AppState>({
    sources: [],
    destinations: [],
    routes: [],
    tunnels: [],
    events: [],
    cronJobs: [],
    apiKeys: [],
    deliveries: [],
    loading: true,
  });

  const handleGroupChange = useCallback((group: GroupName) => {
    setActiveGroup(group);
    const groupDef = TAB_GROUPS.find(g => g.key === group);
    if (groupDef && groupDef.subTabs.length > 0) {
      setActiveSubTab(groupDef.subTabs[0].key);
    }
    setSubView(null);
  }, []);

  const handleSubTabChange = useCallback((subTab: string) => {
    setActiveSubTab(subTab);
    setSubView(null);
  }, []);

  const fetchData = useCallback(async (resource?: string | boolean) => {
    const isInitial = resource === true;
    if (isInitial) {
      setData(prev => ({ ...prev, loading: true, error: undefined }));
    }

    try {
      // Targeted refresh: only fetch the specific resource
      if (typeof resource === 'string') {
        const fetchers: Record<string, () => Promise<void>> = {
          sources: async () => {
            const res = await api.getSources();
            setData(prev => ({ ...prev, sources: res.data?.sources || prev.sources }));
          },
          destinations: async () => {
            const res = await api.getDestinations();
            setData(prev => ({ ...prev, destinations: res.data?.destinations || prev.destinations }));
          },
          routes: async () => {
            const res = await api.getRoutes();
            setData(prev => ({ ...prev, routes: res.data?.routes || prev.routes }));
          },
          tunnels: async () => {
            const res = await api.getTunnels();
            setData(prev => ({ ...prev, tunnels: res.data?.tunnels || prev.tunnels }));
          },
          events: async () => {
            const res = await api.getEvents({ limit: 20 });
            setData(prev => ({ ...prev, events: res.data?.events || prev.events }));
          },
          cron: async () => {
            const res = await api.getCronJobs();
            setData(prev => ({ ...prev, cronJobs: res.data?.cronJobs || prev.cronJobs }));
          },
          apiKeys: async () => {
            const res = await api.listApiKeys();
            setData(prev => ({ ...prev, apiKeys: res.data?.apiKeys || prev.apiKeys }));
          },
          deliveries: async () => {
            const res = await api.getDeliveries({ limit: 50 });
            setData(prev => ({ ...prev, deliveries: res.data?.deliveries || prev.deliveries }));
          },
        };
        await fetchers[resource]?.();
        return;
      }

      // Full refresh
      const [sourcesRes, destsRes, routesRes, tunnelsRes, eventsRes, cronRes, apiKeysRes, deliveriesRes] = await Promise.all([
        api.getSources(),
        api.getDestinations(),
        api.getRoutes(),
        api.getTunnels(),
        api.getEvents({ limit: 20 }),
        api.getCronJobs(),
        api.listApiKeys(),
        api.getDeliveries({ limit: 50 }),
      ]);

      setData({
        sources: sourcesRes.data?.sources || [],
        destinations: destsRes.data?.destinations || [],
        routes: routesRes.data?.routes || [],
        tunnels: tunnelsRes.data?.tunnels || [],
        events: eventsRes.data?.events || [],
        cronJobs: cronRes.data?.cronJobs || [],
        apiKeys: apiKeysRes.data?.apiKeys || [],
        deliveries: deliveriesRes.data?.deliveries || [],
        loading: false,
      });
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: isInitial ? (error instanceof Error ? error.message : 'Failed to fetch data') : prev.error,
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
    fetchData(true);
  }, [fetchData]);

  useInput((input, key) => {
    if (input === '?' && !subView) {
      setShowHelp(prev => !prev);
      return;
    }
    if (showHelp && key.escape) {
      setShowHelp(false);
      return;
    }
    if (input === 'q' && !subView && !showHelp) {
      exit();
    }
    if (key.escape && subView) {
      setSubView(null);
    }
    if (input === 'r' && !subView && !showHelp) {
      fetchData();
    }
  });

  const handleNavigate = (view: string | null) => {
    // Support group:subtab navigation from overview cards
    if (view && view.includes(':')) {
      const [group, sub] = view.split(':');
      const groupDef = TAB_GROUPS.find(g => g.key === group);
      if (groupDef) {
        setActiveGroup(group as GroupName);
        if (sub && groupDef.subTabs.find(s => s.key === sub)) {
          setActiveSubTab(sub);
        } else if (groupDef.subTabs.length > 0) {
          setActiveSubTab(groupDef.subTabs[0].key);
        }
        setSubView(null);
        return;
      }
    }
    setSubView(view);
  };

  if (data.error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Logo />
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
    switch (activeGroup) {
      case 'overview':
        if (activeSubTab === 'analytics') {
          return (
            <AnalyticsView
              onNavigate={handleNavigate}
            />
          );
        }
        return (
          <OverviewView
            data={data}
            onNavigate={handleNavigate}
          />
        );

      case 'inbound':
        switch (activeSubTab) {
          case 'sources':
            return (
              <SourcesView
                sources={data.sources}
                subView={subView}
                onNavigate={handleNavigate}
                onRefresh={() => fetchData('sources')}
              />
            );
          case 'destinations':
            return (
              <DestinationsView
                destinations={data.destinations}
                subView={subView}
                onNavigate={handleNavigate}
                onRefresh={() => fetchData('destinations')}
              />
            );
          case 'routes':
            return (
              <RoutesView
                routes={data.routes}
                sources={data.sources}
                destinations={data.destinations}
                subView={subView}
                onNavigate={handleNavigate}
                onRefresh={() => fetchData('routes')}
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
          default:
            return null;
        }

      case 'outbound':
        return (
          <OutboundView
            subView={subView}
            onNavigate={handleNavigate}
            onRefresh={fetchData}
          />
        );

      case 'tools':
        switch (activeSubTab) {
          case 'cron':
            return (
              <CronView
                cronJobs={data.cronJobs}
                subView={subView}
                onNavigate={handleNavigate}
                onRefresh={() => fetchData('cron')}
              />
            );
          case 'tunnels':
            return (
              <TunnelsView
                tunnels={data.tunnels}
                subView={subView}
                onNavigate={handleNavigate}
                onRefresh={() => fetchData('tunnels')}
              />
            );
          case 'api-keys':
            return (
              <ApiKeysView
                apiKeys={data.apiKeys}
                subView={subView}
                onNavigate={handleNavigate}
                onRefresh={() => fetchData('apiKeys')}
              />
            );
          default:
            return null;
        }

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column">
      <Logo />
      <GroupTabBar
        activeGroup={activeGroup}
        activeSubTab={activeSubTab}
        onGroupChange={handleGroupChange}
        onSubTabChange={handleSubTabChange}
        disabled={!!subView || showHelp}
      />

      {showHelp && (
        <Box marginTop={1}>
          <HelpOverlay onClose={() => setShowHelp(false)} />
        </Box>
      )}

      {!showHelp && data.loading && data.sources.length === 0 && (
        <Box marginY={1}>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Loading...</Text>
        </Box>
      )}

      {!showHelp && (
        <Box flexDirection="column" marginTop={0}>
          {renderView()}
        </Box>
      )}
    </Box>
  );
}

export async function runApp() {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}
