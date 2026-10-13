import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import * as api from '../../lib/api.js';
import * as config from '../../lib/config.js';
import {
  FALLBACK_PROVIDERS,
  NO_PROVIDER,
  OTHER_PROVIDER,
  loadProviderChoices,
  getChoiceSecretInfo,
  lookupProviderSecretInfo,
  planSecret,
  readSecretValue,
  type ProviderChoice,
  type SecretInfo,
  type SecretPlan,
} from '../../lib/providerCatalog.js';

interface SourcesViewProps {
  sources: api.Source[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

/** The provider picker's choices: the live catalog, or the short fallback list until it loads
 *  (and for good if it can't). Shared with commands/sources.ts via lib/providerCatalog.ts. */
function useProviderChoices(): { choices: ProviderChoice[]; loading: boolean; offline: boolean } {
  const [state, setState] = useState<{ choices: ProviderChoice[]; loading: boolean; offline: boolean }>({
    choices: [...FALLBACK_PROVIDERS],
    loading: true,
    offline: false,
  });
  useEffect(() => {
    let alive = true;
    loadProviderChoices().then((r) => {
      if (alive) setState({ ...r, loading: false });
    });
    return () => { alive = false; };
  }, []);
  return state;
}

function providerItems(choices: ProviderChoice[]) {
  return choices.map((c) => ({ key: c.value || '(none)', label: c.name, value: c.value }));
}

/** How many picker rows to show at once; the catalog is far longer than a terminal. */
const PICKER_LIMIT = 12;

/** One-word secret state, matching `sources list`. */
function secretState(s: api.Source): string {
  if (s.verifiesWithoutSecret) return 'Not needed (key built in)';
  if (s.hasSigningSecret) return s.signingSecretLast4 ? `Set (${s.signingSecretLast4})` : 'Set';
  if (s.awaitingSigningSecret) return 'Awaiting (paste the secret the vendor issues)';
  return s.provider ? 'Not set' : 'None (no provider)';
}

/** Entry for a vendor-issued secret or public key. Blank is refused when the secret is required. */
function SecretEntry({ provider, info, plan, onSubmit }: {
  provider: string;
  info?: SecretInfo;
  plan: SecretPlan;
  onSubmit: (secret: string | undefined) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = info?.secretLabel ?? 'Signing secret';
  const name = info?.providerName ?? provider;
  const required = plan.action === 'prompt' || plan.action === 'prompt_public_key';
  const isKey = plan.action === 'prompt_public_key';

  const submit = () => {
    if (!value.trim()) {
      if (required) {
        setError(`${label} is required — ${name} issues it`);
        return;
      }
      onSubmit(undefined);
      return;
    }
    try {
      onSubmit(readSecretValue(value));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file');
    }
  };

  return (
    <Box flexDirection="column">
      <Text>{label} from {name}{info?.secretPlaceholder ? ` (${info.secretPlaceholder})` : ''}:</Text>
      {info?.secretInstruction && <Text dimColor>{info.secretInstruction}</Text>}
      {isKey && <Text dimColor>Paste the key on one line, or @path to a PEM file.</Text>}
      {!required && <Text dimColor>Leave blank to let Hookbase generate one where the provider allows it.</Text>}
      <Box>
        <Text>&gt; </Text>
        <TextInput value={value} onChange={(v) => { setValue(v); setError(null); }} onSubmit={submit} mask={isKey ? undefined : '*'} />
      </Box>
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

/** HTTP verbs the ingest endpoint can be restricted to. Mirrors VALID_INGEST_METHODS in
 * the API and INGEST_METHODS in commands/sources.ts. No selection = any method allowed. */
const INGEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

function MethodsSelector({ initial, onSave }: {
  initial: string[];
  onSave: (methods: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setCursor((prev) => Math.min(INGEST_METHODS.length - 1, prev + 1));
    }
    if (input === ' ') {
      const verb = INGEST_METHODS[cursor];
      setSelected((prev) => (prev.includes(verb) ? prev.filter((v) => v !== verb) : [...prev, verb]));
    }
    if (key.return) {
      onSave(selected);
    }
  });

  return (
    <Box flexDirection="column">
      {INGEST_METHODS.map((verb, index) => {
        const checked = selected.includes(verb);
        const isCursor = index === cursor;
        return (
          <Box key={verb}>
            <Text color={isCursor ? 'yellow' : undefined} bold={isCursor}>
              {isCursor ? '▶ ' : '  '}
            </Text>
            <Text color={checked ? 'green' : undefined}>
              [{checked ? 'x' : ' '}] {verb}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>
          {selected.length === 0 ? '(none checked = any method allowed)' : `${selected.length} selected`}
        </Text>
      </Box>
    </Box>
  );
}

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
                      {String(item.name || '').slice(0, 22)}{String(item.name || '').length > 22 ? '…' : ''}
                    </Text>
                  </Box>
                  <Box width={22}>
                    <Text dimColor>{String(item.slug || '').slice(0, 20)}{String(item.slug || '').length > 20 ? '…' : ''}</Text>
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
      } catch {
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
  const allowedMethods = source.allowedMethods ?? source.allowed_methods ?? [];

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
          <Text color="blue">{source.provider || 'none'}</Text>
        </Box>
        <Box>
          <Box width={16}><Text dimColor>Secret:</Text></Box>
          <Text color={source.awaitingSigningSecret || (source.provider && !source.hasSigningSecret && !source.verifiesWithoutSecret) ? 'yellow' : undefined}>
            {secretState(source)}
          </Text>
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
        <Box>
          <Box width={16}><Text dimColor>Methods:</Text></Box>
          {allowedMethods.length > 0 ? (
            <Text color="yellow">{allowedMethods.join(', ')}</Text>
          ) : (
            <Text dimColor>Any method</Text>
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
  const { choices, loading: choicesLoading } = useProviderChoices();
  // A provider switch that needs the vendor's secret in the same update (the API 400s otherwise).
  const [pendingProvider, setPendingProvider] = useState<{ provider: string; info?: SecretInfo; plan: SecretPlan } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Editable fields
  const isTransient = source?.transient_mode || source?.transientMode;
  const isActive = source?.is_active || source?.isActive;
  const allowedMethods = source?.allowedMethods ?? source?.allowed_methods ?? [];
  const fields = [
    { key: 'name', label: 'Name', value: source?.name || '', type: 'text' as const },
    { key: 'provider', label: 'Provider', value: source?.provider || NO_PROVIDER, type: 'select' as const },
    { key: 'signingSecret', label: 'Signing Secret', value: source ? secretState(source) : '', type: 'secret' as const },
    { key: 'description', label: 'Description', value: source?.description || '', type: 'text' as const },
    { key: 'isActive', label: 'Status', value: isActive ? 'Active' : 'Inactive', type: 'toggle' as const },
    { key: 'transientMode', label: 'Transient Mode', value: isTransient ? 'Enabled' : 'Disabled', type: 'toggle' as const },
    { key: 'methods', label: 'Methods', value: allowedMethods.join(', '), type: 'multiselect' as const },
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
        } catch {
          setMessage(`Failed to update ${field.label}`);
        }
        setSaving(false);
        setTimeout(() => { busy.current = false; setMessage(null); }, 1500);
      } else if (field.type === 'select' || field.type === 'multiselect') {
        // Enter picker mode — no free-text entry, so an invalid method can't be typed
        // (a provider outside the catalog goes through "Other", which the API validates)
        setNote(null);
        setEditingField(field.key);
      } else if (field.type === 'secret') {
        setEditValue('');
        setEditingField(field.key);
      } else {
        // Enter text editing mode
        setEditValue(field.value);
        setEditingField(field.key);
      }
    }
  });

  const saveProvider = async (provider: string, signingSecret: string | undefined, after?: string) => {
    busy.current = true;
    setSaving(true);
    try {
      const result = await api.updateSource(sourceId, {
        provider: provider || null,
        ...(signingSecret !== undefined ? { signingSecret } : {}),
      });
      if (result.error) {
        setMessage(`Error: ${result.error}`);
      } else {
        setMessage(signingSecret !== undefined ? 'Provider and secret updated' : 'Provider updated');
        if (after) setNote(after);
        onSaved();
      }
    } catch {
      setMessage('Failed to update Provider');
    }
    setEditingField(null);
    setPendingProvider(null);
    setSaving(false);
    setTimeout(() => { busy.current = false; setMessage(null); }, 1500);
  };

  /** Look up what the new provider needs: its secret is asked for first when the vendor issues it. */
  const chooseProvider = async (provider: string, load: () => Promise<SecretInfo | undefined>) => {
    busy.current = true;
    setSaving(true);
    const info = provider ? await load() : undefined;
    const plan = planSecret(provider, info);
    setSaving(false);
    busy.current = false;
    if (provider !== (source?.provider ?? '') && (plan.action === 'prompt' || plan.action === 'prompt_public_key')) {
      setPendingProvider({ provider, info, plan });
      setEditingField('providerSecret');
      return;
    }
    const after = plan.action === 'skip' && provider
      ? plan.reason
      : plan.action === 'generated' && provider
        ? 'The existing secret is kept. Use rotate-secret (CLI) to generate a new one for this provider.'
        : undefined;
    await saveProvider(provider, undefined, after);
  };

  const handleProviderSelect = async (item: { value: string }) => {
    if (item.value === OTHER_PROVIDER) {
      setEditValue('');
      setEditingField('providerOther');
      return;
    }
    const choice = choices.find((c) => c.value === item.value);
    await chooseProvider(item.value, async () => (choice ? getChoiceSecretInfo(choice) : undefined));
  };

  const handleOtherProviderSubmit = async () => {
    const typed = editValue.trim();
    if (!/^[a-z0-9-]+$/.test(typed)) {
      setMessage('Error: provider id is lowercase letters, digits and hyphens');
      return;
    }
    await chooseProvider(typed, () => lookupProviderSecretInfo(typed));
  };

  const handleSecretSubmit = async () => {
    const raw = editValue.trim();
    if (!raw) {
      // Blank cancels rather than clears — clearing a secret is a CLI step
      // ("hookbase inbound sources update <source> --signing-secret ''").
      setEditingField(null);
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const result = await api.updateSource(sourceId, { signingSecret: readSecretValue(raw) });
      if (result.error) {
        setMessage(`Error: ${result.error}`);
      } else {
        setMessage('Signing secret updated');
        onSaved();
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Failed to update signing secret'}`);
    }
    setEditingField(null);
    setSaving(false);
    setTimeout(() => { busy.current = false; setMessage(null); }, 1500);
  };

  const handleMethodsSave = async (methods: string[]) => {
    busy.current = true;
    setSaving(true);
    try {
      const result = await api.updateSource(sourceId, { allowedMethods: methods } as any);
      if (result.error) {
        setMessage(`Error: ${result.error}`);
      } else {
        setMessage('Methods updated');
        onSaved();
      }
    } catch {
      setMessage('Failed to update Methods');
    }
    setEditingField(null);
    setSaving(false);
    setTimeout(() => { busy.current = false; setMessage(null); }, 1500);
  };

  const handleTextSubmit = async () => {
    if (!editingField) return;
    busy.current = true;
    setSaving(true);
    // `methods` is a comma-separated verb list in the UI but an array on the API; parse it.
    // Everything else is a plain string field. Empty methods -> [] -> any method.
    const updateData: Record<string, unknown> = editingField === 'methods'
      ? { allowedMethods: editValue.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean) }
      : { [editingField]: editValue };
    try {
      const result = await api.updateSource(sourceId, updateData as any);
      if (result.error) {
        setMessage(`Error: ${result.error}`);
      } else {
        setMessage(`${editingField} updated`);
        onSaved();
      }
    } catch {
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

          if (field.key === 'provider' && editingField === 'providerOther') {
            return (
              <Box key={field.key}>
                <Box width={2}><Text color="yellow" bold>▶</Text></Box>
                <Box width={18}><Text dimColor>Provider id:</Text></Box>
                <TextInput value={editValue} onChange={setEditValue} onSubmit={handleOtherProviderSubmit} placeholder="e.g. grafana-hmac" />
                <Text dimColor> (Enter to save, Esc to cancel)</Text>
              </Box>
            );
          }

          if (field.key === 'provider' && editingField === 'providerSecret' && pendingProvider) {
            return (
              <Box key={field.key} flexDirection="column">
                <Box>
                  <Box width={2}><Text color="yellow" bold>▶</Text></Box>
                  <Box width={18}><Text dimColor>Provider:</Text></Box>
                  <Text>{pendingProvider.provider} (needs its secret in the same update; Esc to cancel)</Text>
                </Box>
                <Box marginLeft={20}>
                  <SecretEntry
                    provider={pendingProvider.provider}
                    info={pendingProvider.info}
                    plan={pendingProvider.plan}
                    onSubmit={(secret) => saveProvider(pendingProvider.provider, secret)}
                  />
                </Box>
              </Box>
            );
          }

          if (isEditing && field.type === 'secret') {
            return (
              <Box key={field.key} flexDirection="column">
                <Box>
                  <Box width={2}><Text color="yellow" bold>▶</Text></Box>
                  <Box width={18}><Text dimColor>{field.label}:</Text></Box>
                  <TextInput value={editValue} onChange={setEditValue} onSubmit={handleSecretSubmit} mask="*" />
                </Box>
                <Box marginLeft={20}>
                  <Text dimColor>New secret or public key (@path reads a file). Enter to save, blank or Esc cancels.</Text>
                </Box>
              </Box>
            );
          }

          if (isEditing && field.type === 'select') {
            const items = providerItems(choices);
            const currentIndex = Math.max(0, items.findIndex((p) => p.value === field.value));
            return (
              <Box key={field.key} flexDirection="column" marginY={0}>
                <Box>
                  <Box width={2}>
                    <Text color="yellow" bold>▶</Text>
                  </Box>
                  <Box width={18}>
                    <Text dimColor>{field.label}:</Text>
                  </Box>
                  <Text dimColor>(↑↓ select, Enter to save, Esc to cancel){choicesLoading ? ' loading catalog…' : ''}</Text>
                </Box>
                <Box marginLeft={20}>
                  <SelectInput
                    items={items}
                    initialIndex={currentIndex}
                    limit={PICKER_LIMIT}
                    onSelect={handleProviderSelect}
                  />
                </Box>
              </Box>
            );
          }

          if (isEditing && field.type === 'multiselect') {
            return (
              <Box key={field.key} flexDirection="column" marginY={0}>
                <Box>
                  <Box width={2}>
                    <Text color="yellow" bold>▶</Text>
                  </Box>
                  <Box width={18}>
                    <Text dimColor>{field.label}:</Text>
                  </Box>
                  <Text dimColor>(↑↓ move, Space toggle, Enter save, Esc cancel)</Text>
                </Box>
                <Box marginLeft={20}>
                  <MethodsSelector
                    initial={allowedMethods}
                    onSave={handleMethodsSave}
                  />
                </Box>
              </Box>
            );
          }

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
                  ) : field.key === 'methods' ? (
                    <Text color={isSelected ? 'yellow' : undefined}>{field.value || 'Any'}</Text>
                  ) : field.key === 'provider' ? (
                    <Text color={isSelected ? 'yellow' : undefined}>{field.value || 'None (no verification)'}</Text>
                  ) : (
                    <Text color={isSelected ? 'yellow' : undefined}>{field.value || '(empty)'}</Text>
                  )}
                  {isSelected && field.type === 'toggle' && (
                    <Text dimColor> ← Enter/Space to toggle</Text>
                  )}
                  {isSelected && (field.type === 'text' || field.type === 'select' || field.type === 'multiselect' || field.type === 'secret') && (
                    <Text dimColor> ← Enter to edit</Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })}

        {note && (
          <Box marginTop={1} paddingX={1}>
            <Text dimColor>{note}</Text>
          </Box>
        )}

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
  type Step = 'name' | 'slug' | 'provider' | 'other' | 'lookup' | 'secret' | 'transient' | 'creating' | 'done';
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [provider, setProvider] = useState('');
  const [otherProvider, setOtherProvider] = useState('');
  const [secretInfo, setSecretInfo] = useState<SecretInfo | undefined>(undefined);
  const [secretPlan, setSecretPlan] = useState<SecretPlan | null>(null);
  const [signingSecret, setSigningSecret] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [transient, setTransient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSource, setCreatedSource] = useState<api.Source | null>(null);
  const { choices, loading: choicesLoading, offline } = useProviderChoices();

  // A generated secret, verify token or "awaiting" note is shown once, so the done screen waits
  // for a key instead of returning to the list on a timer.
  const hasSomethingToShow = (s: api.Source | null) =>
    !!s && ((!!s.signingSecret && signingSecret === undefined) || !!s.verifyToken || !!s.awaitingSigningSecret);

  useInput((input, key) => {
    if (step === 'done' && hasSomethingToShow(createdSource) && (key.return || key.escape)) {
      onBack();
      return;
    }
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

  /** Find out what the provider needs, then ask for the secret or explain why there is none. */
  const resolveSecret = async (value: string, load: () => Promise<SecretInfo | undefined>) => {
    setProvider(value);
    setStep('lookup');
    const info = value ? await load() : undefined;
    const plan = planSecret(value, info);
    setSecretInfo(info);
    setSecretPlan(plan);
    if (plan.action === 'prompt' || plan.action === 'prompt_public_key' || plan.action === 'optional') {
      setStep('secret');
      return;
    }
    if (plan.action === 'skip' && value) setNote(plan.reason);
    if (plan.action === 'generated') {
      setNote(`Hookbase will generate the ${(info?.secretLabel ?? 'signing secret').toLowerCase()} and show it once after the source is created.`);
    }
    setStep('transient');
  };

  const handleProviderSelect = (item: { value: string }) => {
    if (item.value === OTHER_PROVIDER) {
      setStep('other');
      return;
    }
    const choice = choices.find((c) => c.value === item.value);
    void resolveSecret(item.value, async () => (choice ? getChoiceSecretInfo(choice) : undefined));
  };

  const handleOtherSubmit = () => {
    const typed = otherProvider.trim();
    if (!/^[a-z0-9-]+$/.test(typed)) {
      setError('Provider id is lowercase letters, digits and hyphens');
      return;
    }
    setError(null);
    void resolveSecret(typed, () => lookupProviderSecretInfo(typed));
  };

  const handleSecretSubmit = (secret: string | undefined) => {
    setSigningSecret(secret);
    setStep('transient');
  };

  const handleTransientSelect = async (item: { value: string }) => {
    const isTransient = item.value === 'yes';
    setTransient(isTransient);
    setStep('creating');

    try {
      const result = await api.createSource(name, slug, provider, {
        transientMode: isTransient,
        ...(signingSecret !== undefined ? { signingSecret } : {}),
      });
      if (result.error) {
        setError(result.error);
        setStep('transient');
      } else {
        const created = result.data?.source || null;
        setCreatedSource(created);
        setError(null);
        setStep('done');
        onCreated();
        if (!hasSomethingToShow(created)) {
          setTimeout(() => onBack(), 1500);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create source');
      setStep('transient');
    }
  };

  const items = providerItems(choices);
  const providerName = secretInfo?.providerName ?? (provider || 'none');

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
              <Text dimColor>Name: {name} | Slug: {slug}</Text>
            </Box>
            <Text>Select provider (for signature verification):{choicesLoading ? ' loading catalog…' : ''}</Text>
            {offline && <Text dimColor>Could not load the provider catalog — short list shown; pick "Other" for any provider id.</Text>}
            <SelectInput
              items={items}
              limit={PICKER_LIMIT}
              onSelect={handleProviderSelect}
            />
          </Box>
        )}

        {step === 'other' && (
          <Box>
            <Text>Provider id: </Text>
            <TextInput
              value={otherProvider}
              onChange={setOtherProvider}
              onSubmit={handleOtherSubmit}
              placeholder="e.g. grafana-hmac"
            />
          </Box>
        )}

        {step === 'lookup' && (
          <Text color="yellow">Looking up {provider}…</Text>
        )}

        {step === 'secret' && secretPlan && (
          <SecretEntry
            provider={provider}
            info={secretInfo}
            plan={secretPlan}
            onSubmit={handleSecretSubmit}
          />
        )}

        {step === 'transient' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name} | Slug: {slug} | Provider: {provider || 'none'}{signingSecret !== undefined ? ' | Secret: entered' : ''}</Text>
            </Box>
            {note && (
              <Box marginBottom={1}>
                <Text dimColor>{note}</Text>
              </Box>
            )}
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
            {createdSource.signingSecret && signingSecret === undefined && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="yellow">{secretInfo?.secretLabel ?? 'Signing secret'} — shown once, save it now:</Text>
                <Text bold>{createdSource.signingSecret}</Text>
                <Text dimColor>{secretInfo?.secretInstruction ?? `Configure ${providerName} to sign its webhooks with this secret.`}</Text>
              </Box>
            )}
            {createdSource.verifyToken && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="yellow">{secretInfo?.verifyToken?.label ?? 'Verify token'}:</Text>
                <Text bold>{createdSource.verifyToken}</Text>
                <Text dimColor>{secretInfo?.verifyToken?.instruction ?? `Enter it when you register the ingest URL with ${providerName}.`}</Text>
              </Box>
            )}
            {createdSource.awaitingSigningSecret && (
              <Box marginTop={1}>
                <Text color="yellow">{note ?? `${providerName} issues this source's secret — events are not verified until you set it.`}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>{hasSomethingToShow(createdSource) ? 'Press Enter to return to the list' : 'Returning to list...'}</Text>
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
