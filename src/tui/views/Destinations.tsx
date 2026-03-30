import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import * as api from '../../lib/api.js';

interface DestinationsViewProps {
  destinations: api.Destination[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

function DestinationList({ destinations, onSelect, onCreate }: {
  destinations: api.Destination[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { id: 'create', name: '+ Create New Destination', isAction: true },
    ...destinations,
  ];

  useInput((input, key) => {
    // Vim-style navigation (j/k) and arrow keys
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
    }
    // Create new with 'n'
    if (input === 'n') {
      onCreate();
    }
    if (key.return) {
      const item = items[selectedIndex];
      if (item.id === 'create') {
        onCreate();
      } else {
        onSelect(item.id);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Destinations</Text>
        <Text dimColor> - {destinations.length} total | j/k: navigate | Enter: select | n: new</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {/* Column headers */}
        <Box borderBottom marginBottom={0}>
          <Box width={2}><Text> </Text></Box>
          <Box width={20}><Text bold dimColor>Name</Text></Box>
          <Box width={7}><Text bold dimColor>Type</Text></Box>
          <Box width={8}><Text bold dimColor>Method</Text></Box>
          <Box width={40}><Text bold dimColor>URL / Bucket</Text></Box>
          <Box width={12}><Text bold dimColor>Deliveries</Text></Box>
        </Box>

        {destinations.length === 0 && (
          <Box paddingY={1} flexDirection="column">
            <Text dimColor>No destinations yet. Press </Text>
            <Text color="green">n</Text>
            <Text dimColor> to create your first destination.</Text>
          </Box>
        )}

        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isAction = 'isAction' in item;

          return (
            <Box key={item.id}>
              <Box width={2}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '▶' : ' '}
                </Text>
              </Box>
              {isAction ? (
                <Box width={20}><Text color="green">+ New Destination</Text></Box>
              ) : (
                <>
                  <Box width={20}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {String(item.name || '').slice(0, 18)}{String(item.name || '').length > 18 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={7}>
                    {(() => {
                      const destType = (item as any).type || (item as any).destinationType || 'http';
                      const typeColor = destType === 'http' ? 'gray' : destType === 's3' ? 'yellow' : destType === 'r2' ? 'magenta' : destType === 'azure_blob' ? 'cyan' : 'blue';
                      return <Text color={typeColor}>{destType.toUpperCase().slice(0, 5)}</Text>;
                    })()}
                  </Box>
                  <Box width={8}>
                    <Text color="yellow">{item.method || 'POST'}</Text>
                  </Box>
                  <Box width={40}>
                    {(() => {
                      const destType = (item as any).type || (item as any).destinationType || 'http';
                      if (destType !== 'http') {
                        try {
                          const cfg = JSON.parse((item as any).config || '{}');
                          const display = `${cfg.bucket || '?'}${cfg.prefix ? '/' + cfg.prefix : ''}`;
                          return <Text color="blue">{display.slice(0, 38)}{display.length > 38 ? '…' : ''}</Text>;
                        } catch {
                          return <Text dimColor>-</Text>;
                        }
                      }
                      return <Text color="blue">{item.url.slice(0, 38)}{item.url.length > 38 ? '…' : ''}</Text>;
                    })()}
                  </Box>
                  <Box width={12}>
                    <Text dimColor>{(item as any).delivery_count ?? (item as any).deliveryCount ?? 0}</Text>
                  </Box>
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function DestinationDetail({ destId, destinations, onBack, onRefresh }: {
  destId: string;
  destinations: api.Destination[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const dest = destinations.find(d => d.id === destId);
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
        const result = await api.testDestination(destId);
        if (result.error) {
          setTestResult({ success: false, status: 0, time: 0, error: result.error });
        } else if (result.data) {
          // Handle possible nested data envelope
          const raw = result.data as Record<string, unknown>;
          const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
          setTestResult({
            success: data.success === true,
            status: (data.statusCode ?? data.status_code ?? 0) as number,
            time: (data.duration ?? data.responseTime ?? data.response_time ?? 0) as number,
            error: data.error as string | undefined,
          });
        }
      } catch (err) {
        setTestResult({ success: false, status: 0, time: 0, error: err instanceof Error ? err.message : 'Test failed' });
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
        const result = await api.deleteDestination(destId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('Destination deleted successfully');
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

  if (!dest) {
    return (
      <Box flexDirection="column">
        <Text color="red">Destination not found: {destId}</Text>
        <Text dimColor>Available IDs: {destinations.map(d => d.id).join(', ') || 'none'}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Destination Details</Text>
        <Text dimColor> - Esc: back | t: test | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={16}><Text dimColor>ID:</Text></Box>
          <Text>{dest.id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Name:</Text></Box>
          <Text bold>{dest.name}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Slug:</Text></Box>
          <Text>{(dest as any).slug || '-'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Type:</Text></Box>
          <Text color={(() => {
            const t = (dest as any).type || (dest as any).destinationType || 'http';
            return t === 'http' ? 'white' : t === 's3' ? 'yellow' : t === 'r2' ? 'magenta' : t === 'azure_blob' ? 'cyan' : 'blue';
          })()}>
            {((dest as any).type || (dest as any).destinationType || 'http').toUpperCase()}
          </Text>
        </Box>
        {(() => {
          const destType = (dest as any).type || (dest as any).destinationType || 'http';
          if (destType !== 'http') {
            try {
              const cfg = JSON.parse((dest as any).config || '{}');
              return (
                <>
                  <Box>
                    <Box width={16}><Text dimColor>Bucket:</Text></Box>
                    <Text color="blue">{cfg.bucket || '-'}</Text>
                  </Box>
                  {cfg.region && (
                    <Box>
                      <Box width={16}><Text dimColor>Region:</Text></Box>
                      <Text>{cfg.region}</Text>
                    </Box>
                  )}
                  {cfg.prefix && (
                    <Box>
                      <Box width={16}><Text dimColor>Prefix:</Text></Box>
                      <Text>{cfg.prefix}</Text>
                    </Box>
                  )}
                  <Box>
                    <Box width={16}><Text dimColor>File Format:</Text></Box>
                    <Text>{cfg.fileFormat || 'jsonl'}</Text>
                  </Box>
                  <Box>
                    <Box width={16}><Text dimColor>Partition:</Text></Box>
                    <Text>{cfg.partitionBy || 'date'}</Text>
                  </Box>
                </>
              );
            } catch {
              return null;
            }
          }
          return (
            <>
              <Box>
                <Box width={16}><Text dimColor>URL:</Text></Box>
                <Text color="blue">{dest.url}</Text>
              </Box>
              <Box>
                <Box width={16}><Text dimColor>Method:</Text></Box>
                <Text color="yellow">{dest.method || 'POST'}</Text>
              </Box>
              <Box>
                <Box width={16}><Text dimColor>Auth Type:</Text></Box>
                <Text>{dest.auth_type || (dest as any).authType || 'none'}</Text>
              </Box>
            </>
          );
        })()}
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={(dest.is_active || (dest as any).isActive) ? 'green' : 'red'}>
            {(dest.is_active || (dest as any).isActive) ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Static IP:</Text></Box>
          {(() => {
            const staticIp = dest.use_static_ip ?? (dest as any).useStaticIp;
            const enabled = staticIp === 1 || staticIp === true;
            return <Text color={enabled ? 'green' : 'gray'}>{enabled ? 'Enabled' : 'Disabled'}</Text>;
          })()}
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Deliveries:</Text></Box>
          <Text>{dest.delivery_count ?? (dest as any).deliveryCount ?? 0}</Text>
        </Box>

        {testing && (
          <Box marginTop={1}>
            <Text color="yellow">Testing destination...</Text>
          </Box>
        )}

        {testResult && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Test Result:</Text>
            {testResult.error ? (
              <Text color="red">✗ Error: {testResult.error}</Text>
            ) : (
              <Text color={testResult.success ? 'green' : 'red'}>
                {testResult.success ? '✓' : '✗'} Status: {testResult.status > 0 ? testResult.status : 'N/A'} | Time: {testResult.time}ms
              </Text>
            )}
          </Box>
        )}

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this destination?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {deleting && (
          <Box marginTop={1}>
            <Text color="yellow">Deleting...</Text>
          </Box>
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

type DestType = 'http' | 's3' | 'r2' | 'gcs' | 'azure_blob';
type CreateStep = 'name' | 'type' | 'url' | 'method' | 'bucket' | 'region' | 'endpoint' | 'accessKeyId' | 'secretAccessKey' | 'projectId' | 'serviceAccountKey' | 'accountName' | 'accountKey' | 'containerName' | 'prefix' | 'staticIp' | 'creating' | 'done';

// Required config fields per warehouse type
const WAREHOUSE_FIELDS: Record<string, CreateStep[]> = {
  s3: ['bucket', 'region', 'accessKeyId', 'secretAccessKey', 'prefix'],
  r2: ['bucket', 'endpoint', 'accessKeyId', 'secretAccessKey', 'prefix'],
  gcs: ['bucket', 'projectId', 'serviceAccountKey', 'prefix'],
  azure_blob: ['accountName', 'accountKey', 'containerName', 'prefix'],
};

const FIELD_LABELS: Record<string, { label: string; placeholder: string }> = {
  bucket: { label: 'Bucket name', placeholder: 'my-webhook-bucket' },
  region: { label: 'AWS Region', placeholder: 'us-east-1' },
  endpoint: { label: 'S3 API endpoint', placeholder: 'https://<account_id>.r2.cloudflarestorage.com' },
  accessKeyId: { label: 'Access Key ID', placeholder: 'AKIA...' },
  secretAccessKey: { label: 'Secret Access Key', placeholder: '********' },
  projectId: { label: 'GCP Project ID', placeholder: 'my-project-123' },
  serviceAccountKey: { label: 'Service Account Key (JSON)', placeholder: '{"type":"service_account",...}' },
  accountName: { label: 'Storage Account Name', placeholder: 'mystorageaccount' },
  accountKey: { label: 'Storage Account Key', placeholder: '********' },
  containerName: { label: 'Container Name', placeholder: 'webhooks' },
  prefix: { label: 'Key prefix (optional)', placeholder: 'webhooks/production' },
};

function CreateDestination({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<CreateStep>('name');
  const [name, setName] = useState('');
  const [destType, setDestType] = useState<DestType>('http');
  // HTTP fields
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('POST');
  // Warehouse config fields
  const [configFields, setConfigFields] = useState<Record<string, string>>({});
  const [currentFieldValue, setCurrentFieldValue] = useState('');
  // Common
  const [useStaticIp, setUseStaticIp] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdDest, setCreatedDest] = useState<api.Destination | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const isWarehouse = destType !== 'http';

  const handleTypeSelect = (item: { value: string }) => {
    const selected = item.value as DestType;
    setDestType(selected);
    if (selected === 'http') {
      setStep('url');
    } else {
      // Start the first warehouse config field
      const fields = WAREHOUSE_FIELDS[selected];
      setStep(fields[0]);
      setCurrentFieldValue('');
    }
  };

  const handleMethodSelect = (item: { value: string }) => {
    setMethod(item.value);
    setStep('staticIp');
  };

  // Advance to the next warehouse config field, or to staticIp/creating
  const advanceWarehouseField = (currentField: string, value: string) => {
    // prefix is optional, so allow empty
    if (currentField !== 'prefix' && !value.trim()) return;

    const updated = { ...configFields, [currentField]: value.trim() };
    setConfigFields(updated);
    setCurrentFieldValue('');

    const fields = WAREHOUSE_FIELDS[destType];
    const currentIndex = fields.indexOf(currentField as CreateStep);
    if (currentIndex < fields.length - 1) {
      setStep(fields[currentIndex + 1]);
    } else {
      // Warehouse destinations don't use static IP (they write to object storage)
      setStep('creating');
      doCreate(updated);
    }
  };

  const handleStaticIpSelect = (item: { value: string }) => {
    const staticIp = item.value === 'yes';
    setUseStaticIp(staticIp);
    setStep('creating');
    doCreate(undefined, staticIp);
  };

  const doCreate = async (warehouseConfig?: Record<string, string>, staticIp?: boolean) => {
    try {
      const createData: Parameters<typeof api.createDestination>[0] = {
        name,
        type: destType,
      };

      if (destType === 'http') {
        createData.url = url;
        createData.method = method;
        createData.useStaticIp = staticIp;
      } else {
        const cfg = warehouseConfig || configFields;
        // Build config object, filtering out empty optional fields
        const config: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cfg)) {
          if (v) config[k] = v;
        }
        config.fileFormat = 'jsonl';
        config.partitionBy = 'date';
        createData.config = config;
      }

      const result = await api.createDestination(createData);
      if (result.error) {
        setError(result.error);
        setStep(isWarehouse ? WAREHOUSE_FIELDS[destType][0] : 'staticIp');
      } else {
        setCreatedDest(result.data?.destination || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create destination');
      setStep(isWarehouse ? WAREHOUSE_FIELDS[destType][0] : 'staticIp');
    }
  };

  // Summary lines showing what's been entered so far
  const summaryLines: string[] = [`Name: ${name}`];
  if (step !== 'name' && step !== 'type') {
    summaryLines.push(`Type: ${destType.toUpperCase()}`);
  }
  if (destType === 'http') {
    if (url) summaryLines.push(`URL: ${url}`);
    if (step === 'staticIp' || step === 'creating' || step === 'done') summaryLines.push(`Method: ${method}`);
  } else {
    // Show warehouse fields filled so far
    for (const [k, v] of Object.entries(configFields)) {
      if (v) {
        const label = FIELD_LABELS[k]?.label || k;
        const display = ['secretAccessKey', 'accountKey', 'serviceAccountKey'].includes(k) ? '••••••••' : v;
        summaryLines.push(`${label}: ${display}`);
      }
    }
  }

  // Determine if current step is a warehouse config field
  const isWarehouseField = Object.values(WAREHOUSE_FIELDS).flat().includes(step);
  const fieldMeta = FIELD_LABELS[step];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create New Destination</Text>
        <Text dimColor> - Press Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>Destination name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={() => name.trim() && setStep('type')}
              placeholder="My API Endpoint"
            />
          </Box>
        )}

        {step === 'type' && (
          <Box flexDirection="column">
            <Box marginBottom={1}><Text dimColor>Name: {name}</Text></Box>
            <Text>Select destination type:</Text>
            <SelectInput
              items={[
                { label: 'HTTP Endpoint', value: 'http' },
                { label: 'Amazon S3', value: 's3' },
                { label: 'Cloudflare R2', value: 'r2' },
                { label: 'Google Cloud Storage', value: 'gcs' },
                { label: 'Azure Blob Storage', value: 'azure_blob' },
              ]}
              onSelect={handleTypeSelect}
            />
          </Box>
        )}

        {step === 'url' && (
          <Box flexDirection="column">
            {summaryLines.map((line, i) => (
              <Box key={i} marginBottom={i === summaryLines.length - 1 ? 1 : 0}><Text dimColor>{line}</Text></Box>
            ))}
            <Box>
              <Text>URL: </Text>
              <TextInput
                value={url}
                onChange={setUrl}
                onSubmit={() => url.trim() && setStep('method')}
                placeholder="https://api.example.com/webhook"
              />
            </Box>
          </Box>
        )}

        {step === 'method' && (
          <Box flexDirection="column">
            {summaryLines.map((line, i) => (
              <Box key={i} marginBottom={i === summaryLines.length - 1 ? 1 : 0}><Text dimColor>{line}</Text></Box>
            ))}
            <Text>Select HTTP method:</Text>
            <SelectInput
              items={[
                { label: 'POST (Recommended)', value: 'POST' },
                { label: 'PUT', value: 'PUT' },
                { label: 'PATCH', value: 'PATCH' },
              ]}
              onSelect={handleMethodSelect}
            />
          </Box>
        )}

        {isWarehouseField && fieldMeta && (
          <Box flexDirection="column">
            {summaryLines.map((line, i) => (
              <Box key={i} marginBottom={i === summaryLines.length - 1 ? 1 : 0}><Text dimColor>{line}</Text></Box>
            ))}
            <Box>
              <Text>{fieldMeta.label}: </Text>
              <TextInput
                value={currentFieldValue}
                onChange={setCurrentFieldValue}
                onSubmit={(val) => advanceWarehouseField(step, val)}
                placeholder={fieldMeta.placeholder}
              />
            </Box>
          </Box>
        )}

        {step === 'staticIp' && (
          <Box flexDirection="column">
            {summaryLines.map((line, i) => (
              <Box key={i} marginBottom={i === summaryLines.length - 1 ? 1 : 0}><Text dimColor>{line}</Text></Box>
            ))}
            <Text>Enable Static IP delivery? (Pro/Business plans)</Text>
            <SelectInput
              items={[
                { label: 'Yes - Route via static IP (Recommended)', value: 'yes' },
                { label: 'No - Use direct delivery', value: 'no' },
              ]}
              onSelect={handleStaticIpSelect}
            />
          </Box>
        )}

        {step === 'creating' && (
          <Text color="yellow">Creating destination...</Text>
        )}

        {step === 'done' && createdDest && (
          <Box flexDirection="column">
            <Text color="green">✓ Destination created successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdDest.id}</Text>
            </Box>
            <Box>
              <Text dimColor>Type: </Text>
              <Text>{destType.toUpperCase()}</Text>
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

export function DestinationsView({ destinations, subView, onNavigate, onRefresh }: DestinationsViewProps) {
  if (subView === 'create') {
    return (
      <CreateDestination
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const destId = subView.replace('detail:', '');
    return (
      <DestinationDetail
        destId={destId}
        destinations={destinations}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <DestinationList
      destinations={destinations}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
