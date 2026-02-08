import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import * as api from '../../lib/api.js';

interface OutboundViewProps {
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

type SubTab = 'apps' | 'endpoints' | 'messages' | 'dlq';

function CreateApplication({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'description' | 'creating' | 'done'>('name');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdApp, setCreatedApp] = useState<api.WebhookApplication | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const handleCreate = async () => {
    setStep('creating');
    try {
      const result = await api.createWebhookApplication({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (result.error) {
        setError(result.error);
        setStep('name');
      } else {
        setCreatedApp((result.data as any)?.data || result.data?.application || null);
        setStep('done');
        setTimeout(onCreated, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setStep('name');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create Application</Text>
        <Text dimColor> - Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={() => name.trim() && setStep('description')}
              placeholder="My Webhook App"
            />
          </Box>
        )}

        {step === 'description' && (
          <Box flexDirection="column">
            <Text dimColor>Name: {name}</Text>
            <Box marginTop={1}>
              <Text>Description (optional, Enter to skip): </Text>
              <TextInput
                value={description}
                onChange={setDescription}
                onSubmit={handleCreate}
                placeholder=""
              />
            </Box>
          </Box>
        )}

        {step === 'creating' && (
          <Box>
            <Text color="green"><Spinner type="dots" /></Text>
            <Text> Creating application...</Text>
          </Box>
        )}

        {step === 'done' && createdApp && (
          <Box flexDirection="column">
            <Text color="green" bold>Application created!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdApp.id}</Text>
            </Box>
            <Box>
              <Text dimColor>Name: </Text>
              <Text>{createdApp.name}</Text>
            </Box>
          </Box>
        )}

        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function CreateEndpoint({ applications, onBack, onCreated }: {
  applications: api.WebhookApplication[];
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'app' | 'url' | 'creating' | 'done'>('app');
  const [selectedAppId, setSelectedAppId] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdEndpoint, setCreatedEndpoint] = useState<api.WebhookEndpoint | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const appItems = applications.map(a => ({
    label: a.name,
    value: a.id,
  }));

  const handleAppSelect = (item: { value: string }) => {
    setSelectedAppId(item.value);
    setStep('url');
  };

  const handleCreate = async () => {
    if (!url.trim()) return;
    setStep('creating');
    try {
      const result = await api.createWebhookEndpoint({
        applicationId: selectedAppId,
        url: url.trim(),
      });
      if (result.error) {
        setError(result.error);
        setStep('url');
      } else {
        const resData = (result.data as any)?.data || result.data;
        setCreatedEndpoint(resData || null);
        setSecret(resData?.secret || result.data?.secret || null);
        setStep('done');
        setTimeout(onCreated, 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setStep('url');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create Endpoint</Text>
        <Text dimColor> - Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'app' && (
          <Box flexDirection="column">
            <Text>Select application:</Text>
            {appItems.length === 0 ? (
              <Text color="yellow">No applications. Create an application first.</Text>
            ) : (
              <SelectInput items={appItems} onSelect={handleAppSelect} />
            )}
          </Box>
        )}

        {step === 'url' && (
          <Box flexDirection="column">
            <Text dimColor>App: {applications.find(a => a.id === selectedAppId)?.name}</Text>
            <Box marginTop={1}>
              <Text>Endpoint URL: </Text>
              <TextInput
                value={url}
                onChange={setUrl}
                onSubmit={handleCreate}
                placeholder="https://api.example.com/webhook"
              />
            </Box>
          </Box>
        )}

        {step === 'creating' && (
          <Box>
            <Text color="green"><Spinner type="dots" /></Text>
            <Text> Creating endpoint...</Text>
          </Box>
        )}

        {step === 'done' && createdEndpoint && (
          <Box flexDirection="column">
            <Text color="green" bold>Endpoint created!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdEndpoint.id}</Text>
            </Box>
            <Box>
              <Text dimColor>URL: </Text>
              <Text color="blue">{createdEndpoint.url}</Text>
            </Box>
            {secret && (
              <Box marginTop={1} flexDirection="column">
                <Text color="yellow" bold>Save this secret - it will not be shown again:</Text>
                <Box marginTop={1}>
                  <Text color="cyan" bold>{secret}</Text>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// Helper to get active status from app (API uses isDisabled, not is_active)
function getAppIsActive(app: any): boolean {
  if ('isDisabled' in app) return !app.isDisabled;
  if ('is_disabled' in app) return !app.is_disabled;
  if ('is_active' in app) return !!app.is_active;
  return true;
}

function getDate(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    if (obj[k]) return new Date(obj[k]).toLocaleString();
  }
  return '-';
}

function AppDetail({ appId, applications, onBack, onRefresh }: {
  appId: string;
  applications: api.WebhookApplication[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const app = applications.find((a: any) => a.id === appId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [localActive, setLocalActive] = useState<boolean | null>(null);
  const busy = useRef(false);

  const isActive = localActive !== null ? localActive : (app ? getAppIsActive(app) : false);

  useInput(async (input, key) => {
    if (busy.current) return;

    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 't' && !confirmDelete && app) {
      busy.current = true;
      setToggling(true);
      const newDisabled = isActive;
      try {
        const result = await api.updateWebhookApplication(appId, { isDisabled: newDisabled });
        if (result.error) {
          setMessage(`Error: ${result.error}`);
        } else {
          setLocalActive(!newDisabled);
          setMessage(!newDisabled ? 'Application enabled' : 'Application disabled');
          onRefresh();
        }
      } catch (err) {
        setMessage('Failed to toggle');
      }
      setToggling(false);
      setTimeout(() => { busy.current = false; }, 300);
    }
    if (input === 'd' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      busy.current = true;
      setDeleting(true);
      try {
        const result = await api.deleteWebhookApplication(appId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('Application deleted');
          setTimeout(() => { onRefresh(); onBack(); }, 1500);
        }
      } catch (err) {
        setMessage('Failed to delete');
        setConfirmDelete(false);
        setTimeout(() => { busy.current = false; }, 300);
      }
      setDeleting(false);
    }
    if (input === 'n' && confirmDelete) {
      setConfirmDelete(false);
    }
  });

  if (!app) {
    return (
      <Box flexDirection="column">
        <Text color="red">Application not found</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  const a = app as any;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Application Details</Text>
        <Text dimColor> - Esc: back | t: toggle | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box><Box width={16}><Text dimColor>ID:</Text></Box><Text>{app.id}</Text></Box>
        <Box><Box width={16}><Text dimColor>Name:</Text></Box><Text bold>{app.name}</Text></Box>
        {(a.uid || a.externalId) && (
          <Box><Box width={16}><Text dimColor>UID:</Text></Box><Text>{a.uid || a.externalId}</Text></Box>
        )}
        {(a.description || a.metadata) && (
          <Box><Box width={16}><Text dimColor>Description:</Text></Box><Text>{a.description || '-'}</Text></Box>
        )}
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={isActive ? 'green' : 'red'}>{isActive ? 'Active' : 'Disabled'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Endpoints:</Text></Box>
          <Text>{a.endpoint_count ?? a.endpointCount ?? 0}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Messages:</Text></Box>
          <Text>{a.message_count ?? a.messageCount ?? 0}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Created:</Text></Box>
          <Text dimColor>{getDate(a, 'createdAt', 'created_at')}</Text>
        </Box>

        {toggling && (
          <Box marginTop={1}><Text color="yellow"><Spinner type="dots" /> Updating...</Text></Box>
        )}

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this application?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {deleting && (
          <Box marginTop={1}><Text color="yellow"><Spinner type="dots" /> Deleting...</Text></Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith('Error') ? 'red' : 'green'}>{message}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function EndpointDetail({ endpointId, endpoints, onBack, onRefresh }: {
  endpointId: string;
  endpoints: api.WebhookEndpoint[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const endpoint = endpoints.find((e: any) => e.id === endpointId);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; status: number; time: number; error?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  useInput(async (input, key) => {
    if (busy.current) return;

    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 't' && !confirmDelete) {
      busy.current = true;
      setTesting(true);
      try {
        const result = await api.testWebhookEndpoint(endpointId);
        if (result.error) {
          setTestResult({ success: false, status: 0, time: 0, error: result.error });
        } else {
          const d = (result.data as any)?.data || result.data;
          setTestResult({
            success: d?.success === true,
            status: (d?.statusCode ?? d?.status_code ?? 0),
            time: (d?.duration ?? d?.responseTime ?? d?.response_time ?? 0),
            error: d?.error,
          });
        }
      } catch (err) {
        setTestResult({ success: false, status: 0, time: 0, error: 'Test failed' });
      }
      setTesting(false);
      setTimeout(() => { busy.current = false; }, 300);
    }
    if (input === 'd' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      busy.current = true;
      setDeleting(true);
      try {
        const result = await api.deleteWebhookEndpoint(endpointId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('Endpoint deleted');
          setTimeout(() => { onRefresh(); onBack(); }, 1500);
        }
      } catch (err) {
        setMessage('Failed to delete');
        setConfirmDelete(false);
      }
      setDeleting(false);
    }
    if (input === 'n' && confirmDelete) {
      setConfirmDelete(false);
    }
  });

  if (!endpoint) {
    return (
      <Box flexDirection="column">
        <Text color="red">Endpoint not found</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  const ep = endpoint as any;
  const epActive = ep.is_active || ep.isActive || !ep.isDisabled;
  const eventTypes = Array.isArray(ep.event_types || ep.eventTypes)
    ? (ep.event_types || ep.eventTypes).join(', ')
    : '*';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Endpoint Details</Text>
        <Text dimColor> - Esc: back | t: test | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box><Box width={16}><Text dimColor>ID:</Text></Box><Text>{endpoint.id}</Text></Box>
        <Box><Box width={16}><Text dimColor>URL:</Text></Box><Text color="blue">{endpoint.url}</Text></Box>
        <Box>
          <Box width={16}><Text dimColor>Application:</Text></Box>
          <Text>{ep.application_name || ep.applicationName || ep.application_id || ep.applicationId}</Text>
        </Box>
        {(ep.description) && (
          <Box><Box width={16}><Text dimColor>Description:</Text></Box><Text>{ep.description}</Text></Box>
        )}
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={epActive ? 'green' : 'red'}>{epActive ? 'Active' : 'Disabled'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Circuit:</Text></Box>
          {(() => {
            const state = ep.circuit_state || ep.circuitState;
            const color = state === 'closed' ? 'green' : state === 'open' ? 'red' : 'yellow';
            return <Text color={color}>{state || 'unknown'}</Text>;
          })()}
        </Box>
        <Box><Box width={16}><Text dimColor>Event Types:</Text></Box><Text>{eventTypes}</Text></Box>
        <Box><Box width={16}><Text dimColor>Timeout:</Text></Box><Text>{ep.timeout_ms || ep.timeoutMs || 30000}ms</Text></Box>
        <Box><Box width={16}><Text dimColor>Messages:</Text></Box><Text>{ep.message_count ?? ep.messageCount ?? 0}</Text></Box>
        {(ep.success_rate !== undefined || ep.successRate !== undefined) && (
          <Box>
            <Box width={16}><Text dimColor>Success Rate:</Text></Box>
            <Text>{((ep.success_rate ?? ep.successRate) * 100).toFixed(1)}%</Text>
          </Box>
        )}
        <Box>
          <Box width={16}><Text dimColor>Created:</Text></Box>
          <Text dimColor>{getDate(ep, 'createdAt', 'created_at')}</Text>
        </Box>

        {testing && (
          <Box marginTop={1}><Text color="yellow"><Spinner type="dots" /> Testing...</Text></Box>
        )}

        {testResult && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Test Result:</Text>
            {testResult.error ? (
              <Text color="red">Error: {testResult.error}</Text>
            ) : (
              <Text color={testResult.success ? 'green' : 'red'}>
                {testResult.success ? 'Passed' : 'Failed'} - Status: {testResult.status > 0 ? testResult.status : 'N/A'} | Time: {testResult.time}ms
              </Text>
            )}
          </Box>
        )}

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this endpoint?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {deleting && (
          <Box marginTop={1}><Text color="yellow"><Spinner type="dots" /> Deleting...</Text></Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith('Error') ? 'red' : 'green'}>{message}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function OutboundView({ subView, onNavigate, onRefresh }: OutboundViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('apps');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [applications, setApplications] = useState<api.WebhookApplication[]>([]);
  const [endpoints, setEndpoints] = useState<api.WebhookEndpoint[]>([]);
  const [messages, setMessages] = useState<api.WebhookMessage[]>([]);
  const [dlqMessages, setDlqMessages] = useState<api.DlqMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: 'apps', label: 'Applications' },
    { key: 'endpoints', label: 'Endpoints' },
    { key: 'messages', label: 'Messages' },
    { key: 'dlq', label: 'DLQ' },
  ];

  const fetchData = async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    }
    setError(null);
    try {
      const [appsRes, endpointsRes, messagesRes, dlqRes] = await Promise.all([
        api.getWebhookApplications(),
        api.getWebhookEndpoints(),
        api.getWebhookMessages({ limit: 50 }),
        api.getDlqMessages({ limit: 50 }),
      ]);

      if (appsRes.error) throw new Error(appsRes.error);
      if (endpointsRes.error) throw new Error(endpointsRes.error);

      // API returns { data: [...] } for all list endpoints
      setApplications((appsRes.data as any)?.data || appsRes.data?.applications || []);
      setEndpoints((endpointsRes.data as any)?.data || endpointsRes.data?.endpoints || []);
      setMessages((messagesRes.data as any)?.data || messagesRes.data?.messages || []);
      setDlqMessages((dlqRes.data as any)?.data || dlqRes.data?.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(true);
  }, []);

  const getCurrentListLength = () => {
    switch (activeSubTab) {
      case 'apps': return applications.length + 1; // +1 for create item
      case 'endpoints': return endpoints.length + 1; // +1 for create item
      case 'messages': return messages.length;
      case 'dlq': return dlqMessages.length;
      default: return 0;
    }
  };

  const getCurrentDataList = () => {
    switch (activeSubTab) {
      case 'apps': return applications;
      case 'endpoints': return endpoints;
      case 'messages': return messages;
      case 'dlq': return dlqMessages;
      default: return [];
    }
  };

  useInput((input, key) => {
    if (subView) return;

    const listLen = getCurrentListLength();

    // Sub-tab navigation with [ / ] or left/right arrows
    if (input === '[' || input === ']' || key.leftArrow || key.rightArrow) {
      const currentIdx = SUB_TABS.findIndex(t => t.key === activeSubTab);
      const direction = (input === ']' || key.rightArrow) ? 1 : -1;
      const newIdx = (currentIdx + direction + SUB_TABS.length) % SUB_TABS.length;
      setActiveSubTab(SUB_TABS[newIdx].key);
      setSelectedIndex(0);
      return;
    }

    // List navigation
    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(prev + 1, listLen - 1));
    }
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    }

    // View details / select create
    if (key.return && listLen > 0) {
      if ((activeSubTab === 'apps' || activeSubTab === 'endpoints') && selectedIndex === 0) {
        onNavigate(activeSubTab === 'apps' ? 'create-app' : 'create-endpoint');
        return;
      }
      const dataList = getCurrentDataList();
      const dataIdx = (activeSubTab === 'apps' || activeSubTab === 'endpoints') ? selectedIndex - 1 : selectedIndex;
      if (dataIdx >= 0 && dataIdx < dataList.length) {
        const item = dataList[dataIdx];
        onNavigate(`${activeSubTab}:${item.id}`);
      }
    }

    // Create new
    if (input === 'n') {
      if (activeSubTab === 'apps') {
        onNavigate('create-app');
        return;
      }
      if (activeSubTab === 'endpoints') {
        onNavigate('create-endpoint');
        return;
      }
    }

    // Refresh
    if (input === 'r') {
      fetchData();
    }

    // Test endpoint (offset by 1 for create item)
    if (input === 't' && activeSubTab === 'endpoints' && selectedIndex > 0 && endpoints.length > 0) {
      const endpoint = endpoints[selectedIndex - 1];
      if (endpoint) testEndpoint(endpoint.id);
    }

    // Retry message/DLQ
    if (input === 'y') {
      if (activeSubTab === 'messages' && messages.length > 0) {
        retryMessage(messages[selectedIndex].id);
      } else if (activeSubTab === 'dlq' && dlqMessages.length > 0) {
        retryDlqMessage(dlqMessages[selectedIndex].id);
      }
    }
  });

  const testEndpoint = async (endpointId: string) => {
    setStatusMessage('Testing endpoint...');
    const result = await api.testWebhookEndpoint(endpointId);
    if (result.error) {
      setStatusMessage(`Test failed: ${result.error}`);
    } else if (result.data?.success) {
      const d = (result.data as any)?.data || result.data;
      setStatusMessage(`Test passed: ${d.statusCode || d.status_code || '?'} (${d.duration ?? d.responseTime ?? 0}ms)`);
    } else {
      setStatusMessage(`Test failed: ${result.data?.error || 'Unknown error'}`);
    }
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const retryMessage = async (messageId: string) => {
    setStatusMessage('Retrying message...');
    const result = await api.retryWebhookMessage(messageId);
    if (result.error) {
      setStatusMessage(`Retry failed: ${result.error}`);
    } else {
      setStatusMessage('Message queued for retry');
      fetchData();
    }
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const retryDlqMessage = async (messageId: string) => {
    setStatusMessage('Retrying DLQ message...');
    const result = await api.retryDlqMessage(messageId);
    if (result.error) {
      setStatusMessage(`Retry failed: ${result.error}`);
    } else {
      setStatusMessage('DLQ message queued for retry');
      fetchData();
    }
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'delivered': return <Text color="green">{status}</Text>;
      case 'pending': return <Text color="yellow">{status}</Text>;
      case 'processing': return <Text color="cyan">{status}</Text>;
      case 'failed': return <Text color="red">{status}</Text>;
      case 'exhausted': return <Text color="red">{status}</Text>;
      default: return <Text dimColor>{status}</Text>;
    }
  };

  const formatCircuitState = (state?: string) => {
    switch (state) {
      case 'closed': return <Text color="green">closed</Text>;
      case 'open': return <Text color="red">open</Text>;
      case 'half_open': return <Text color="yellow">half_open</Text>;
      default: return <Text dimColor>-</Text>;
    }
  };

  if (loading) {
    return (
      <Box>
        <Text color="green"><Spinner type="dots" /></Text>
        <Text> Loading outbound webhooks...</Text>
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

  // Render create views
  if (subView === 'create-app') {
    return (
      <CreateApplication
        onBack={() => onNavigate(null)}
        onCreated={() => { fetchData(); onNavigate(null); }}
      />
    );
  }

  if (subView === 'create-endpoint') {
    return (
      <CreateEndpoint
        applications={applications}
        onBack={() => onNavigate(null)}
        onCreated={() => { fetchData(); onNavigate(null); }}
      />
    );
  }

  // Render detail view
  if (subView) {
    const [type, id] = subView.split(':');

    if (type === 'apps') {
      return (
        <AppDetail
          appId={id}
          applications={applications}
          onBack={() => onNavigate(null)}
          onRefresh={fetchData}
        />
      );
    }

    if (type === 'endpoints') {
      return (
        <EndpointDetail
          endpointId={id}
          endpoints={endpoints}
          onBack={() => onNavigate(null)}
          onRefresh={fetchData}
        />
      );
    }

    if (type === 'messages') {
      const message = messages.find(m => m.id === id);
      if (!message) return <Text color="red">Message not found</Text>;
      const m = message as any;
      const eventType = m.event_type || m.eventType || '-';
      const respStatus = m.response_status || m.responseStatus;
      const errorMsg = m.error_message || m.errorMessage;
      const nextRetry = m.next_retry_at || m.nextRetryAt;
      const deliveredAt = m.delivered_at || m.deliveredAt;
      const createdAt = m.created_at || m.createdAt || '';
      const endpointId = m.endpoint_id || m.endpointId || '-';
      const appId = m.application_id || m.applicationId || '-';
      const ep = endpoints.find(e => e.id === endpointId);
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Message Details</Text>
            <Text dimColor> - Esc: back | y: retry</Text>
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
            <Box><Box width={16}><Text dimColor>ID:</Text></Box><Text>{message.id}</Text></Box>
            <Box><Box width={16}><Text dimColor>Event Type:</Text></Box><Text>{eventType}</Text></Box>
            <Box><Box width={16}><Text dimColor>Endpoint:</Text></Box><Text color="blue">{ep ? ep.url : endpointId}</Text></Box>
            <Box><Box width={16}><Text dimColor>Application:</Text></Box><Text>{appId}</Text></Box>
            <Box><Box width={16}><Text dimColor>Status:</Text></Box>{formatStatus(message.status)}</Box>
            <Box>
              <Box width={16}><Text dimColor>Attempts:</Text></Box>
              <Text>{m.attempt_count ?? m.attemptCount ?? 0}/{m.max_attempts ?? m.maxAttempts ?? 5}</Text>
            </Box>
            {respStatus && (
              <Box>
                <Box width={16}><Text dimColor>Response:</Text></Box>
                <Text color={respStatus >= 200 && respStatus < 300 ? 'green' : 'red'}>{respStatus}</Text>
              </Box>
            )}
            {errorMsg && (
              <Box><Box width={16}><Text dimColor>Error:</Text></Box><Text color="red">{errorMsg}</Text></Box>
            )}
            {nextRetry && (
              <Box><Box width={16}><Text dimColor>Next Retry:</Text></Box><Text color="yellow">{new Date(nextRetry).toLocaleString()}</Text></Box>
            )}
            {deliveredAt && (
              <Box><Box width={16}><Text dimColor>Delivered:</Text></Box><Text color="green">{new Date(deliveredAt).toLocaleString()}</Text></Box>
            )}
            <Box><Box width={16}><Text dimColor>Created:</Text></Box><Text dimColor>{new Date(createdAt).toLocaleString()}</Text></Box>
          </Box>
        </Box>
      );
    }

    if (type === 'dlq') {
      const dlqMessage = dlqMessages.find(m => m.id === id);
      if (!dlqMessage) return <Text color="red">DLQ message not found</Text>;
      const d = dlqMessage as any;
      const eventType = d.event_type || d.eventType || '-';
      const reason = d.reason || '-';
      const errorMsg = d.error_message || d.errorMessage;
      const lastResp = d.last_response_status || d.lastResponseStatus;
      const origId = d.original_message_id || d.originalMessageId || '-';
      const endpointId = d.endpoint_id || d.endpointId || '-';
      const createdAt = d.created_at || d.createdAt || '';
      const ep = endpoints.find(e => e.id === endpointId);
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>DLQ Message Details</Text>
            <Text dimColor> - Esc: back | y: retry</Text>
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
            <Box><Box width={18}><Text dimColor>ID:</Text></Box><Text>{dlqMessage.id}</Text></Box>
            <Box><Box width={18}><Text dimColor>Original Msg:</Text></Box><Text dimColor>{origId}</Text></Box>
            <Box><Box width={18}><Text dimColor>Event Type:</Text></Box><Text>{eventType}</Text></Box>
            <Box><Box width={18}><Text dimColor>Endpoint:</Text></Box><Text color="blue">{ep ? ep.url : endpointId}</Text></Box>
            <Box><Box width={18}><Text dimColor>Reason:</Text></Box><Text color="red">{reason}</Text></Box>
            <Box>
              <Box width={18}><Text dimColor>Attempts:</Text></Box>
              <Text>{d.attempt_count ?? d.attemptCount ?? 0}</Text>
            </Box>
            {lastResp && (
              <Box><Box width={18}><Text dimColor>Last Response:</Text></Box><Text color="red">{lastResp}</Text></Box>
            )}
            {errorMsg && (
              <Box><Box width={18}><Text dimColor>Error:</Text></Box><Text color="red">{errorMsg}</Text></Box>
            )}
            <Box><Box width={18}><Text dimColor>Created:</Text></Box><Text dimColor>{new Date(createdAt).toLocaleString()}</Text></Box>
          </Box>
        </Box>
      );
    }

    return <Text color="red">Unknown view</Text>;
  }

  // Render list view
  return (
    <Box flexDirection="column">
      {/* Sub-tabs */}
      <Box marginBottom={1}>
        {SUB_TABS.map((tab) => (
          <Box key={tab.key} marginRight={2}>
            <Text
              bold={activeSubTab === tab.key}
              color={activeSubTab === tab.key ? 'cyan' : 'gray'}
            >
              {activeSubTab === tab.key ? '▸ ' : '  '}{tab.label}
            </Text>
          </Box>
        ))}
        <Box flexGrow={1} />
        <Text dimColor>[]/←→: switch | ↑/↓: select | Enter: view</Text>
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color="yellow">{statusMessage}</Text>
        </Box>
      )}

      {/* Content */}
      {activeSubTab === 'apps' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Applications ({applications.length})</Text>
            <Text dimColor> | n: new | Enter: details</Text>
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            <Box>
              <Box width={2}>
                <Text color={selectedIndex === 0 ? 'cyan' : undefined} bold={selectedIndex === 0}>
                  {selectedIndex === 0 ? '▶' : ' '}
                </Text>
              </Box>
              <Text color="green">+ New Application</Text>
            </Box>
            {applications.map((app, idx) => {
              const listIdx = idx + 1;
              const isSelected = listIdx === selectedIndex;
              return (
                <Box key={app.id}>
                  <Box width={2}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '▶' : ' '}
                    </Text>
                  </Box>
                  <Box width={24}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {app.name.slice(0, 22)}{app.name.length > 22 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={14}>
                    <Text dimColor>{app.endpoint_count || 0} endpoints</Text>
                  </Box>
                  <Box width={10}>
                    <Text dimColor>{app.message_count || 0} msgs</Text>
                  </Box>
                  <Box width={8}>
                    <Text color={getAppIsActive(app) ? 'green' : 'red'}>
                      {getAppIsActive(app) ? 'Active' : 'Off'}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {activeSubTab === 'endpoints' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Endpoints ({endpoints.length})</Text>
            <Text dimColor> | n: new | t: test | Enter: details</Text>
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
            <Box>
              <Box width={2}>
                <Text color={selectedIndex === 0 ? 'cyan' : undefined} bold={selectedIndex === 0}>
                  {selectedIndex === 0 ? '▶' : ' '}
                </Text>
              </Box>
              <Text color="green">+ New Endpoint</Text>
            </Box>
            {endpoints.map((ep, idx) => {
              const listIdx = idx + 1;
              const isSelected = listIdx === selectedIndex;
              return (
                <Box key={ep.id}>
                  <Box width={2}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '▶' : ' '}
                    </Text>
                  </Box>
                  <Box width={46}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {ep.url.slice(0, 44)}{ep.url.length > 44 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={12}>
                    {formatCircuitState((ep as any).circuitState || ep.circuit_state)}
                  </Box>
                  <Box width={8}>
                    <Text color={ep.is_active ? 'green' : 'red'}>
                      {ep.is_active ? 'Active' : 'Off'}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {activeSubTab === 'messages' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Recent Messages ({messages.length})</Text>
            <Text dimColor> | Enter: details | y: retry</Text>
          </Box>
          {messages.length === 0 ? (
            <Text dimColor>No messages. Send events with: hookbase outbound send</Text>
          ) : (
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              <Box borderBottom marginBottom={0}>
                <Box width={2}><Text> </Text></Box>
                <Box width={10}><Text bold dimColor>Time</Text></Box>
                <Box width={22}><Text bold dimColor>Event Type</Text></Box>
                <Box width={12}><Text bold dimColor>Status</Text></Box>
                <Box width={10}><Text bold dimColor>Response</Text></Box>
                <Box width={12}><Text bold dimColor>Attempts</Text></Box>
                <Box width={14}><Text bold dimColor>ID</Text></Box>
              </Box>
              {messages.slice(0, 15).map((msg, idx) => {
                const m = msg as any;
                const isSelected = idx === selectedIndex;
                const createdAt = m.created_at || m.createdAt || '';
                const d = createdAt ? new Date(createdAt) : null;
                const time = d ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}` : '-';
                const eventType = m.event_type || m.eventType || '-';
                const respStatus = m.response_status || m.responseStatus;
                const attempts = `${m.attempt_count ?? m.attemptCount ?? 0}/${m.max_attempts ?? m.maxAttempts ?? 5}`;
                return (
                  <Box key={msg.id}>
                    <Box width={2}>
                      <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                        {isSelected ? '▶' : ' '}
                      </Text>
                    </Box>
                    <Box width={10}><Text dimColor>{time}</Text></Box>
                    <Box width={22}>
                      <Text color={isSelected ? 'cyan' : undefined}>{eventType.slice(0, 20)}</Text>
                    </Box>
                    <Box width={12}>{formatStatus(msg.status)}</Box>
                    <Box width={10}>
                      <Text color={respStatus >= 200 && respStatus < 300 ? 'green' : respStatus ? 'red' : 'gray'}>
                        {respStatus || '-'}
                      </Text>
                    </Box>
                    <Box width={12}><Text dimColor>{attempts}</Text></Box>
                    <Text dimColor>{msg.id.slice(0, 12)}…</Text>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      {activeSubTab === 'dlq' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Dead Letter Queue ({dlqMessages.length})</Text>
            <Text dimColor> | Enter: details | y: retry</Text>
          </Box>
          {dlqMessages.length === 0 ? (
            <Text color="green">No messages in DLQ</Text>
          ) : (
            <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              <Box borderBottom marginBottom={0}>
                <Box width={2}><Text> </Text></Box>
                <Box width={10}><Text bold dimColor>Time</Text></Box>
                <Box width={20}><Text bold dimColor>Event Type</Text></Box>
                <Box width={20}><Text bold dimColor>Reason</Text></Box>
                <Box width={10}><Text bold dimColor>Response</Text></Box>
                <Box width={10}><Text bold dimColor>Attempts</Text></Box>
                <Box width={14}><Text bold dimColor>ID</Text></Box>
              </Box>
              {dlqMessages.slice(0, 15).map((msg, idx) => {
                const m = msg as any;
                const isSelected = idx === selectedIndex;
                const createdAt = m.created_at || m.createdAt || '';
                const d = createdAt ? new Date(createdAt) : null;
                const time = d ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}` : '-';
                const eventType = m.event_type || m.eventType || '-';
                const reason = m.reason || '-';
                const lastResp = m.last_response_status || m.lastResponseStatus;
                const attempts = m.attempt_count ?? m.attemptCount ?? 0;
                return (
                  <Box key={msg.id}>
                    <Box width={2}>
                      <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                        {isSelected ? '▶' : ' '}
                      </Text>
                    </Box>
                    <Box width={10}><Text dimColor>{time}</Text></Box>
                    <Box width={20}>
                      <Text color={isSelected ? 'cyan' : undefined}>{eventType.slice(0, 18)}</Text>
                    </Box>
                    <Box width={20}><Text color="red">{reason.slice(0, 18)}</Text></Box>
                    <Box width={10}>
                      <Text color={lastResp ? 'red' : 'gray'}>{lastResp || '-'}</Text>
                    </Box>
                    <Box width={10}><Text dimColor>{attempts}</Text></Box>
                    <Text dimColor>{msg.id.slice(0, 12)}…</Text>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
