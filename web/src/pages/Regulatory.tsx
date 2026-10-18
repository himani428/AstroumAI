import { Alert, Badge, Button, Group, Select, SimpleGrid, Table, Tabs, Text, TextInput, Timeline } from '@mantine/core';
import { useState } from 'react';
import { api, useApi } from '../api';
import { Card, Empty, ErrorState, Expand, Loading, PageHeader } from '../components/common';

const sc: Record<string, string> = { PROHIBITED: 'rust', WITHDRAWN: 'rust', RESTRICTED: 'clay', STAYED: 'clay', SOURCE_CONFLICT: 'grape', NO_EVENT_IN_FORCE: 'gray' };

function Simulate() {
  const [f, setF] = useState({ notification_id: 'SIMULATED-001', effective_date: '2026-10-01', action: 'PROHIBITED', target_type: 'FDC', target_description: 'Azithromycin + Paracetamol (all strengths)' });
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setErr(null); try { setRes(await api('/regulatory/simulate', { method: 'POST', body: f })); } catch (e) { setErr((e as Error).message); setRes(null); } finally { setBusy(false); } };
  return (
    <Card title="Source-change simulation" right={<Badge color="gray" variant="outline">Not persisted</Badge>}>
      <Text size="sm" c="dimmed" mb="sm">Add a hypothetical gazette event in memory and see which of the ten seeded prescriptions change. Nothing is written to the register.</Text>
      <Group gap="sm" align="flex-end" mb="sm" wrap="wrap">
        <TextInput label="Notification" value={f.notification_id} onChange={(e) => setF({ ...f, notification_id: e.currentTarget.value })} w={170} />
        <TextInput label="Effective date" value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.currentTarget.value })} w={130} />
        <Select label="Action" data={['PROHIBITED', 'RESTRICTED', 'WITHDRAWN', 'STAY_GRANTED']} value={f.action} onChange={(v) => setF({ ...f, action: v ?? 'PROHIBITED' })} w={150} />
        <Select label="Target type" data={['FDC', 'INGREDIENT', 'PRODUCT']} value={f.target_type} onChange={(v) => setF({ ...f, target_type: v ?? 'FDC' })} w={120} />
        <TextInput label="Target (A + B (qualifier))" value={f.target_description} onChange={(e) => setF({ ...f, target_description: e.currentTarget.value })} w={320} />
        <Button onClick={run} loading={busy}>Run simulation</Button>
      </Group>
      {err && <Alert color="rust" mb="sm">{err}</Alert>}
      {res && (res.changes.length === 0 ? <Alert color="navy" variant="light">No seeded prescription changes status. {res.prescriptions_evaluated} evaluated at {res.as_of}.</Alert> :
        <Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Rx</Table.Th><Table.Th>Check</Table.Th><Table.Th>Before</Table.Th><Table.Th>After</Table.Th><Table.Th>Why</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{res.changes.map((c: any, i: number) => <Table.Tr key={i}><Table.Td>{c.rx_id}</Table.Td><Table.Td>{c.check_type}</Table.Td><Table.Td>{c.before}</Table.Td><Table.Td><b>{c.after}</b></Table.Td><Table.Td>{c.explanation}</Table.Td></Table.Tr>)}</Table.Tbody></Table>)}
    </Card>
  );
}

export default function Regulatory() {
  const [asOf, setAsOf] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/regulatory/targets${asOf ? `?as_of=${asOf}` : ''}`);
  const ev = useApi<any>('/regulatory/events');
  return (
    <>
      <PageHeader title="Regulatory register" subtitle="Status is derived from effective-dated events and supersession links. There is no stored banned flag." actions={<TextInput label="Evaluate as of (YYYY-MM-DD)" placeholder="today" value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} w={190} error={asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? 'Use YYYY-MM-DD' : undefined} />} />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={6} />}
      {data && <>
        <Group mb="md" gap="xs">{Object.entries(data.state_counts).map(([k, v]: any) => <Badge key={k} color={sc[k]} variant="filled">{k} {v}</Badge>)}
          {data.freshness && <Badge color={data.freshness.expired ? 'orange' : 'navy'} variant="light">{data.freshness.expired ? 'STALE' : 'FRESH'}: {data.freshness.ageDays}d old, limit {data.freshness.max_age_days}d ({data.freshness.basis === 'LOAD_TIME_ONLY' ? 'load time only' : 'declared date'})</Badge>}</Group>
        <Alert color="gray" variant="light" mb="md">{data.notes.join(' ')}</Alert>
        <Tabs defaultValue="targets">
          <Tabs.List mb="md"><Tabs.Tab value="targets">Derived status by target</Tabs.Tab><Tabs.Tab value="events">Event log</Tabs.Tab><Tabs.Tab value="sim">Simulation</Tabs.Tab></Tabs.List>
          <Tabs.Panel value="targets">
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
              {data.targets.map((t: any) => (
                <Card key={t.target_key} title={t.target_description} right={<Badge color={sc[t.state]} variant="filled">{t.state}</Badge>}>
                  {t.citing_event ? <Text size="xs" mb="xs">Cited event: <b>{t.citing_event.notification_id}</b> ({t.citing_event.event_id}), {t.citing_event.action}, effective {t.citing_event.effective_date}</Text> : <Text size="xs" c="dimmed" mb="xs">No event in force at {data.as_of}.</Text>}
                  <Timeline active={t.timeline.length} bulletSize={16} lineWidth={2} color="navy">
                    {t.timeline.map((e: any) => <Timeline.Item key={e.event_id} color={e.in_force ? (e.superseded_by ? 'gray' : 'navy') : 'gray'} title={<Text size="xs" fw={600}>{e.action} <Text span c="dimmed">{e.event_id}</Text></Text>}>
                      <Text size="xs" c="dimmed">{e.notification_id}. Published {e.date_published}, effective {e.effective_date}{e.supersedes_event_id ? `, supersedes ${e.supersedes_event_id}` : ''}</Text>
                      <Text size="xs">{e.in_force ? (e.superseded_by ? `Superseded by ${e.superseded_by}` : 'In force') : 'Not yet effective at this date'}</Text>{e.note && <Text size="xs" c="dimmed">{e.note}</Text>}</Timeline.Item>)}
                  </Timeline>
                  {t.target.paediatric && <Badge size="xs" color="clay" mt="xs">paediatric scope</Badge>} {t.target.ratio_specific && <Badge size="xs" color="clay" mt="xs">ratio not stated in source</Badge>} {t.target.descriptive && <Badge size="xs" color="clay" mt="xs">descriptive target, keyword match only</Badge>}
                  {t.anomalies.length > 0 && <Alert color="clay" mt="xs" p="xs" title="Register anomalies">{t.anomalies.map((a: string) => <Text key={a} size="xs">{a}</Text>)}</Alert>}
                  {t.conflicts.length > 0 && <Alert color="grape" mt="xs" p="xs" title="Source conflict">{t.conflicts.map((a: string) => <Text key={a} size="xs">{a}</Text>)}</Alert>}
                </Card>))}
            </SimpleGrid>
          </Tabs.Panel>
          <Tabs.Panel value="events">
            <Card pad="xs">{!ev.data ? <Loading /> : ev.data.items.length === 0 ? <Empty title="No events loaded" /> : <Table.ScrollContainer minWidth={900}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Event</Table.Th><Table.Th>Notification</Table.Th><Table.Th>Published</Table.Th><Table.Th>Effective</Table.Th><Table.Th>Action</Table.Th><Table.Th>Target</Table.Th><Table.Th>Supersedes</Table.Th><Table.Th>Source row</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{ev.data.items.map((e: any) => <Table.Tr key={e.event_id}><Table.Td>{e.event_id}</Table.Td><Table.Td>{e.notification_id}</Table.Td><Table.Td>{e.date_published}</Table.Td><Table.Td>{e.effective_date}</Table.Td><Table.Td>{e.action}</Table.Td><Table.Td>{e.target_description}<Expand label="Note"><Text size="xs">{e.note || 'none'}</Text></Expand></Table.Td><Table.Td>{e.supersedes_event_id ?? '-'}</Table.Td><Table.Td>{e.source_row ? `row ${e.source_row.row_number}` : ''}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}</Card>
          </Tabs.Panel>
          <Tabs.Panel value="sim"><Simulate /></Tabs.Panel>
        </Tabs>
      </>}
    </>
  );
}
