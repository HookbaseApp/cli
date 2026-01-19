import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import * as api from '../../lib/api.js';

interface CronViewProps {
  cronJobs: api.CronJob[];
  subView: string | null;
  onNavigate: (view: string | null) => void;
  onRefresh: () => void;
}

const COMMON_SCHEDULES = [
  { label: 'Every minute (* * * * *)', value: '* * * * *' },
  { label: 'Every 5 minutes (*/5 * * * *)', value: '*/5 * * * *' },
  { label: 'Every 15 minutes (*/15 * * * *)', value: '*/15 * * * *' },
  { label: 'Every hour (0 * * * *)', value: '0 * * * *' },
  { label: 'Every 6 hours (0 */6 * * *)', value: '0 */6 * * *' },
  { label: 'Daily at midnight (0 0 * * *)', value: '0 0 * * *' },
  { label: 'Weekly on Sunday (0 0 * * 0)', value: '0 0 * * 0' },
];

const HTTP_METHODS = [
  { label: 'POST', value: 'POST' },
  { label: 'GET', value: 'GET' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' },
  { label: 'DELETE', value: 'DELETE' },
];

// Parse date string from API (stored as UTC without Z suffix) to Date object
function parseUTCDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  // API stores dates as "YYYY-MM-DD HH:MM:SS" in UTC
  // Add Z suffix to parse as UTC, or handle ISO format
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  return new Date(normalized);
}

function formatLocalDateTime(dateStr: string | null | undefined): string {
  const date = parseUTCDate(dateStr);
  if (!date) return '-';
  return date.toLocaleString();
}

function formatLocalTime(dateStr: string | null | undefined): string {
  const date = parseUTCDate(dateStr);
  if (!date) return '-';
  return date.toLocaleTimeString();
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  const date = parseUTCDate(dateStr);
  if (!date) return '-';
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMs < 0) {
    const absDiffMinutes = Math.abs(diffMinutes);
    const absDiffHours = Math.abs(diffHours);
    if (absDiffMinutes < 1) return 'just now';
    if (absDiffMinutes < 60) return `${absDiffMinutes}m ago`;
    if (absDiffHours < 24) return `${absDiffHours}h ago`;
    return `${Math.abs(Math.floor(diffMs / (1000 * 60 * 60 * 24)))}d ago`;
  } else {
    if (diffMinutes < 1) return 'in <1m';
    if (diffMinutes < 60) return `in ${diffMinutes}m`;
    if (diffHours < 24) return `in ${diffHours}h`;
    return `in ${Math.floor(diffMs / (1000 * 60 * 60 * 24))}d`;
  }
}

function describeCronExpression(expr: string): string {
  if (expr === '* * * * *') return 'Every minute';
  if (expr === '0 * * * *') return 'Every hour';
  if (expr === '0 0 * * *') return 'Daily';
  if (expr === '0 0 * * 0') return 'Weekly';
  if (expr === '0 0 1 * *') return 'Monthly';
  if (expr.startsWith('*/')) return `Every ${expr.split(' ')[0].slice(2)}min`;
  return expr;
}

function CronList({ jobs, onSelect, onCreate }: {
  jobs: api.CronJob[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeJobs = jobs.filter(j => j.is_active);
  const inactiveJobs = jobs.filter(j => !j.is_active);

  const items = [
    { id: 'create', name: '+ Create New Cron Job', isAction: true },
    ...activeJobs,
    ...inactiveJobs,
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
        <Text bold>Cron Jobs</Text>
        <Text dimColor> - {activeJobs.length} active, {inactiveJobs.length} inactive | </Text>
        <Text dimColor>Enter select, Esc back</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        {items.length === 1 && (
          <Box marginY={1}>
            <Text dimColor>No cron jobs yet. Create one to get started!</Text>
          </Box>
        )}
        {items.map((item, index) => (
          <Box key={item.id} marginY={0}>
            <Text
              color={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
              inverse={index === selectedIndex}
            >
              {index === selectedIndex ? ' > ' : '   '}
            </Text>
            {'isAction' in item ? (
              <Text color="green" bold={index === selectedIndex}>{item.name}</Text>
            ) : (
              <Box>
                <Box width={28}>
                  <Text color={item.is_active ? undefined : 'gray'} bold={index === selectedIndex}>
                    {item.name.slice(0, 26)}
                  </Text>
                </Box>
                <Box width={16}>
                  <Text dimColor>{describeCronExpression(item.cron_expression)}</Text>
                </Box>
                <Box width={10}>
                  <Text color={item.is_active ? 'green' : 'gray'}>
                    {item.is_active ? 'active' : 'inactive'}
                  </Text>
                </Box>
                <Box width={14}>
                  <Text dimColor>Next: {formatRelativeTime(item.next_run_at)}</Text>
                </Box>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function CronDetail({ jobId, jobs, onBack, onRefresh }: {
  jobId: string;
  jobs: api.CronJob[];
  onBack: () => void;
  onRefresh: () => void;
}) {
  const job = jobs.find(j => j.id === jobId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [executions, setExecutions] = useState<api.CronExecution[]>([]);
  const [loadingExecs, setLoadingExecs] = useState(true);

  useEffect(() => {
    const fetchExecutions = async () => {
      if (!jobId) return;
      const result = await api.getCronExecutions(jobId, 5);
      if (result.data?.executions) {
        setExecutions(result.data.executions);
      }
      setLoadingExecs(false);
    };
    fetchExecutions();
  }, [jobId]);

  useInput(async (input, key) => {
    if (deleting || triggering) return;

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
    if (input === 't' && !confirmDelete) {
      setTriggering(true);
      setMessage(null);
      try {
        const result = await api.triggerCronJob(jobId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
        } else {
          setMessage('Job triggered successfully!');
          // Refresh executions
          const execResult = await api.getCronExecutions(jobId, 5);
          if (execResult.data?.executions) {
            setExecutions(execResult.data.executions);
          }
        }
      } catch (err) {
        setMessage('Failed to trigger job');
      }
      setTriggering(false);
    }
    if (input === 'e' && !confirmDelete && job) {
      // Toggle enable/disable
      try {
        await api.updateCronJob(jobId, { isActive: !job.is_active });
        onRefresh();
      } catch (err) {
        setMessage('Failed to update job');
      }
    }
    if (input === 'y' && confirmDelete) {
      setDeleting(true);
      try {
        const result = await api.deleteCronJob(jobId);
        if (result.error) {
          setMessage(`Error: ${result.error}`);
          setConfirmDelete(false);
        } else {
          setMessage('Cron job deleted');
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

  if (!job) {
    return (
      <Box flexDirection="column">
        <Text color="red">Cron job not found: {jobId}</Text>
        <Text dimColor>Press Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Cron Job Details</Text>
        <Text dimColor> - Esc: back | t: trigger | e: enable/disable | d: delete</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box>
          <Box width={15}><Text dimColor>ID:</Text></Box>
          <Text>{job.id}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Name:</Text></Box>
          <Text bold>{job.name}</Text>
        </Box>
        {job.description && (
          <Box>
            <Box width={15}><Text dimColor>Description:</Text></Box>
            <Text>{job.description}</Text>
          </Box>
        )}
        <Box>
          <Box width={15}><Text dimColor>Schedule:</Text></Box>
          <Text>{job.cron_expression}</Text>
          <Text dimColor> ({describeCronExpression(job.cron_expression)})</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Timezone:</Text></Box>
          <Text>{job.timezone}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Status:</Text></Box>
          <Text color={job.is_active ? 'green' : 'red'}>
            {job.is_active ? 'Active' : 'Inactive'}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Box width={15}><Text dimColor>URL:</Text></Box>
          <Text color="blue">{job.method} </Text>
          <Text>{job.url}</Text>
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Timeout:</Text></Box>
          <Text>{job.timeout_ms}ms</Text>
        </Box>
        {job.headers && (
          <Box>
            <Box width={15}><Text dimColor>Headers:</Text></Box>
            <Text dimColor>{job.headers}</Text>
          </Box>
        )}
        {job.payload && (
          <Box>
            <Box width={15}><Text dimColor>Payload:</Text></Box>
            <Text dimColor>{job.payload.slice(0, 50)}{job.payload.length > 50 ? '...' : ''}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Box width={15}><Text dimColor>Next run:</Text></Box>
          <Text color="cyan">{formatRelativeTime(job.next_run_at)}</Text>
          {job.next_run_at && <Text dimColor> ({formatLocalDateTime(job.next_run_at)})</Text>}
        </Box>
        <Box>
          <Box width={15}><Text dimColor>Last run:</Text></Box>
          <Text>{formatRelativeTime(job.last_run_at)}</Text>
        </Box>

        {/* Recent Executions */}
        <Box marginTop={1} flexDirection="column">
          <Text bold dimColor>Recent Executions:</Text>
          {loadingExecs ? (
            <Box>
              <Text color="green"><Spinner type="dots" /></Text>
              <Text> Loading...</Text>
            </Box>
          ) : executions.length === 0 ? (
            <Text dimColor>No executions yet</Text>
          ) : (
            executions.slice(0, 5).map(exec => (
              <Box key={exec.id}>
                <Text dimColor>{formatLocalTime(exec.started_at)} </Text>
                <Text color={exec.status === 'success' ? 'green' : exec.status === 'failed' ? 'red' : 'yellow'}>
                  {exec.status.padEnd(7)}
                </Text>
                <Text dimColor> HTTP {exec.response_status || '-'} </Text>
                <Text dimColor>{exec.latency_ms ? `${exec.latency_ms}ms` : ''}</Text>
              </Box>
            ))
          )}
        </Box>

        {confirmDelete && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Delete this cron job?</Text>
            <Text>Press 'y' to confirm, 'n' or Esc to cancel</Text>
          </Box>
        )}

        {(deleting || triggering) && (
          <Box marginTop={1}>
            <Text color="yellow">{deleting ? 'Deleting...' : 'Triggering...'}</Text>
          </Box>
        )}

        {message && (
          <Box marginTop={1}>
            <Text color={message.startsWith('Error') || message.startsWith('Failed') ? 'red' : 'green'}>
              {message}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function CreateCron({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'name' | 'schedule' | 'url' | 'method' | 'creating' | 'done'>('name');
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('POST');
  const [error, setError] = useState<string | null>(null);
  const [createdJob, setCreatedJob] = useState<api.CronJob | null>(null);

  useInput((input, key) => {
    if (key.escape && step !== 'creating') {
      onBack();
    }
  });

  const handleNameSubmit = () => {
    if (name.trim()) {
      setStep('schedule');
    }
  };

  const handleScheduleSelect = (item: { value: string }) => {
    setSchedule(item.value);
    setStep('url');
  };

  const handleUrlSubmit = () => {
    if (url.trim()) {
      try {
        new URL(url);
        setStep('method');
      } catch {
        setError('Invalid URL format');
      }
    }
  };

  const handleMethodSelect = async (item: { value: string }) => {
    setMethod(item.value);
    setStep('creating');

    try {
      const result = await api.createCronJob({
        name,
        cronExpression: schedule,
        url,
        method: item.value,
      });

      if (result.error) {
        setError(result.error);
        setStep('method');
      } else {
        setCreatedJob(result.data?.cronJob || null);
        setStep('done');
        setTimeout(() => {
          onCreated();
          onBack();
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cron job');
      setStep('method');
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Create New Cron Job</Text>
        <Text dimColor> - Press Esc to cancel</Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
        {step === 'name' && (
          <Box>
            <Text>Job name: </Text>
            <TextInput
              value={name}
              onChange={setName}
              onSubmit={handleNameSubmit}
              placeholder="My Cron Job"
            />
          </Box>
        )}

        {step === 'schedule' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Text>Select schedule:</Text>
            <SelectInput
              items={COMMON_SCHEDULES}
              onSelect={handleScheduleSelect}
            />
          </Box>
        )}

        {step === 'url' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Schedule: {schedule}</Text>
            </Box>
            <Box>
              <Text>URL to call: </Text>
              <TextInput
                value={url}
                onChange={(val) => { setUrl(val); setError(null); }}
                onSubmit={handleUrlSubmit}
                placeholder="https://api.example.com/webhook"
              />
            </Box>
            {error && (
              <Box marginTop={1}>
                <Text color="red">{error}</Text>
              </Box>
            )}
          </Box>
        )}

        {step === 'method' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Name: {name}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Schedule: {schedule}</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>URL: {url}</Text>
            </Box>
            <Text>Select HTTP method:</Text>
            <SelectInput
              items={HTTP_METHODS}
              onSelect={handleMethodSelect}
            />
          </Box>
        )}

        {step === 'creating' && (
          <Box>
            <Text color="green"><Spinner type="dots" /></Text>
            <Text> Creating cron job...</Text>
          </Box>
        )}

        {step === 'done' && createdJob && (
          <Box flexDirection="column">
            <Text color="green">Cron job created successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>ID: </Text>
              <Text>{createdJob.id}</Text>
            </Box>
            <Box>
              <Text dimColor>Next run: </Text>
              <Text color="cyan">{formatRelativeTime((createdJob as any).nextRunAt || (createdJob as any).next_run_at)}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Returning to list...</Text>
            </Box>
          </Box>
        )}

        {error && step !== 'url' && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function CronView({ cronJobs, subView, onNavigate, onRefresh }: CronViewProps) {
  if (subView === 'create') {
    return (
      <CreateCron
        onBack={() => onNavigate(null)}
        onCreated={onRefresh}
      />
    );
  }

  if (subView && subView.startsWith('detail:')) {
    const jobId = subView.replace('detail:', '');
    return (
      <CronDetail
        jobId={jobId}
        jobs={cronJobs}
        onBack={() => onNavigate(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <CronList
      jobs={cronJobs}
      onSelect={(id) => onNavigate(`detail:${id}`)}
      onCreate={() => onNavigate('create')}
    />
  );
}
