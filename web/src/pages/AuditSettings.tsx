import { Alert, Badge, Group, Pagination, Select, SimpleGrid, Table, Tabs, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useApi } from '../api';
import { ApiKeyCard } from '../components/ApiKeyCard';
import { Card, ErrorState, Expand, JsonView, KV, Loading, PageHeader } from '../components/common';

function Audit() {
  const [q, setQ] = useState(''); const [action, setAction] = useState<string | null>(null); const [page, setPage] = useState(1);
  const p = new URLSearchParams({ page: String(page), size: '25' }); if (q) p.set('q', q); if (action) p.set('action', action);
  const { data, error, reload } = useApi<any>(`/audit?${p}`);
  return (
    <>
      <Group mb="md" align="flex-end"><TextInput label="Search" placeholder="actor, entity, detail" value={q} onChange={(e) => { setQ(e.currentTarget.value); setPage(1); }} w={260} /><Select label="Action" clearable searchable data={(data?.actions ?? []).map((a: any) => a.action)} value={action} onChange={(v) => { setAction(v); setPage(1); }} w={240} /></Group>
      {error && <ErrorState error={error} onRetry={reload} />}{!data && !error && <Loading />}
      {data && <Card pad="xs"><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>When (UTC)</Table.Th><Table.Th>Actor</Table.Th><Table.Th>Action</Table.Th><Table.Th>Entity</Table.Th><Table.Th>Detail</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{data.items.map((a: any) => <Table.Tr key={a.id}><Table.Td>{a.at.slice(0, 19).replace('T', ' ')}</Table.Td><Table.Td>{a.actor}</Table.Td><Table.Td><Badge size="xs" color="navy">{a.action}</Badge></Table.Td><Table.Td>{a.entity} {a.entity_id}</Table.Td><Table.Td><Expand label="View"><JsonView data={a.detail} maxH={200} /></Expand></Table.Td></Table.Tr>)}</Table.Tbody></Table>
        <Group justify="space-between" p="sm"><Text size="xs" c="dimmed">{data.total} entries</Text><Pagination total={Math.max(1, Math.ceil(data.total / data.size))} value={page} onChange={setPage} size="sm" /></Group></Card>}
    </>
  );
}

function Settings() {
  const { data, error, reload } = useApi<any>('/settings');
  const health = useApi<any>('/health');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading rows={8} />;
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      <Card title="System status">{health.data ? health.data.degraded.map((d: any) => <Alert key={d.component} p="xs" mb={6} variant="light" color={d.severity === 'ERROR' ? 'rust' : d.severity === 'WARN' ? 'clay' : 'gray'}><Text size="xs"><b>{d.component}</b> ({d.severity}): {d.message}</Text></Alert>) : <Loading rows={3} />}</Card>
      <Card title="Versions"><KV rows={Object.entries(data.versions).map(([k, v]) => [k, String(v)])} /></Card>
      <Card title="Dataset freshness policy"><Text size="xs" c="dimmed" mb="xs">{data.freshness_policy_note}</Text><Table fz="xs"><Table.Tbody>{Object.entries(data.datasets).map(([k, v]: any) => <Table.Tr key={k}><Table.Td>{k}</Table.Td><Table.Td>{v.file}</Table.Td><Table.Td>{v.maxAgeDays} days</Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
      <Card title="Safety rail configuration"><KV rows={[['Countable dose forms', data.safety.countable_dose_forms.join(', ')], ['Unit-suspect ingredients', data.safety.unit_suspect_ingredients.join(', ')], ['Interaction coverage scope', data.safety.interaction_coverage_scope], ['Demo evaluation date', data.demo.asOf]]} /><Expand label="Reference ceilings (cited from the corpus)"><JsonView data={data.safety.reference_ceilings} maxH={200} /></Expand></Card>
      <Card title="Retrieval and LLM"><KV rows={[['topK', data.retrieval.topK], ['Lexical / semantic weights', `${data.retrieval.weights.lexical} / ${data.retrieval.weights.semantic}`], ['Doc prior weight', data.retrieval.docPriorWeight], ['LLM composer', data.llm.enabled ? `enabled (${data.llm.model})` : 'disabled (default)'], ['LLM scope', data.llm.scope], ['Database', data.db_path], ['Node', data.node]]} /></Card>
      <Card title="Prompt library"><Table fz="xs"><Table.Tbody>{data.prompts.map((p: any) => <Table.Tr key={p.file}><Table.Td>{p.file}</Table.Td><Table.Td>{p.id} v{p.version}</Table.Td><Table.Td>{p.status}</Table.Td><Table.Td>{p.sha256.slice(0, 10)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
    </SimpleGrid>
  );
}

export default function AuditSettings() {
  return (
    <>
      <PageHeader title="Audit log and system settings" subtitle="Searchable record of ingestion runs, reviews and verifications, with the configuration the system is currently running." />
      <Tabs defaultValue="audit" keepMounted={false}><Tabs.List mb="md"><Tabs.Tab value="audit">Audit log</Tabs.Tab><Tabs.Tab value="settings">Settings and status</Tabs.Tab><Tabs.Tab value="apikey">Anthropic API key</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="audit"><Audit /></Tabs.Panel><Tabs.Panel value="settings"><Settings /></Tabs.Panel><Tabs.Panel value="apikey"><ApiKeyCard /></Tabs.Panel></Tabs>
    </>
  );
}
