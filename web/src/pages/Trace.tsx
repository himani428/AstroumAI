import { Accordion, Alert, Badge, Button, Group, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPlayerPlay } from '@tabler/icons-react';
import { useState } from 'react';
import { api, download } from '../api';
import { Card, ErrorState, JsonView, Loading, PageHeader } from '../components/common';
import { SafetyReport } from '../components/SafetyReport';
import { AnswerView } from './Qa';
import { useEvidenceDrawer } from '../components/Evidence';

const SAMPLE_LINES = [
  { written_product: 'Dolo 650', strength_as_written: '650 mg', dose_frequency: '1-0-1 x 5d' },
  { written_product: 'Sinarest Tablet', strength_as_written: '', dose_frequency: '1-0-1 x 5d' },
  { written_product: 'Telma', strength_as_written: '', dose_frequency: '1-0-0' },
];

export default function Trace() {
  const [lines, setLines] = useState(SAMPLE_LINES);
  const [q, setQ] = useState('What is the first-line initial drug therapy for newly diagnosed adult hypertension?');
  const [asOf, setAsOf] = useState('');
  const [trace, setTrace] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<Error | null>(null);
  const ev = useEvidenceDrawer();
  const run = async () => {
    setBusy(true); setErr(null);
    try { setTrace(await api('/trace', { method: 'POST', body: { prescription: lines.filter((l) => l.written_product.trim()).map((l, i) => ({ line_no: i + 1, written_product: l.written_product, strength_as_written: l.strength_as_written || null, dose_frequency: l.dose_frequency || null })), question: q, as_of: asOf || undefined } })); notifications.show({ color: 'navy', title: 'Trace generated', message: 'All stages recorded' }); }
    catch (e) { setErr(e as Error); setTrace(null); } finally { setBusy(false); }
  };
  const loadSample = async () => { try { setTrace(await api('/trace/sample')); } catch (e) { setErr(e as Error); } };
  const s = trace?.stages;
  return (
    <>
      <PageHeader title="End-to-end trace" subtitle="One prescription and one clinical question in, one structured JSON trace out: normalization, deterministic safety rail, grounded answer, versions and retrieval metadata." />
      <Card mb="md">
        <Table fz="sm"><Table.Thead><Table.Tr><Table.Th>Product as written</Table.Th><Table.Th>Strength</Table.Th><Table.Th>Frequency</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{lines.map((l, i) => <Table.Tr key={i}>{(['written_product', 'strength_as_written', 'dose_frequency'] as const).map((k) => <Table.Td key={k}><TextInput size="xs" aria-label={`${k} line ${i + 1}`} value={l[k]} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: e.currentTarget.value } : x)))} /></Table.Td>)}</Table.Tr>)}</Table.Tbody></Table>
        <Group mt="xs"><Button size="compact-xs" variant="subtle" onClick={() => setLines([...lines, { written_product: '', strength_as_written: '', dose_frequency: '' }])}>Add line</Button></Group>
        <Textarea label="Clinical question" value={q} onChange={(e) => setQ(e.currentTarget.value)} autosize minRows={2} mt="sm" />
        <Group mt="sm" align="flex-end"><TextInput label="As of (optional)" placeholder="today" value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} w={150} /><Button leftSection={<IconPlayerPlay size={14} />} loading={busy} onClick={run}>Generate trace</Button><Button variant="default" onClick={loadSample}>Load checked-in sample trace</Button>{trace && <Button variant="default" leftSection={<IconDownload size={14} />} onClick={() => download(`trace-${trace.trace_id}.json`, trace)}>Download JSON</Button>}</Group>
      </Card>
      {err && <ErrorState error={err} />}
      {busy && <Loading rows={6} />}
      {trace && !busy && (
        <Stack gap="md">
          <Alert color="navy" variant="light" title={`Trace ${trace.trace_id}`}>Generated {trace.generated_at}, evaluated as of {trace.as_of}, {trace.execution.duration_ms} ms. Safety path model: <b>{trace.versions.models.safety_rail}</b>. Errors: {trace.execution.errors.length}.</Alert>
          <Accordion multiple defaultValue={['norm', 'safety', 'qa']} variant="separated" transitionDuration={150}>
            <Accordion.Item value="norm"><Accordion.Control>1. Input and normalization <Badge ml="sm" size="xs" color={s['1_normalization'].unresolved_mappings.length ? 'clay' : 'navy'}>{s['1_normalization'].unresolved_mappings.length} unresolved</Badge></Accordion.Control><Accordion.Panel><JsonView data={s['1_normalization']} /></Accordion.Panel></Accordion.Item>
            <Accordion.Item value="safety"><Accordion.Control>2. Deterministic safety rail <Badge ml="sm" size="xs" color="gray" variant="outline">no LLM</Badge></Accordion.Control><Accordion.Panel>{s['2_safety_rail'].report ? <Stack><SafetyReport report={s['2_safety_rail'].report} /><JsonView data={s['2_safety_rail']} /></Stack> : <JsonView data={s['2_safety_rail']} />}</Accordion.Panel></Accordion.Item>
            <Accordion.Item value="qa"><Accordion.Control>3. Grounded answer <Badge ml="sm" size="xs" color={s['3_grounded_answer'].outcome === 'ABSTAINED' ? 'clay' : 'navy'}>{s['3_grounded_answer'].outcome}</Badge></Accordion.Control><Accordion.Panel>{s['3_grounded_answer'].blocks ? <AnswerView a={s['3_grounded_answer']} onOpen={ev.open} /> : <JsonView data={s['3_grounded_answer']} />}</Accordion.Panel></Accordion.Item>
            <Accordion.Item value="conf"><Accordion.Control>Conflicting evidence ({trace.conflicting_evidence.length})</Accordion.Control><Accordion.Panel><JsonView data={trace.conflicting_evidence} /></Accordion.Panel></Accordion.Item>
            <Accordion.Item value="ver"><Accordion.Control>Dataset, rule, prompt and model versions</Accordion.Control><Accordion.Panel><JsonView data={trace.versions} /></Accordion.Panel></Accordion.Item>
            <Accordion.Item value="ret"><Accordion.Control>Retrieval metadata</Accordion.Control><Accordion.Panel><JsonView data={trace.retrieval_metadata} /></Accordion.Panel></Accordion.Item>
            <Accordion.Item value="exec"><Accordion.Control>Execution metadata and errors</Accordion.Control><Accordion.Panel><JsonView data={trace.execution} /></Accordion.Panel></Accordion.Item>
            <Accordion.Item value="raw"><Accordion.Control>Full trace JSON</Accordion.Control><Accordion.Panel><JsonView data={trace} maxH={600} /></Accordion.Panel></Accordion.Item>
          </Accordion>
        </Stack>)}
      {ev.drawer}
      <Text size="xs" c="dimmed" mt="md">Unresolved lines (for example the ambiguous brand name) are recorded in the trace and queued for review; they are never silently dropped or guessed.</Text>
    </>
  );
}
