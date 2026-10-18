import { Alert, Badge, Button, Group, List, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { api, useApi } from '../api';
import { Card, ErrorState, Loading } from './common';

/** Lets the user paste an Anthropic API key. It is stored on the server (encrypted) and never shown again, only a masked tail. */
export function ApiKeyCard() {
  const { data, error, reload } = useApi<any>('/settings/llm');
  const [key, setKey] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number; message: string } | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading rows={4} />;
  const modelValue = model ?? data.model;

  const save = async () => {
    setBusy('save'); setTestResult(null);
    try {
      await api('/settings/llm', { method: 'PUT', body: { api_key: key.trim() || undefined, model: modelValue !== data.model || !key.trim() ? modelValue : undefined } });
      setKey(''); setModel(null); reload();
      notifications.show({ color: 'navy', title: 'Saved', message: key.trim() ? 'API key stored on this machine (encrypted).' : 'Model saved.' });
    } catch (e) { notifications.show({ color: 'rust', title: 'Could not save', message: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setTestResult(null);
    try { setTestResult(await api('/settings/llm/test', { method: 'POST', body: { api_key: key.trim() || undefined, model: modelValue } })); }
    catch (e) { setTestResult({ ok: false, status: 0, message: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy('remove');
    try { await api('/settings/llm', { method: 'DELETE' }); setTestResult(null); reload(); notifications.show({ color: 'navy', title: 'Removed', message: 'The saved key was deleted. Answers are verbatim again.' }); }
    catch (e) { notifications.show({ color: 'rust', title: 'Could not remove', message: (e as Error).message }); }
    finally { setBusy(null); }
  };

  return (
    <Stack gap="md" maw={760}>
      <Card title="Anthropic API key (optional)" right={data.configured ? <Badge color="navy" variant="light">Key saved ({data.source === 'env' ? 'from environment' : 'in app'})</Badge> : <Badge color="gray" variant="outline">No key</Badge>}>
        <Text size="sm" mb="sm">With a key, Module B can rephrase the retrieved evidence into a short answer. The wording is checked against the retrieved text, and any ungrounded number or missing citation makes the app fall back to the verbatim answer. Without a key everything still works.</Text>
        {data.configured && <Text size="sm" mb="sm">Current key: <b>{data.masked}</b>{data.updated_at ? ` (saved ${data.updated_at.slice(0, 19).replace('T', ' ')} UTC)` : ''}. The full key is never shown again.</Text>}
        <PasswordInput label={data.configured ? 'Replace key' : 'API key'} placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.currentTarget.value)} autoComplete="off" description="Paste a key from console.anthropic.com. It is sent only to api.anthropic.com." mb="sm" />
        <TextInput label="Model" value={modelValue} onChange={(e) => setModel(e.currentTarget.value)} description={`Default: ${data.default_model}`} mb="md" />
        <Group gap="xs">
          <Button onClick={save} loading={busy === 'save'} disabled={!key.trim() && modelValue === data.model}>Save</Button>
          <Button variant="default" onClick={test} loading={busy === 'test'} disabled={!key.trim() && !data.configured}>Test connection</Button>
          {data.configured && data.source === 'saved' && <Button variant="subtle" color="rust" onClick={remove} loading={busy === 'remove'}>Remove saved key</Button>}
        </Group>
        {testResult && <Alert mt="md" color={testResult.ok ? 'navy' : 'rust'} variant="light" title={testResult.ok ? 'Connection works' : `Test failed${testResult.status ? ` (HTTP ${testResult.status})` : ''}`}>{testResult.message}</Alert>}
      </Card>
      <Card title="What this does and does not do">
        <List size="sm" spacing={4}>
          <List.Item>Stored in the local database on the machine running this app, encrypted with a random key kept in a separate file in the data folder. It is not written to <code>.env</code> or to any log.</List.Item>
          <List.Item>The browser can read only the masked tail. The key is not included in exports, traces or reports.</List.Item>
          <List.Item>Used for Module B answer wording only. The safety rail never imports the key or any model, and a test enforces that.</List.Item>
          <List.Item>Encryption here protects against copying the database file on its own. Anyone with access to the whole data folder or to this running app can use the key, so use a key with a spending limit.</List.Item>
          <List.Item>Questions and the retrieved excerpts are sent to Anthropic when a key is saved. Do not enter patient-identifiable text.</List.Item>
        </List>
      </Card>
    </Stack>
  );
}
