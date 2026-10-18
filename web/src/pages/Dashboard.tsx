import { Alert, Badge, Group, Progress, SimpleGrid, Table, Text } from '@mantine/core';
import { useApi } from '../api';
import { Card, DemoLabel, Empty, ErrorState, Loading, PageHeader, Stat , RLink } from '../components/common';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default function Dashboard() {
  const { data: d, error, loading, reload } = useApi<any>('/dashboard');
  const { data: h } = useApi<any>('/health');
  if (error) return <><PageHeader title="Clinical intelligence dashboard" /><ErrorState error={error} onRetry={reload} /></>;
  if (loading || !d) return <><PageHeader title="Clinical intelligence dashboard" /><Loading rows={8} /></>;
  const sm = d.mappings;
  return (
    <>
      <PageHeader title="Clinical intelligence dashboard" subtitle={`Every figure is computed from the local database or recorded runs. Evaluated as of ${d.as_of}.`} />
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm" mb="md">
        <Stat label="Drug products" value={d.drug_master.products.toLocaleString()} hint={`${d.drug_master.ingredients_rows} ingredient rows`} />
        <Stat label="FDC products" value={d.drug_master.fdc_products} hint={`${d.drug_master.fdc_cross_checked} cross-checked, 0 clinician-verified`} />
        <Stat label="Open review items" value={d.review.open.toLocaleString()} hint={`${d.review.resolved} resolved`} color={d.review.open ? 'clay.7' : undefined} />
        <Stat label="Regulatory events" value={d.regulatory.events} hint={`${d.regulatory.targets} targets, ${d.regulatory.anomalies} anomalies`} />
        <Stat label="Safety runs" value={d.safety.user_runs + d.safety.seeded_demo_runs} hint={`${d.safety.seeded_demo_runs} seeded demo, ${d.safety.user_runs} user`} />
        <Stat label="Q&A" value={`${d.qa.answered + d.qa.partial}/${d.qa.abstained}`} hint="answered(+partial) / abstained, user questions" />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="md">
        <Card title="Stock-to-master mapping" right={<RLink to="/review?type=STOCK_LINE">Open review queue</RLink>}>
          <Progress.Root size={14}><Progress.Section value={pct(sm.stock_mapped, sm.stock_total)} color="navy.7" /><Progress.Section value={pct(sm.stock_queued, sm.stock_total)} color="clay.5" /><Progress.Section value={pct(sm.stock_unmapped, sm.stock_total)} color="rust.5" /></Progress.Root>
          <Group gap="lg" mt="xs"><Text size="xs"><b>{sm.stock_mapped}</b> mapped</Text><Text size="xs"><b>{sm.stock_queued}</b> queued with candidates</Text><Text size="xs"><b>{sm.stock_unmapped}</b> no candidate</Text><Text size="xs" c="dimmed">of {sm.stock_total} stock lines</Text></Group>
          <Text size="xs" c="dimmed" mt="xs">{d.drug_master.brand_collisions} brand names map to more than one product; none is auto-resolved.</Text>
        </Card>
        <Card title="Provenance coverage">
          {[['Products with source row and batch', d.provenance.products_with_source_row, d.provenance.products], ['Ingredient rows with source row', d.provenance.ingredients_with_source_row, d.provenance.ingredients], ['Regulatory events with source row', d.provenance.events_with_source_row, d.provenance.events]].map(([l, a, b]: any) => (
            <div key={l}><Group justify="space-between"><Text size="xs">{l}</Text><Text size="xs">{a}/{b}</Text></Group><Progress value={pct(a, b)} color="navy.7" size="sm" mb={6} /></div>))}
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="md">
        <Card title="Regulatory status today (derived from events)" right={<RLink to="/regulatory">Open register</RLink>}>
          <Group gap="xs">{Object.entries(d.regulatory.by_state).map(([k, v]: any) => <Badge key={k} color={k === 'PROHIBITED' ? 'rust' : k === 'SOURCE_CONFLICT' ? 'grape' : 'clay'} variant="light">{k} {v}</Badge>)}</Group>
          <Text size="xs" c="dimmed" mt="xs">{d.regulatory.pending_effective} event(s) dated after today are pending, not in force.</Text>
        </Card>
        <Card title="Module B evaluation (self-authored criteria)" right={<RLink to="/evaluation">Details</RLink>}>
          {d.evaluation ? <><Group gap="md"><Text size="sm"><b>{d.evaluation.core.correct}</b> correct</Text><Text size="sm"><b>{d.evaluation.core.correctly_abstained}</b> correctly abstained</Text><Text size="sm"><b>{d.evaluation.core.wrong}</b> wrong</Text><Text size="xs" c="dimmed">of {d.evaluation.core.total} sample questions</Text></Group><Text size="xs" c="dimmed" mt={4}>Run {d.evaluation.created_at}. Not an independent accuracy figure.</Text></> : <Empty title="No evaluation run yet" />}
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mb="md">
        <Card title="Dataset freshness">
          <Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Dataset</Table.Th><Table.Th>Version</Table.Th><Table.Th>Age</Table.Th><Table.Th>Basis</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{d.freshness.map((f: any) => <Table.Tr key={f.dataset}><Table.Td>{f.dataset}</Table.Td><Table.Td>{f.version_label ?? '-'}</Table.Td><Table.Td>{f.ageDays}d / {f.max_age_days}d {f.expired && <Badge color="orange" size="xs">EXPIRED</Badge>}</Table.Td><Table.Td>{f.basis === 'LOAD_TIME_ONLY' ? 'load time only' : 'declared date'}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        </Card>
        <Card title="System status">
          {h ? h.degraded.map((x: any) => <Alert key={x.component} p="xs" mb={6} color={x.severity === 'ERROR' ? 'rust' : x.severity === 'WARN' ? 'clay' : 'gray'} variant="light"><Text size="xs"><b>{x.component}</b>: {x.message}</Text></Alert>) : <Loading rows={3} />}
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card title="Latest ingestion batches" right={<RLink to="/data">All batches</RLink>}>
          <Table fz="xs"><Table.Tbody>{d.recent_batches.map((b: any) => <Table.Tr key={b.id}><Table.Td>#{b.id}</Table.Td><Table.Td>{b.dataset}</Table.Td><Table.Td>{b.status}{b.mode === 'DRY_RUN' ? ' (dry run)' : ''}</Table.Td><Table.Td>{b.rows_imported}/{b.rows_total} imported, {b.rows_rejected} rejected, {b.rows_duplicate} dup</Table.Td></Table.Tr>)}</Table.Tbody></Table>
        </Card>
        <Card title="Recent activity" right={<DemoLabel>Includes seeded setup</DemoLabel>}>
          {d.recent_activity.length ? <Table fz="xs"><Table.Tbody>{d.recent_activity.map((a: any, i: number) => <Table.Tr key={i}><Table.Td>{a.at.slice(0, 19).replace('T', ' ')}</Table.Td><Table.Td>{a.actor}</Table.Td><Table.Td>{a.action}</Table.Td></Table.Tr>)}</Table.Tbody></Table> : <Empty title="No activity yet" />}
          <Text size="xs" c="dimmed" mt="xs">{d.label_note}</Text>
        </Card>
      </SimpleGrid>
    </>
  );
}
