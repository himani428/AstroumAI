import { Alert, Badge, Button, Drawer, Group, List, Progress, SimpleGrid, Stack, Table, Tabs, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../api';
import { Card, ErrorState, Expand, JsonView, KV, Loading, PageHeader, Stat } from '../components/common';

function Ingestion() {
  const batches = useApi<any>('/ingestion/batches');
  const [job, setJob] = useState<any>(null); const [report, setReport] = useState<any>(null); const [open, setOpen] = useState<number | null>(null);
  const timer = useRef<any>(null);
  const detail = useApi<any>(open ? `/ingestion/batches/${open}` : null);
  useEffect(() => () => clearInterval(timer.current), []);
  const start = async (dry: boolean, force = false) => {
    setReport(null);
    try {
      const { job_id } = await api('/ingestion/run', { method: 'POST', body: { dry_run: dry, force, include_corpus: !dry && force } });
      setJob({ id: job_id, status: 'RUNNING', progress: [] });
      timer.current = setInterval(async () => {
        const j = await api(`/jobs/${job_id}`); setJob(j);
        if (j.status !== 'RUNNING') { clearInterval(timer.current); if (j.status === 'COMPLETED') { setReport(j.result); batches.reload(); notifications.show({ color: 'navy', title: dry ? 'Dry run finished (nothing written)' : 'Ingestion finished', message: `${j.result.datasets.length} datasets` }); } else notifications.show({ color: 'rust', title: 'Ingestion failed', message: j.error }); }
      }, 400);
    } catch (e) { notifications.show({ color: 'rust', title: 'Could not start', message: (e as Error).message }); }
  };
  const done = job?.progress?.filter((p: any) => p.phase === 'done').length ?? 0;
  return (
    <Stack gap="md">
      <Card title="Run ingestion" right={<Group gap="xs"><Button size="xs" variant="default" onClick={() => start(true)} disabled={job?.status === 'RUNNING'}>Dry run (validate only)</Button><Button size="xs" onClick={() => start(false)} disabled={job?.status === 'RUNNING'}>Ingest changed files</Button><Button size="xs" variant="light" color="clay" onClick={() => start(false, true)} disabled={job?.status === 'RUNNING'}>Force full reload</Button></Group>}>
        <Text size="sm" c="dimmed">Files are read from <code>input/data</code>. Unchanged files (same SHA-256) are skipped, so repeated runs are idempotent. A dry run executes everything inside a transaction that is rolled back.</Text>
        {job && <><Progress value={(done / 7) * 100} mt="sm" animated={job.status === 'RUNNING'} color="navy.7" /><Text size="xs" c="dimmed" mt={4}>{job.status}: {done}/7 datasets{job.progress.length ? `, last: ${job.progress[job.progress.length - 1].dataset}` : ''}{job.error ? `. ${job.error}` : ''}</Text></>}
      </Card>
      {report && <Card title={report.dry_run ? 'Dry-run result (not persisted)' : 'Run result'}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Dataset</Table.Th><Table.Th>Status</Table.Th><Table.Th>Total</Table.Th><Table.Th>Imported</Table.Th><Table.Th>Rejected</Table.Th><Table.Th>Duplicate</Table.Th><Table.Th>Unresolved</Table.Th><Table.Th>Queue +</Table.Th><Table.Th>Warnings</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{report.datasets.map((d: any) => <Table.Tr key={d.dataset}><Table.Td>{d.dataset}</Table.Td><Table.Td>{d.status}</Table.Td><Table.Td>{d.rows_total}</Table.Td><Table.Td>{d.imported}</Table.Td><Table.Td>{d.rejected}</Table.Td><Table.Td>{d.duplicate}</Table.Td><Table.Td>{d.unresolved}</Table.Td><Table.Td>{d.queue_items_created}</Table.Td><Table.Td>{d.warnings.length ? <Expand label={`${d.warnings.length}`}><List size="xs">{d.warnings.map((w: string, i: number) => <List.Item key={i}>{w}</List.Item>)}</List></Expand> : '-'}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>}
      <Card title="Ingestion batches" pad="xs">{batches.error ? <ErrorState error={batches.error} /> : !batches.data ? <Loading /> :
        <Table.ScrollContainer minWidth={800}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Dataset</Table.Th><Table.Th>File and SHA-256</Table.Th><Table.Th>Mode</Table.Th><Table.Th>Status</Table.Th><Table.Th>Rows</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>{batches.data.items.map((b: any) => <Table.Tr key={b.id}><Table.Td>{b.id}</Table.Td><Table.Td>{b.dataset}</Table.Td><Table.Td>{b.source_file}<Text size="xs" c="dimmed">{b.source_sha256.slice(0, 16)}</Text></Table.Td><Table.Td>{b.mode}</Table.Td><Table.Td>{b.status}</Table.Td><Table.Td>{b.rows_imported}/{b.rows_total} ok, {b.rows_rejected} rej, {b.rows_duplicate} dup</Table.Td><Table.Td><Button size="compact-xs" variant="subtle" onClick={() => setOpen(b.id)}>Details</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}</Card>
      <Drawer opened={open != null} onClose={() => setOpen(null)} position="right" size="lg" title={`Batch ${open}`} transitionProps={{ duration: 150 }}>
        {detail.data && <Stack><KV rows={[['Dataset', detail.data.batch.dataset], ['File', detail.data.batch.source_file], ['SHA-256', detail.data.batch.source_sha256], ['Pipeline', detail.data.batch.pipeline_version], ['Started', detail.data.batch.started_at], ['Finished', detail.data.batch.finished_at]]} />
          <Text size="sm" fw={600}>Warnings ({detail.data.batch.warnings.length})</Text><List size="xs">{detail.data.batch.warnings.map((w: string, i: number) => <List.Item key={i}>{w}</List.Item>)}</List>
          <Text size="sm" fw={600}>Rejected and duplicate rows ({detail.data.non_imported_rows.length})</Text>{detail.data.non_imported_rows.length ? <Table fz="xs"><Table.Tbody>{detail.data.non_imported_rows.map((r: any) => <Table.Tr key={r.id}><Table.Td>row {r.row_number}</Table.Td><Table.Td>{r.status}</Table.Td><Table.Td>{r.reason_code}</Table.Td><Table.Td>{r.detail}</Table.Td></Table.Tr>)}</Table.Tbody></Table> : <Text size="xs" c="dimmed">None.</Text>}</Stack>}
      </Drawer>
    </Stack>
  );
}

function Corpus() {
  const { data, error, reload } = useApi<any>('/corpus/documents');
  const [busy, setBusy] = useState(false);
  const ingest = async () => { setBusy(true); try { const r = await api('/corpus/ingest', { method: 'POST' }); notifications.show({ color: 'navy', title: 'Corpus ingested', message: `${r.documents} documents, ${r.chunks} decision units` }); reload(); } catch (e) { notifications.show({ color: 'rust', title: 'Corpus ingestion failed', message: (e as Error).message }); } finally { setBusy(false); } };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <Card title="Clinical corpus (STW pack and clinic protocol)" right={<Button size="xs" variant="default" loading={busy} onClick={ingest}>Re-ingest corpus</Button>} pad="xs">
      <Table.ScrollContainer minWidth={900}><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Code</Table.Th><Table.Th>Title</Table.Th><Table.Th>Version</Table.Th><Table.Th>Effective</Table.Th><Table.Th>Status</Table.Th><Table.Th>Pages</Table.Th><Table.Th>Units</Table.Th><Table.Th>Extraction</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{data.items.map((d: any) => <Table.Tr key={d.id}><Table.Td>{d.doc_code}</Table.Td><Table.Td>{d.title}<Text size="xs" c="dimmed">{d.file_name}</Text></Table.Td><Table.Td>{d.version}</Table.Td><Table.Td>{d.effective_date}</Table.Td><Table.Td><Badge size="xs" color={d.status === 'SUPERSEDED' ? 'orange' : d.status === 'LOCAL_PROTOCOL' ? 'teal' : 'navy'}>{d.status}</Badge>{d.supersedes && <Text size="xs" c="dimmed">supersedes {d.supersedes}</Text>}</Table.Td><Table.Td>{d.page_count}</Table.Td><Table.Td>{d.chunk_count}</Table.Td><Table.Td>{d.extraction.issues.length ? <Expand label={`${d.extraction.issues.length} note(s)`}><List size="xs">{d.extraction.issues.map((x: string) => <List.Item key={x}>{x}</List.Item>)}</List></Expand> : <Badge size="xs" color="navy" variant="outline">clean</Badge>}{d.metadata.archive_notice && <Text size="xs" c="orange.8">{d.metadata.archive_notice}</Text>}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
    </Card>
  );
}

function Quality() {
  const { data: q, error, reload } = useApi<any>('/data-quality');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!q) return <Loading rows={8} />;
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Stat label="CDCI rows" value={q.cdci.rows} /><Stat label="Brand-name collisions" value={q.cdci.brand_name_collisions} hint={`${q.cdci.products_in_collision} products involved`} color="clay.7" />
        <Stat label="Unit-suspect products" value={q.cdci.unit_suspect_products} hint={q.cdci.all_units_mg ? 'every strength labelled mg' : ''} color="clay.7" /><Stat label="Expired stock rows" value={q.stock.expired_before_as_of} hint={`of ${q.stock.rows}`} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card title="Missing values in CDCI (blank cells)"><Table fz="xs"><Table.Tbody>{Object.entries(q.cdci.blank_values_by_column).filter(([, v]: any) => v > 0).map(([k, v]: any) => <Table.Tr key={k}><Table.Td>{k}</Table.Td><Table.Td>{v}</Table.Td></Table.Tr>)}</Table.Tbody></Table><Text size="xs" c="dimmed" mt="xs">Blank ingredient_2 and ingredient_3 are expected for single-ingredient products.</Text></Card>
        <Card title="Pharmacy stock mapping"><KV rows={[['Rows', q.stock.rows], ['Distinct billed names', q.stock.distinct_billed_names], ['Mapped unambiguously', q.stock.mapped], ['Queued (candidates)', q.stock.queued], ['No candidate', q.stock.unmapped], ['Non-Latin script lines', q.stock.non_latin_script]]} /><Text size="xs" c="dimmed" mt="xs">By method: {q.stock.by_method.map((m: any) => `${m.mapping_method} ${m.n}`).join(', ')}</Text></Card>
        <Card title="Reference datasets"><KV rows={[['NLEM rows', q.reference.nlem_rows], ['NLEM without category', q.reference.nlem_without_category], ['NLEM names not in master', q.reference.nlem_not_in_master], ['Jan Aushadhi rows', q.reference.ja_rows], ['Interaction terms not in master', q.reference.interaction_terms_not_in_master]]} /></Card>
        <Card title="Seed prescriptions"><KV rows={[['Prescriptions', q.seed_prescriptions.prescriptions], ['Lines', q.seed_prescriptions.lines]]} /><Text size="xs" c="dimmed" mt="xs">The brief describes the template as 18 lines; the file holds {q.seed_prescriptions.lines} data rows. Recorded in the gaps register.</Text></Card>
      </SimpleGrid>
      <Card title="Widest strength spread per ingredient (statistical flag, not a clinical judgement)" pad="xs"><Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Ingredient</Table.Th><Table.Th>Min mg</Table.Th><Table.Th>Max mg</Table.Th><Table.Th>Ratio</Table.Th><Table.Th>Products</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{q.strength_spread.map((s: any) => <Table.Tr key={s.ingredient_norm}><Table.Td>{s.ingredient_norm}</Table.Td><Table.Td>{s.mn}</Table.Td><Table.Td>{s.mx}</Table.Td><Table.Td>{Math.round(s.ratio)}x</Table.Td><Table.Td>{s.products}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
      <Card title="Batch warnings (latest per dataset)">{q.batch_warnings.map((b: any) => <div key={b.dataset}><Text size="xs" fw={600}>{b.dataset}</Text><List size="xs" mb="xs">{b.warnings.map((w: string, i: number) => <List.Item key={i}>{w}</List.Item>)}</List></div>)}</Card>
      <Alert color="gray" variant="light">{q.strength_spread_note}</Alert>
      <JsonViewHidden data={q} />
    </Stack>
  );
}
const JsonViewHidden = ({ data }: { data: unknown }) => <Expand label="Raw data-quality JSON"><JsonView data={data} /></Expand>;

export default function DataPage() {
  return (
    <>
      <PageHeader title="Data, ingestion and quality" subtitle="Reproducible ingestion with row-level provenance, a validate-only mode, and an honest account of what is wrong with the supplied data." />
      <Tabs defaultValue="ingest" keepMounted={false}>
        <Tabs.List mb="md"><Tabs.Tab value="ingest">Ingestion</Tabs.Tab><Tabs.Tab value="corpus">Clinical corpus</Tabs.Tab><Tabs.Tab value="quality">Data quality</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="ingest"><Ingestion /></Tabs.Panel><Tabs.Panel value="corpus"><Corpus /></Tabs.Panel><Tabs.Panel value="quality"><Quality /></Tabs.Panel>
      </Tabs>
    </>
  );
}
