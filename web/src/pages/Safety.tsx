import { Alert, Accordion, Badge, Button, Group, Paper, Select, Stack, Table, Tabs, Text, TextInput, } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api, download, useApi } from '../api';
import { Card, DemoLabel, ErrorState, Loading, PageHeader, StatusBadge , RLink } from '../components/common';
import { SafetyReport } from '../components/SafetyReport';
import { BORDER, SURFACE } from '../theme';

interface Line { written_product: string; strength_as_written: string; dose_frequency: string }

function Workspace() {
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState<Line>({ written_product: '', strength_as_written: '', dose_frequency: '' });
  const [dq] = useDebouncedValue(draft.written_product, 200);
  const sugg = useApi<any>(dq.length >= 2 ? `/drugs?q=${encodeURIComponent(dq)}&size=6` : null);
  const [asOf, setAsOf] = useState(''); const [outage, setOutage] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const add = () => { if (!draft.written_product.trim()) return; setLines([...lines, draft]); setDraft({ written_product: '', strength_as_written: '', dose_frequency: '' }); setReport(null); };
  const run = async () => {
    setBusy(true); setError(null);
    try { const r = await api('/safety/run', { method: 'POST', body: { prescription: lines.map((l, i) => ({ line_no: i + 1, written_product: l.written_product, strength_as_written: l.strength_as_written || null, dose_frequency: l.dose_frequency || null })), as_of: asOf || undefined, simulate_outage: outage ?? undefined } }); setReport(r); notifications.show({ color: 'navy', title: 'Safety rail complete', message: `${r.summary.counts.HIT ?? 0} finding(s). Rule ${r.rule_version}` }); }
    catch (e) { setError(e as Error); setReport(null); } finally { setBusy(false); }
  };
  const examples = useApi<any>('/safety/demo');
  const loadExample = (id: string | null) => { const it = examples.data?.items.find((x: any) => x.rx_id === id); if (!it) return; setLines(it.lines.map((l: any) => ({ written_product: l.written_product, strength_as_written: l.strength_as_written ?? '', dose_frequency: l.dose_frequency ?? '' }))); setReport(null); };
  const exact = sugg.data?.items?.filter((x: any) => x.mapping_status === 'UNIQUE_BRAND').length;
  return (
    <Stack gap="md">
      <Card title="Draft prescription" right={<Text size="xs" c="dimmed">Brand-level products as the doctor would write them</Text>}>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput label="Product (brand as written)" placeholder="e.g. Dolo 650" value={draft.written_product} onChange={(e) => setDraft({ ...draft, written_product: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} w={240} />
          <TextInput label="Strength as written" placeholder="650 mg" value={draft.strength_as_written} onChange={(e) => setDraft({ ...draft, strength_as_written: e.currentTarget.value })} w={130} />
          <TextInput label="Dose frequency" placeholder="1-0-1 x 5d" value={draft.dose_frequency} onChange={(e) => setDraft({ ...draft, dose_frequency: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && add()} w={150} />
          <Select label="Or load a synthetic example" placeholder="RX01 to RX10" clearable data={(examples.data?.items ?? []).map((x: any) => ({ value: x.rx_id, label: `${x.rx_id}: ${x.lines.map((l: any) => l.written_product).join(' + ')}` }))} onChange={loadExample} w={300} />
          <Button leftSection={<IconPlus size={14} />} onClick={add} disabled={!draft.written_product.trim()}>Add line</Button>
        </Group>
        {sugg.data && dq.length >= 2 && (
          <Paper mt="sm" p="xs" bg="#f1eee6" style={{ borderColor: BORDER }}>
            <Text size="xs" c="dimmed" mb={4}>Drug-master matches for "{dq}" ({sugg.data.total}). Selecting one fills the written name and strength; collisions stay ambiguous.</Text>
            {sugg.data.items.length === 0 ? <Text size="xs">No match. The line will be unresolved and sent to review.</Text> : sugg.data.items.map((x: any) => (
              <Group key={x.product_id} gap="xs" wrap="nowrap"><Button size="compact-xs" variant="subtle" onClick={() => setDraft({ ...draft, written_product: x.brand_name, strength_as_written: x.ingredients.length === 1 ? `${x.ingredients[0].value} ${x.ingredients[0].unit}` : '' })}>{x.brand_name}</Button><Text size="xs" c="dimmed">{x.dose_form} / {x.strength_text}</Text>{x.mapping_status === 'BRAND_COLLISION' && <Badge size="xs" color="clay">name collision</Badge>}</Group>))}
            {exact === 0 && sugg.data.items.length > 0 && <Text size="xs" c="clay.8" mt={4}>Every match shares its name with other products; resolution will need review.</Text>}
          </Paper>)}
        {lines.length > 0 && <Table mt="md" fz="sm"><Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Product</Table.Th><Table.Th>Strength</Table.Th><Table.Th>Frequency</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>{lines.map((l, i) => <Table.Tr key={i}><Table.Td>{i + 1}</Table.Td><Table.Td>{l.written_product}</Table.Td><Table.Td>{l.strength_as_written || <Text span c="dimmed" size="xs">not written</Text>}</Table.Td><Table.Td>{l.dose_frequency || <Text span c="dimmed" size="xs">not written</Text>}</Table.Td><Table.Td><Button size="compact-xs" variant="subtle" color="rust" leftSection={<IconTrash size={12} />} onClick={() => { setLines(lines.filter((_, j) => j !== i)); setReport(null); }}>Remove</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table>}
        <Group mt="md" gap="sm" align="flex-end" wrap="wrap">
          <TextInput label="Evaluate as of (optional)" placeholder="today" value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} w={150} />
          <Select label="Simulate dependency outage" placeholder="none" clearable data={[{ value: 'regulatory', label: 'Regulatory register' }, { value: 'interactions', label: 'Interaction store' }, { value: 'all', label: 'Entire data store' }]} value={outage} onChange={setOutage} w={220} />
          <Button leftSection={<IconPlayerPlay size={14} />} onClick={run} loading={busy} disabled={!lines.length}>Run deterministic safety rail</Button>
          {report && <Button variant="default" leftSection={<IconDownload size={14} />} onClick={() => download(`safety-report-${report.executed_at.slice(0, 19).replace(/[:T]/g, '-')}.json`, report)}>Export JSON</Button>}
          {lines.length > 0 && <Button variant="subtle" color="gray" onClick={() => { setLines([]); setReport(null); }}>Clear draft</Button>}
        </Group>
        <Text size="xs" c="dimmed" mt="xs">The rail never finalizes or acts on a prescription and calculates no patient-specific dose. Only exposure totals from the written frequency and master strengths are shown.</Text>
      </Card>
      {error && <ErrorState error={error} />}
      {busy && <Loading rows={6} />}
      {report && !busy && <SafetyReport report={report} />}
    </Stack>
  );
}

function Demo() {
  const { data, error, loading, reload } = useApi<any>('/safety/demo');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Loading rows={8} />;
  const rerun = async () => { setBusy(true); try { await api('/safety/demo/run', { method: 'POST' }); notifications.show({ color: 'navy', title: 'Re-run complete', message: `Seeded prescriptions evaluated at ${data.as_of}` }); reload(); } catch (e) { notifications.show({ color: 'rust', title: 'Re-run failed', message: (e as Error).message }); } finally { setBusy(false); } };
  const all: Record<string, any> = Object.fromEntries(data.items.filter((i: any) => i.report).map((i: any) => [i.rx_id, i.report]));
  return (
    <Stack gap="md">
      <Group justify="space-between"><Group gap="xs"><DemoLabel /><Text size="xs" c="dimmed">{data.note}</Text></Group>
        <Group gap="xs"><Button variant="default" size="xs" loading={busy} onClick={rerun}>Re-run all ten</Button><Button size="xs" leftSection={<IconDownload size={14} />} onClick={() => download('seeded-safety-reports.json', all)}>Download all ten (JSON)</Button></Group></Group>
      <Accordion variant="separated" chevronPosition="left" transitionDuration={150}>
        {data.items.map((it: any) => (
          <Accordion.Item key={it.rx_id} value={it.rx_id} style={{ background: SURFACE, borderColor: BORDER }}>
            <Accordion.Control><Group justify="space-between" wrap="wrap" pr="sm"><Group gap="sm"><Text fw={600} size="sm">{it.rx_id}</Text><Text size="sm" c="dimmed">{it.lines.map((l: any) => l.written_product).join(' + ')}</Text></Group>
              <Group gap={4}>{it.report ? it.report.checks.map((c: any) => <StatusBadge key={c.check_type} status={c.status} size="xs" />) : <Badge color="gray">not run</Badge>}</Group></Group></Accordion.Control>
            <Accordion.Panel>
              {it.lines.some((l: any) => l.clinical_note) && <Alert color="gray" variant="light" mb="sm" title="Seed note">{it.lines.map((l: any) => l.clinical_note).filter(Boolean).join(' / ')}</Alert>}
              {it.report ? <><Group justify="flex-end" mb="xs"><Button size="compact-xs" variant="default" leftSection={<IconDownload size={12} />} onClick={() => download(`${it.rx_id}.json`, it.report)}>Export {it.rx_id}.json</Button></Group><SafetyReport report={it.report} /></> : <Text size="sm">No stored run. Use Re-run all ten.</Text>}
            </Accordion.Panel>
          </Accordion.Item>))}
      </Accordion>
    </Stack>
  );
}

export default function Safety() {
  const [tab, setTab] = useState<string | null>('workspace');
  useEffect(() => { document.title = 'Prescription Safety | BRAHMO AI'; }, []);
  return (
    <>
      <PageHeader title="Prescription safety workspace" subtitle="Deterministic, versioned checks over brand-level products: duplicate ingredients after FDC decomposition, regulatory status, severe interactions and cumulative exposure. No model participates." actions={<Badge color="navy" variant="outline" size="lg">No model in this path</Badge>} />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md"><Tabs.Tab value="workspace">Draft workspace</Tabs.Tab><Tabs.Tab value="demo">Ten seeded prescriptions</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="workspace"><Workspace /></Tabs.Panel>
        <Tabs.Panel value="demo"><Demo /></Tabs.Panel>
      </Tabs>
      <Text size="xs" c="dimmed" mt="lg">Need to see how an uncertain product was understood? <RLink to="/review">Open the ambiguity review queue</RLink>.</Text>
    </>
  );
}
