import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import * as api from '../../lib/api.js';
import * as config from '../../lib/config.js';

/** Get key prefix handling both camelCase and snake_case */
function getKeyPrefix(apiKey: api.ApiKey): string {
  return apiKey.key_prefix || (apiKey as any).keyPrefix || '';
}

/** Parse scopes from string or array */
function parseScopes(scopes: string[] | string): string[] {
  if (Array.isArray(scopes)) return scopes;
  try { return JSON.parse(scopes); } catch { return []; }
}

/** Get expiry/created date handling both conventions */
function getKeyDate(apiKey: api.ApiKey, field: 'expires_at' | 'created_at' | 'last_used_at'): string | null {
  const camelMap: Record<string, string> = { expires_at: 'expiresAt', created_at: 'createdAt', last_used_at: 'lastUsedAt' };
  return (apiKey as any)[field] || (apiKey as any)[camelMap[field]] || null;
}

/** Check if the given API key is currently being used for authentication */
function isCurrentlyUsedKey(apiKey: api.ApiKey): boolean {
  if (!config.isUsingApiKey()) return false;
  const currentPrefix = config.getCurrentApiKeyPrefix();
  const prefix = getKeyPrefix(apiKey);
  return !!currentPrefix && !!prefix && currentPrefix.startsWith(prefix);
}

interface ApiKeysViewProps {
  apiKeys: api.ApiKey[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

function ApiKeyList({ apiKeys, onSelect, onCreate }: {
  apiKeys: api.ApiKey[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { id: 'create', name: '+ Create New API Key', isAction: true },
    ...apiKeys,
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>API Keys</Text>
        <Text dimColor> - {apiKeys.length} total | j/k: navigate | Enter: select | n: new</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {/* Column headers */}
        <Box borderBottom marginBottom={0}>
          <Box width={2}><Text> </Text></Box>
          <Box width={24}><Text bold dimColor>Name</Text></Box>
          <Box width={18}><Text bold dimColor>Prefix</Text></Box>
          <Box width={28}><Text bold dimColor>Scopes</Text></Box>
          <Box width={10}><Text bold dimColor>Status</Text></Box>
        </Box>

        {apiKeys.length === 0 && (
          <Box paddingY={1}>
            <Text dimColor>No API keys yet. Press </Text>
            <Text color="green">n</Text>
            <Text dimColor> to create your first API key.</Text>
          </Box>
        )}

        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isAction = 'isAction' in item;
          const isCurrent = !isAction && isCurrentlyUsedKey(item);

          return (
            <Box key={item.id}>
              <Box width={2}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '▶' : ' '}
                </Text>
              </Box>
              {isAction ? (
                <Text color="green">{item.name}</Text>
              ) : (
                <>
                  <Box width={24}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {item.name.slice(0, 22)}{item.name.length > 22 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={18}>
                    <Text dimColor>{getKeyPrefix(item) || '-'}…</Text>
                  </Box>
                  <Box width={28}>
                    <Text color="magenta">{(() => {
                      const s = parseScopes(item.scopes).join(', ');
                      return s.slice(0, 26) + (s.length > 26 ? '…' : '');
                    })()}</Text>
                  </Box>
                  <Box width={10}>
                    {isCurrent ? (
                      <Text color="cyan">★ in use</Text>
                    ) : (() => {
                      const exp = getKeyDate(item, 'expires_at');
                      if (exp && new Date(exp) < new Date()) return <Text color="red">expired</Text>;
                      return <Text color="green">active</Text>;
                    })()}
                  </Box>
                </>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>API keys allow programmatic access to the Hookbase API</Text>
      </Box>
    </Box>
  );
}

function ApiKeyDetail({ keyId, apiKeys, onBack, onRefresh }: {
  keyId: string;
  apiKeys: api.ApiKey[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const apiKey = apiKeys.find(k => k.id === keyId);
  const [action, setAction] = useState<'none' | 'revoking'>('none');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);

  const isCurrentKey = apiKey ? isCurrentlyUsedKey(apiKey) : false;

  useInput(async (input, key) => {
    if (busy.current) return;

    if (key.escape || input === 'b') {
      if (confirmRevoke) {
        setConfirmRevoke(false);
      } else {
        onBack();
      }
    }
    if (input === 'x' && !confirmRevoke && !isCurrentKey) {
      setConfirmRevoke(true);
    }
    if (input === 'y' && confirmRevoke) {
      busy.current = true;
      setAction('revoking');
      setConfirmRevoke(false);
      try {
        const result = await api.revokeApiKey(keyId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setAction('none');
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('API key revoked successfully');
          setTimeout(() => { onRefresh(); onBack(); }, 1500);
        }
      } catch (err) {
        setMessage('Failed to revoke');
        setAction('none');
        setTimeout(() => { busy.current = false; }, 300);
      }
    }
    if (input === 'n' && confirmRevoke) {
      setConfirmRevoke(false);
    }
  });

  if (!apiKey) {
    return (
      <Box flexDirection="column">
        <Text color="red">API key not found</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>API Key Details</Text>
        <Text dimColor> - Esc: back{!isCurrentKey ? ' | x: revoke' : ''}</Text>
        {isCurrentKey && <Text color="cyan"> (currently in use)</Text>}
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={16}><Text dimColor>ID:</Text></Box>
          <Text>{apiKey.id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Name:</Text></Box>
          <Text bold>{apiKey.name}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Key Prefix:</Text></Box>
          <Text color="yellow">{getKeyPrefix(apiKey) || '-'}…</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Scopes:</Text></Box>
          <Text color="magenta">{parseScopes(apiKey.scopes).join(', ')}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Created:</Text></Box>
          <Text>{formatDate(getKeyDate(apiKey, 'created_at'))}</Text>
        </Box>
        {getKeyDate(apiKey, 'last_used_at') && (
          <Box>
            <Box width={16}><Text dimColor>Last Used:</Text></Box>
            <Text>{formatDate(getKeyDate(apiKey, 'last_used_at'))}</Text>
          </Box>
        )}
        {getKeyDate(apiKey, 'expires_at') && (
          <Box>
            <Box width={16}><Text dimColor>Expires:</Text></Box>
            <Text color={new Date(getKeyDate(apiKey, 'expires_at')!) < new Date() ? 'red' : 'yellow'}>
              {formatDate(getKeyDate(apiKey, 'expires_at'))}
            </Text>
          </Box>
        )}

        {isCurrentKey && (
          <Box marginTop={1} flexDirection="column">
            <Text color="cyan" bold>This key is currently in use</Text>
            <Text dimColor>Cannot revoke the key used for authentication.</Text>
            <Text dimColor>Log in with a different method first.</Text>
          </Box>
        )}

        {confirmRevoke && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Revoke this API key?</Text>
            <Text>This will immediately invalidate the key.</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {action !== 'none' && (
          <Box marginTop={1}>
            <Text color="yellow">Revoking...</Text>
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

function CreateApiKey({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'scopes' | 'creating' | 'done' | 'error'>('name');
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read', 'write']);
  const [scopeIndex, setScopeIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const scopeOptions = [
    { value: 'read,write,delete', label: 'Full access (read, write, delete)' },
    { value: 'read,write', label: 'Read & Write (no delete)' },
    { value: 'read', label: 'Read only' },
    { value: 'write', label: 'Write only (create/update)' },
    { value: 'delete', label: 'Delete only' },
  ];

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      if (step === 'scopes') {
        setStep('name');
      } else {
        onBack();
      }
    }

    if (step === 'scopes') {
      if (key.upArrow) {
        setScopeIndex(prev => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setScopeIndex(prev => Math.min(scopeOptions.length - 1, prev + 1));
      }
      if (key.return) {
        setSelectedScopes(scopeOptions[scopeIndex].value.split(','));
        handleCreate(scopeOptions[scopeIndex].value.split(','));
      }
    }
  });

  const handleNameSubmit = () => {
    if (!name.trim()) return;
    setStep('scopes');
  };

  const handleCreate = async (scopes: string[]) => {
    setStep('creating');

    try {
      const result = await api.createApiKey(name, scopes);
      if (result.error) {
        setError(result.error);
        setStep('error');
      } else {
        setCreatedKey(result.data?.key || null);
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
      setStep('error');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create New API Key</Text>
        <Text dimColor> - Press Esc to {step === 'scopes' ? 'go back' : 'cancel'}</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>API key name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="my-api-key"
            />
          </Box>
        )}

        {step === 'scopes' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>Select permissions:</Text>
            </Box>
            {scopeOptions.map((opt, idx) => (
              <Box key={opt.value}>
                <Text
                  color={idx === scopeIndex ? 'cyan' : undefined}
                  bold={idx === scopeIndex}
                  inverse={idx === scopeIndex}
                >
                  {idx === scopeIndex ? '▶ ' : '  '}{opt.label}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {step === 'creating' && (
          <Text color="yellow">Creating API key...</Text>
        )}

        {step === 'done' && createdKey && (
          <Box flexDirection="column">
            <Text color="green">✓ API key created successfully!</Text>
            <Box marginTop={1} flexDirection="column">
              <Text color="yellow" bold>Save this key - it will not be shown again:</Text>
              <Box marginTop={1}>
                <Text color="cyan" bold>{createdKey}</Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Esc to go back</Text>
            </Box>
          </Box>
        )}

        {step === 'error' && (
          <Box flexDirection="column">
            <Text color="red">Error: {error}</Text>
            <Box marginTop={1}>
              <Text dimColor>Press Esc to go back</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function ApiKeysView({ apiKeys, subView, onNavigate, onRefresh }: ApiKeysViewProps) {
  if (subView === 'create') {
    return (
      <CreateApiKey
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const keyId = subView.replace('detail:', '');
    return (
      <ApiKeyDetail
        keyId={keyId}
        apiKeys={apiKeys}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <ApiKeyList
      apiKeys={apiKeys}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
