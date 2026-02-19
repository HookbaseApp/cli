import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import * as api from '../../lib/api.js';
import * as config from '../../lib/config.js';

interface SourcesViewProps {
  sources: api.Source[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

const PROVIDERS = [
  { label: 'Custom/Generic', value: 'custom' },
  { label: 'GitHub', value: 'github' },
  { label: 'Stripe', value: 'stripe' },
  { label: 'Shopify', value: 'shopify' },
  { label: 'Slack', value: 'slack' },
  { label: 'Twilio', value: 'twilio' },
];

function SourceList({ sources, onSelect, onCreate }: {
  sources: api.Source[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = [
    { id: 'create', name: '+ Create New Source', isAction: true },
    ...sources,
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
        <Text bold>Sources</Text>
        <Text dimColor> - {sources.length} total | j/k: navigate | Enter: select | n: new</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {/* Column headers */}
        <Box borderBottom marginBottom={0}>
          <Box width={2}><Text> </Text></Box>
          <Box width={24}><Text bold dimColor>Name</Text></Box>
          <Box width={22}><Text bold dimColor>Slug</Text></Box>
          <Box width={12}><Text bold dimColor>Provider</Text></Box>
          <Box width={8}><Text bold dimColor>Events</Text></Box>
        </Box>

        {sources.length === 0 && (
          <Box paddingY={1} flexDirection="column">
            <Text dimColor>No sources yet. Press </Text>
            <Text color="green">n</Text>
            <Text dimColor> to create your first source.</Text>
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
                <Text color="green">{item.name}</Text>
              ) : (
                <>
                  <Box width={24}>
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {item.name.slice(0, 22)}{item.name.length > 22 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={22}>
                    <Text dimColor>{item.slug.slice(0, 20)}{item.slug.length > 20 ? '…' : ''}</Text>
                  </Box>
                  <Box width={12}>
                    <Text color="blue">{item.provider || 'generic'}</Text>
                  </Box>
                  <Box width={8}>
                    <Text dimColor>{(item as any).event_count ?? (item as any).eventCount ?? 0}</Text>
                  </Box>
                  {(item.transient_mode || item.transientMode) ? (
                    <Box><Text color="magenta"> [TRANSIENT]</Text></Box>
                  ) : null}
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function SourceDetail({ sourceId, sources, onBack, onRefresh, onEdit }: {
  sourceId: string;
  sources: api.Source[];
  onBack: () => void;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const source = sources.find(s => s.id === sourceId);
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
    if (input === 'e' && !confirmDelete) {
      onEdit();
    }
    if (input === 'd' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      busy.current = true;
      setDeleting(true);
      try {
        const result = await api.deleteSource(sourceId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
          setTimeout(() => { busy.current = false; }, 300);
        } else {
          setMessage('Source deleted successfully');
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

  if (!source) {
    return (
      <Box flexDirection="column">
        <Text color="red">Source not found: {sourceId}</Text>
        <Text dimColor>Available IDs: {sources.map(s => s.id).join(', ') || 'none'}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  const org = config.getCurrentOrg();
  const apiUrl = config.getApiUrl();
  const isTransient = source.transient_mode || source.transientMode;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Source Details</Text>
        <Text dimColor> - Esc: back | e: edit | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={16}><Text dimColor>ID:</Text></Box>
          <Text>{source.id}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Name:</Text></Box>
          <Text bold>{source.name}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Slug:</Text></Box>
          <Text>{source.slug}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Provider:</Text></Box>
          <Text color="blue">{source.provider || 'generic'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Status:</Text></Box>
          <Text color={(source.is_active || source.isActive) ? 'green' : 'red'}>
            {(source.is_active || source.isActive) ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Events:</Text></Box>
          <Text>{source.event_count ?? source.eventCount ?? 0}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Routes:</Text></Box>
          <Text>{source.route_count ?? source.routeCount ?? 0}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Transient:</Text></Box>
          {isTransient ? (
            <Text color="magenta">Enabled (payloads not stored)</Text>
          ) : (
            <Text dimColor>Disabled</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Box width={16}><Text dimColor>Ingest URL:</Text></Box>
          <Text color="cyan">{apiUrl}/ingest/{org?.slug}/{source.slug}</Text>
        </Box>

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this source?</Text>
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

function EditSource({ sourceId, sources, onBack, onSaved }: {
  sourceId: string;
  sources: api.Source[];
  onBack: () => void;
  onSaved: () => void;
}) {
  const source = sources.find(s => s.id === sourceId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  // Editable fields
  const isTransient = source?.transient_mode || source?.transientMode;
  const isActive = source?.is_active || source?.isActive;
  const fields = [
    { key: 'name', label: 'Name', value: source?.name || '', type: 'text' as const },
    { key: 'provider', label: 'Provider', value: source?.provider || 'custom', type: 'text' as const },
    { key: 'description', label: 'Description', value: source?.description || '', type: 'text' as const },
    { key: 'isActive', label: 'Status', value: isActive ? 'Active' : 'Inactive', type: 'toggle' as const },
    { key: 'transientMode', label: 'Transient Mode', value: isTransient ? 'Enabled' : 'Disabled', type: 'toggle' as const },
  ];

  useInput(async (input, key) => {
    if (busy.current || saving) return;

    if (editingField) {
      // In text editing mode, Esc cancels the edit
      if (key.escape) {
        setEditingField(null);
      }
      return; // Let TextInput handle the rest
    }

    if (key.escape || input === 'b') {
      onBack();
    }
    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(fields.length - 1, prev + 1));
    }
    if (key.return || input === ' ') {
      const field = fields[selectedIndex];
      if (field.type === 'toggle') {
        // Toggle immediately
        busy.current = true;
        setSaving(true);
        const updateData: Record<string, unknown> = {};
        if (field.key === 'isActive') {
          updateData.isActive = !isActive;
        } else if (field.key === 'transientMode') {
          updateData.transientMode = !isTransient;
        }
        try {
          const result = await api.updateSource(sourceId, updateData as any);
          if (result.error) {
            setMessage(`Error: ${result.error}`);
          } else {
            setMessage(`${field.label} updated`);
            onSaved();
          }
        } catch (err) {
          setMessage(`Failed to update ${field.label}`);
        }
        setSaving(false);
        setTimeout(() => { busy.current = false; setMessage(null); }, 1500);
      } else {
        // Enter text editing mode
        setEditValue(field.value);
        setEditingField(field.key);
      }
    }
  });

  const handleTextSubmit = async () => {
    if (!editingField) return;
    busy.current = true;
    setSaving(true);
    const updateData: Record<string, unknown> = { [editingField]: editValue };
    try {
      const result = await api.updateSource(sourceId, updateData as any);
      if (result.error) {
        setMessage(`Error: ${result.error}`);
      } else {
        setMessage(`${editingField} updated`);
        onSaved();
      }
    } catch (err) {
      setMessage(`Failed to update`);
    }
    setEditingField(null);
    setSaving(false);
    setTimeout(() => { busy.current = false; setMessage(null); }, 1500);
  };

  if (!source) {
    return (
      <Box flexDirection="column">
        <Text color="red">Source not found: {sourceId}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Edit Source</Text>
        <Text dimColor> - j/k: navigate | Enter/Space: edit | Esc: back</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
        {fields.map((field, index) => {
          const isSelected = index === selectedIndex;
          const isEditing = editingField === field.key;

          return (
            <Box key={field.key}>
              <Box width={2}>
                <Text color={isSelected ? 'yellow' : undefined} bold={isSelected}>
                  {isSelected ? '▶' : ' '}
                </Text>
              </Box>
              <Box width={18}>
                <Text dimColor>{field.label}:</Text>
              </Box>
              {isEditing ? (
                <Box>
                  <TextInput
                    value={editValue}
                    onChange={setEditValue}
                    onSubmit={handleTextSubmit}
                  />
                  <Text dimColor> (Enter to save, Esc to cancel)</Text>
                </Box>
              ) : (
                <Box>
                  {field.key === 'transientMode' ? (
                    <Text color={isTransient ? 'magenta' : undefined} dimColor={!isTransient}>
                      {field.value}
                    </Text>
                  ) : field.key === 'isActive' ? (
                    <Text color={isActive ? 'green' : 'red'}>
                      {field.value}
                    </Text>
                  ) : (
                    <Text color={isSelected ? 'yellow' : undefined}>{field.value || '(empty)'}</Text>
                  )}
                  {isSelected && field.type === 'toggle' && (
                    <Text dimColor> ← Enter/Space to toggle</Text>
                  )}
                  {isSelected && field.type === 'text' && (
                    <Text dimColor> ← Enter to edit</Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}

        {/* Transient warning */}
        {isTransient && (
          <Box marginTop={1} paddingX={1}>
            <Text color="magenta">⚠ Transient: Payloads not stored. Replay unavailable.</Text>
          </Box>
        )}

        {saving && (
          <Box marginTop={1}>
            <Text color="yellow">Saving...</Text>
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith('Error') || message.startsWith('Failed') ? 'red' : 'green'}>{message}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function CreateSource({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'slug' | 'provider' | 'transient' | 'confirm' | 'creating' | 'done'>('name');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [provider, setProvider] = useState('');
  const [transient, setTransient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSource, setCreatedSource] = useState<api.Source | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const handleNameSubmit = () => {
    if (name.trim()) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
      setStep('slug');
    }
  };

  const handleSlugSubmit = () => {
    if (slug.trim()) {
      setStep('provider');
    }
  };

  const handleProviderSelect = (item: { value: string }) => {
    setProvider(item.value);
    setStep('transient');
  };

  const handleTransientSelect = async (item: { value: string }) => {
    const isTransient = item.value === 'yes';
    setTransient(isTransient);
    setStep('creating');

    try {
      const result = await api.createSource(name, slug, provider, {
        transientMode: isTransient,
      });
      if (result.error) {
        setError(result.error);
        setStep('confirm');
      } else {
        setCreatedSource(result.data?.source || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create source');
      setStep('confirm');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create New Source</Text>
        <Text dimColor> - Press Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>Source name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="My Webhook Source"
            />
          </Box>
        )}

        {step === 'slug' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Box>
              <Text>Slug: </Text>
              <TextInput
                value={slug}
                onChange={setSlug}
                onSubmit={handleSlugSubmit}
                placeholder="my-webhook-source"
              />
            </Box>
          </Box>
        )}

        {step === 'provider' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Slug: {slug}</Text>
            </Box>
            <Text>Select provider:</Text>
            <SelectInput
              items={PROVIDERS}
              onSelect={handleProviderSelect}
            />
          </Box>
        )}

        {step === 'transient' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name} | Slug: {slug} | Provider: {provider}</Text>
            </Box>
            <Text>Enable transient mode?</Text>
            <Text dimColor>Payloads are never stored at rest. Replay is unavailable.</Text>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: 'No - Store payloads normally', value: 'no' },
                  { label: 'Yes - Transient (HIPAA/GDPR compliance)', value: 'yes' },
                ]}
                onSelect={handleTransientSelect}
              />
            </Box>
          </Box>
        )}

        {step === 'creating' && (
          <Box>
            <Text color="yellow">Creating source...</Text>
          </Box>
        )}

        {step === 'done' && createdSource && (
          <Box flexDirection="column">
            <Text color="green">✓ Source created successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdSource.id}</Text>
            </Box>
            {transient && (
              <Box>
                <Text color="magenta">Mode: Transient (payloads not stored)</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>Returning to list...</Text>
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

export function SourcesView({ sources, subView, onNavigate, onRefresh }: SourcesViewProps) {
  if (subView === 'create') {
    return (
      <CreateSource
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('edit:')) {
    const sourceId = subView.replace('edit:', '');
    return (
      <EditSource
        sourceId={sourceId}
        sources={sources}
        onBack={() => onNavigate(`detail:${sourceId}`)}
        onSaved={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const sourceId = subView.replace('detail:', '');
    return (
      <SourceDetail
        sourceId={sourceId}
        sources={sources}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
        onEdit={() => onNavigate(`edit:${sourceId}`)}
      />
    );
  }

  return (
    <SourceList
      sources={sources}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
