import React, { useState } from 'react';
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
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
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
        <Text dimColor> - {sources.length} total | ↑↓ navigate, Enter select, Esc back</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        {items.map((item, index) => (
          <Box key={item.id}>
            <Text
              color={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
              inverse={index === selectedIndex}
            >
              {index === selectedIndex ? '▶ ' : '  '}
              {'isAction' in item ? (
                <Text color="green">{item.name}</Text>
              ) : (
                <>
                  <Text>{item.name}</Text>
                  <Text dimColor> ({item.slug}) </Text>
                  <Text color="blue">{item.provider || 'generic'}</Text>
                </>
              )}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function SourceDetail({ sourceId, sources, onBack, onRefresh }: {
  sourceId: string;
  sources: api.Source[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const source = sources.find(s => s.id === sourceId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useInput(async (input, key) => {
    if (deleting) return;

    if (key.escape || input === 'b') {
      if (confirmDelete) {
        setConfirmDelete(false);
      } else {
        onBack();
      }
    }
    if (input === 'd' && !confirmDelete) {
      setConfirmDelete(true);
    }
    if (input === 'y' && confirmDelete) {
      setDeleting(true);
      try {
        const result = await api.deleteSource(sourceId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
        } else {
          setMessage('Source deleted');
          setTimeout(() => {
            onRefresh();
            onBack();
          }, 1000);
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

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Source Details</Text>
        <Text dimColor> - Esc: back | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={15}><Text dimColor>ID:</Text></Box>
          <Text>{source.id}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Name:</Text></Box>
          <Text bold>{source.name}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Slug:</Text></Box>
          <Text>{source.slug}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Provider:</Text></Box>
          <Text color="blue">{source.provider || 'generic'}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Status:</Text></Box>
          <Text color={(source.is_active || source.isActive) ? 'green' : 'red'}>
            {(source.is_active || source.isActive) ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Events:</Text></Box>
          <Text>{source.event_count ?? source.eventCount ?? 0}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Routes:</Text></Box>
          <Text>{source.route_count ?? source.routeCount ?? 0}</Text>
        </Box>
        <Box marginTop={1}>
          <Box width={15}><Text dimColor>Ingest URL:</Text></Box>
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

function CreateSource({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'slug' | 'provider' | 'confirm' | 'creating' | 'done'>('name');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [provider, setProvider] = useState('');
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

  const handleProviderSelect = async (item: { value: string }) => {
    setProvider(item.value);
    setStep('creating');

    try {
      const result = await api.createSource(name, slug, item.value);
      if (result.error) {
        setError(result.error);
        setStep('confirm');
      } else {
        setCreatedSource(result.data?.source || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 2000);
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

  if (subView && subView.startsWith('detail:')) {
    const sourceId = subView.replace('detail:', '');
    return (
      <SourceDetail
        sourceId={sourceId}
        sources={sources}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
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
